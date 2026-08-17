from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
from pathlib import Path
import re
from typing import Any, Iterable

from psycopg.rows import dict_row

from backtest.models import Bar

from .codec import DatasetSyncError, encode_dataset
from .contracts import BatchManifest, DatasetKey, DatasetManifest, serialize_manifest
from .selection import EligibilityCandidate


_SAFE_SYMBOL = re.compile(r"[^A-Za-z0-9._-]+")


@dataclass(frozen=True, slots=True)
class DatasetExportRecord:
    candidate: EligibilityCandidate
    declared_dataset_checksum: str
    provider_name: str
    provider_symbol: str
    terms_url: str | None
    asset_name: str
    venue: str
    currency: str
    timezone_name: str
    maximum_leverage: Decimal
    coverage_start: datetime
    missing_bar_count: int
    quality_summary: dict[str, Any]
    quality_issues: tuple[dict[str, Any], ...]
    rows: tuple[Bar, ...]


@dataclass(frozen=True, slots=True)
class ExportedBatch:
    manifest: BatchManifest
    manifest_bytes: bytes
    manifest_path: Path
    dataset_paths: tuple[Path, ...]


def _json_safe(value: object) -> object:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


class PostgresDatasetExportRepository:
    def __init__(self, connection: Any) -> None:
        self._connection = connection

    def load(self, candidate: EligibilityCandidate) -> DatasetExportRecord:
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT provider.name AS provider_name,
                       instrument.provider_symbol,
                       provider.terms_url,
                       asset.name AS asset_name,
                       COALESCE(asset.venue, '') AS venue,
                       asset.currency,
                       asset.timezone AS timezone_name,
                       asset.max_leverage AS maximum_leverage,
                       version.coverage_start,
                       version.missing_bar_count,
                       version.quality_summary,
                       version.checksum AS declared_dataset_checksum
                FROM dataset_versions AS version
                JOIN datasets AS dataset ON dataset.id = version.dataset_id
                JOIN assets AS asset ON asset.id = dataset.asset_id
                JOIN data_providers AS provider ON provider.id = version.provider_id
                JOIN provider_instruments AS instrument
                  ON instrument.asset_id = asset.id AND instrument.provider_id = provider.id
                WHERE version.id = %s AND version.is_active = true
                """,
                (candidate.dataset_version_id,),
            )
            metadata = cursor.fetchone()
            if metadata is None:
                raise DatasetSyncError("Selected dataset version is no longer active.")
            cursor.execute(
                """
                SELECT ts, open, high, low, close, volume, source
                FROM dataset_bars
                WHERE dataset_version_id = %s
                ORDER BY ts
                """,
                (candidate.dataset_version_id,),
            )
            stored_rows = cursor.fetchall()
            cursor.execute(
                """
                SELECT code, severity, ts, classification, range_start, range_end, details
                FROM data_quality_issues
                WHERE dataset_version_id = %s
                ORDER BY created_at, id
                """,
                (candidate.dataset_version_id,),
            )
            issue_rows = cursor.fetchall()
        rows = tuple(
            Bar(
                asset=candidate.symbol,
                timestamp=row["ts"].astimezone(timezone.utc),
                timeframe="1d",
                open=Decimal(str(row["open"])),
                high=Decimal(str(row["high"])),
                low=Decimal(str(row["low"])),
                close=Decimal(str(row["close"])),
                volume=None if row["volume"] is None else Decimal(str(row["volume"])),
                source=str(row["source"]),
            )
            for row in stored_rows
        )
        if not rows:
            raise DatasetSyncError("Selected dataset does not contain bars.")
        return DatasetExportRecord(
            candidate=candidate,
            declared_dataset_checksum=str(metadata["declared_dataset_checksum"]),
            provider_name=str(metadata["provider_name"]),
            provider_symbol=str(metadata["provider_symbol"]),
            terms_url=None if metadata["terms_url"] is None else str(metadata["terms_url"]),
            asset_name=str(metadata["asset_name"]),
            venue=str(metadata["venue"]),
            currency=str(metadata["currency"]),
            timezone_name=str(metadata["timezone_name"]),
            maximum_leverage=Decimal(str(metadata["maximum_leverage"])),
            coverage_start=metadata["coverage_start"].astimezone(timezone.utc),
            missing_bar_count=int(metadata["missing_bar_count"]),
            quality_summary=_json_safe(metadata["quality_summary"]),
            quality_issues=tuple(_json_safe(dict(issue)) for issue in issue_rows),
            rows=rows,
        )


def _batch_id(records: tuple[DatasetExportRecord, ...], now: datetime) -> str:
    source = "\n".join(record.candidate.dataset_version_id for record in records).encode("utf-8")
    return f"{now.astimezone(timezone.utc):%Y%m%dT%H%M%SZ}-{hashlib.sha256(source).hexdigest()[:12]}"


def _safe_symbol(symbol: str) -> str:
    value = _SAFE_SYMBOL.sub("-", symbol).strip(".-")
    if not value:
        raise DatasetSyncError("Dataset symbol cannot produce a safe package name.")
    return value


def build_exported_batch(
    records: Iterable[DatasetExportRecord],
    spool_root: Path,
    *,
    now: datetime,
) -> ExportedBatch:
    selected = tuple(records)
    if not selected:
        raise DatasetSyncError("Dataset export requires at least one eligible record.")
    batch_id = _batch_id(selected, now)
    batch_directory = spool_root / batch_id
    batch_directory.mkdir(parents=True, exist_ok=False)
    manifests: list[DatasetManifest] = []
    paths: list[Path] = []
    try:
        for record in selected:
            symbol = _safe_symbol(record.candidate.symbol)
            package_path = batch_directory / f"{symbol}-{record.candidate.dataset_version_id}.csv.gz"
            digest = encode_dataset(record.rows, package_path)
            if (
                digest.row_count != record.candidate.actual_row_count
                or digest.coverage_start != record.coverage_start
                or digest.coverage_end != record.candidate.coverage_end
                or digest.dataset_checksum != record.declared_dataset_checksum
            ):
                raise DatasetSyncError("Exported rows do not match the selected dataset metadata or checksum.")
            object_key = (
                f"operations/dataset-sync/{batch_id}/datasets/"
                f"{symbol}-{digest.dataset_checksum}.csv.gz"
            )
            manifests.append(
                DatasetManifest(
                    key=DatasetKey(
                        provider_code=record.candidate.provider_code,
                        canonical_key=record.candidate.canonical_key,
                        timeframe="1d",
                        adjustment_policy="raw",
                    ),
                    symbol=record.candidate.symbol,
                    asset_name=record.asset_name,
                    market=record.candidate.market,
                    venue=record.venue,
                    currency=record.currency,
                    timezone_name=record.timezone_name,
                    maximum_leverage=str(record.maximum_leverage),
                    provider_name=record.provider_name,
                    provider_symbol=record.provider_symbol,
                    terms_url=record.terms_url,
                    coverage_start=digest.coverage_start,
                    coverage_end=digest.coverage_end,
                    row_count=digest.row_count,
                    missing_bar_count=record.missing_bar_count,
                    quality_status=record.candidate.quality_status,
                    quality_summary=record.quality_summary,
                    quality_issues=record.quality_issues,
                    source_metadata=record.candidate.source_metadata,
                    dataset_checksum=digest.dataset_checksum,
                    object_key=object_key,
                    compressed_bytes=digest.compressed_bytes,
                    compressed_sha256=digest.compressed_sha256,
                )
            )
            paths.append(package_path)
        manifest = BatchManifest(
            schema_version=1,
            batch_id=batch_id,
            exported_at=now.astimezone(timezone.utc),
            status="complete",
            datasets=tuple(manifests),
        )
        manifest_bytes = serialize_manifest(manifest)
        manifest_path = batch_directory / "manifest.json"
        manifest_path.write_bytes(manifest_bytes)
        return ExportedBatch(
            manifest=manifest,
            manifest_bytes=manifest_bytes,
            manifest_path=manifest_path,
            dataset_paths=tuple(paths),
        )
    except Exception:
        for path in batch_directory.glob("*"):
            path.unlink(missing_ok=True)
        batch_directory.rmdir()
        raise
