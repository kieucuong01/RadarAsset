from __future__ import annotations

import argparse
from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
from typing import Any, Sequence
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg

from dataset_sync.config import load_dataset_sync_settings
from dataset_sync.exporter import PostgresDatasetExportRepository, build_exported_batch
from dataset_sync.importer import DatasetImportCoordinator, PostgresDatasetImportRepository
from dataset_sync.selection import scan_datasets
from dataset_sync.storage import DatasetSyncS3Store


class CliUsageError(ValueError):
    pass


class StrictArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise CliUsageError(message)


def build_parser() -> StrictArgumentParser:
    parser = StrictArgumentParser(description="Transfer verified daily DataVest datasets through private S3.")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("scan", "export"):
        command = commands.add_parser(name)
        command.add_argument("--env-file", required=True)
        command.add_argument("--s3-env-file")
    export = commands.choices["export"]
    export.add_argument("--spool-root", default=".local-data/dataset-sync")
    imported = commands.add_parser("import")
    imported.add_argument("--env-file", required=True)
    imported.add_argument("--s3-env-file")
    imported.add_argument("--manifest", required=True)
    imported.add_argument("--spool-root", default=".local-data/dataset-sync")
    imported.add_argument("--apply", action="store_true")
    return parser


def emit_fatal(_: Exception) -> None:
    print(json.dumps({"status": "fatal", "errorCode": "configuration_error"}, separators=(",", ":")))


def _database_url(raw: str) -> str:
    parsed = urlsplit(raw)
    values = [(key, value) for key, value in parse_qsl(parsed.query) if key != "schema"]
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(values), parsed.fragment))


def _s3_store(settings: Any) -> DatasetSyncS3Store:
    import boto3

    client = boto3.client(
        "s3",
        endpoint_url=settings.endpoint_url,
        aws_access_key_id=settings.access_key_id,
        aws_secret_access_key=settings.secret_access_key,
        region_name="us-east-1",
    )
    return DatasetSyncS3Store(client, settings.bucket)


def _json_default(value: object) -> object:
    if is_dataclass(value):
        return asdict(value)
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _emit(payload: dict[str, object]) -> None:
    print(json.dumps(payload, default=_json_default, ensure_ascii=False, sort_keys=True, separators=(",", ":")))


def _report_payload(report: Any) -> dict[str, object]:
    return {
        "batchId": report.batch_id,
        "mode": report.mode,
        "counts": report.counts,
        "outcomes": list(report.outcomes),
    }


def _cleanup_batch(batch_directory: Path, spool_root: Path) -> None:
    resolved_root = spool_root.resolve()
    resolved_batch = batch_directory.resolve()
    if resolved_batch.parent != resolved_root:
        raise RuntimeError("Dataset sync batch cleanup target is invalid.")
    shutil.rmtree(resolved_batch)


def main(argv: Sequence[str] | None = None) -> int:
    try:
        args = build_parser().parse_args(argv)
        settings = load_dataset_sync_settings(
            Path(args.env_file),
            environ=os.environ,
            s3_env_file=None if args.s3_env_file is None else Path(args.s3_env_file),
            require_s3=args.command != "scan",
        )
        connection = psycopg.connect(_database_url(settings.database_url), autocommit=True)
    except Exception as error:
        emit_fatal(error)
        return 1
    try:
        if args.command == "scan":
            report = scan_datasets(connection, now=datetime.now(timezone.utc))
            _emit(
                {
                    "status": "ok",
                    "mode": "scan",
                    "counts": report.counts,
                    "datasets": [
                        {"symbol": item.candidate.symbol, "status": item.status}
                        for item in report.decisions
                    ],
                }
            )
            return 0
        store = _s3_store(settings)
        if args.command == "export":
            now = datetime.now(timezone.utc)
            report = scan_datasets(connection, now=now)
            repository = PostgresDatasetExportRepository(connection)
            records = [
                repository.load(decision.candidate)
                for decision in report.decisions
                if decision.status == "eligible"
            ]
            batch = build_exported_batch(records, Path(args.spool_root), now=now)
            stored = store.upload_batch(batch)
            _cleanup_batch(batch.manifest_path.parent, Path(args.spool_root))
            _emit(
                {
                    "status": "ok",
                    "mode": "export",
                    "scanCounts": report.counts,
                    "manifestLocator": stored.manifest_locator,
                    "manifestSha256": stored.manifest_sha256,
                    "datasetCount": stored.dataset_count,
                    "compressedBytes": stored.compressed_bytes,
                }
            )
            return 0
        manifest = store.read_manifest(args.manifest)
        importer = DatasetImportCoordinator(PostgresDatasetImportRepository(connection))
        if not args.apply:
            report = importer.dry_run(manifest, store)
        else:
            report = importer.apply(manifest, store, Path(args.spool_root))
        _emit({"status": "ok" if not report.counts.get("failed") else "partial_failure", **_report_payload(report)})
        return 0 if not report.counts.get("failed") and not report.counts.get("retained_due_to_reference") else 2
    except Exception as error:
        emit_fatal(error)
        return 1
    finally:
        connection.close()


if __name__ == "__main__":
    raise SystemExit(main())
