#!/usr/bin/env python3
from __future__ import annotations

import argparse
from collections.abc import Callable, Mapping
from datetime import datetime, timezone
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from typing import Any
from urllib.parse import unquote, urlparse


BACKUP_PREFIX = "operations/backups/postgres"
RESTORE_DATABASE = "datavest_restore_test"
ADMIN_PREFIX = ["runuser", "-u", "postgres", "--"]


def _required(settings: Mapping[str, str], name: str) -> str:
    value = settings.get(name, "").strip()
    if not value:
        raise ValueError(f"{name} is required.")
    return value


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _database_name(database_url: str) -> str:
    parsed = urlparse(database_url)
    name = parsed.path.lstrip("/").split("/", 1)[0]
    if parsed.scheme not in {"postgres", "postgresql"} or not name:
        raise ValueError("DATABASE_URL must identify a PostgreSQL database.")
    return name


def _command_environment(**values: str) -> dict[str, str]:
    return {**os.environ, **values}


def _postgres_environment(database_url: str) -> dict[str, str]:
    parsed = urlparse(database_url)
    database = unquote(parsed.path.lstrip("/").split("/", 1)[0])
    if parsed.scheme not in {"postgres", "postgresql"} or not parsed.hostname or not database:
        raise ValueError("DATABASE_URL must identify a PostgreSQL database host.")
    values = {
        "PGHOST": parsed.hostname,
        "PGPORT": str(parsed.port or 5432),
        "PGDATABASE": database,
    }
    if parsed.username is not None:
        values["PGUSER"] = unquote(parsed.username)
    if parsed.password is not None:
        values["PGPASSWORD"] = unquote(parsed.password)
    return _command_environment(**values)


def _prepare_spool(spool_root: Path) -> Path:
    spool_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    spool_root.chmod(0o700)
    work_directory = Path(tempfile.mkdtemp(prefix="postgres-", dir=spool_root))
    work_directory.chmod(0o700)
    return work_directory


def _prune_encrypted_retries(spool_root: Path, *, keep: int = 3) -> None:
    encrypted = sorted(
        spool_root.glob("postgres-*/*.dump.enc"),
        key=lambda item: item.stat().st_mtime_ns,
        reverse=True,
    )
    for old_file in encrypted[keep:]:
        old_directory = old_file.parent
        old_file.unlink(missing_ok=True)
        try:
            old_directory.rmdir()
        except OSError:
            pass


class SubprocessRunner:
    def run(
        self,
        args: list[str],
        *,
        env: dict[str, str] | None = None,
        capture_output: bool = False,
        text: bool = False,
    ) -> subprocess.CompletedProcess[Any]:
        return subprocess.run(
            args,
            check=True,
            env=env,
            capture_output=capture_output,
            text=text,
        )


def create_backup(
    settings: Mapping[str, str],
    runner: Any,
    s3: Any,
    *,
    spool_root: Path = Path("/opt/datavest/shared/spool/backups"),
    now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
) -> str:
    database_url = _required(settings, "DATABASE_URL")
    encryption_secret = _required(settings, "DATAVEST_BACKUP_ENCRYPTION_SECRET")
    bucket = _required(settings, "DATAVEST_S3_BUCKET")
    database_name = _database_name(database_url)
    timestamp = now().astimezone(timezone.utc)
    object_key = (
        f"{BACKUP_PREFIX}/{timestamp:%Y/%m}/{timestamp:%Y%m%dT%H%M%SZ}.dump.enc"
    )
    work_directory = _prepare_spool(spool_root)
    plaintext = work_directory / f"{timestamp:%Y%m%dT%H%M%SZ}.dump"
    encrypted = work_directory / f"{timestamp:%Y%m%dT%H%M%SZ}.dump.enc"
    encryption_complete = False
    upload_verified = False

    try:
        runner.run(
            [
                "pg_dump",
                "--format=custom",
                "--no-owner",
                "--file",
                str(plaintext),
            ],
            env=_postgres_environment(database_url),
        )
        runner.run(
            [
                "openssl",
                "enc",
                "-aes-256-cbc",
                "-pbkdf2",
                "-salt",
                "-in",
                str(plaintext),
                "-out",
                str(encrypted),
                "-pass",
                "env:DATAVEST_BACKUP_PASSPHRASE",
            ],
            env=_command_environment(DATAVEST_BACKUP_PASSPHRASE=encryption_secret),
        )
        encryption_complete = True
        plaintext.unlink(missing_ok=True)
        encrypted_size = encrypted.stat().st_size
        encrypted_sha = sha256_file(encrypted)
        with encrypted.open("rb") as body:
            s3.put_object(
                Bucket=bucket,
                Key=object_key,
                Body=body,
                ContentType="application/octet-stream",
                Metadata={"sha256": encrypted_sha, "database": database_name},
            )
        head = s3.head_object(Bucket=bucket, Key=object_key)
        metadata = {str(key).lower(): str(value) for key, value in head.get("Metadata", {}).items()}
        if head.get("ContentLength") != encrypted_size or metadata.get("sha256") != encrypted_sha:
            raise RuntimeError("Uploaded backup verification failed.")
        upload_verified = True
        return f"s3://{bucket}/{object_key}"
    finally:
        plaintext.unlink(missing_ok=True)
        if upload_verified:
            encrypted.unlink(missing_ok=True)
            shutil.rmtree(work_directory, ignore_errors=True)
        else:
            for candidate in work_directory.iterdir():
                if candidate != encrypted:
                    if candidate.is_dir():
                        shutil.rmtree(candidate, ignore_errors=True)
                    else:
                        candidate.unlink(missing_ok=True)
            if not encryption_complete:
                encrypted.unlink(missing_ok=True)
            if not encrypted.exists():
                shutil.rmtree(work_directory, ignore_errors=True)
            _prune_encrypted_retries(spool_root)


def _parse_locator(locator: str, expected_bucket: str) -> tuple[str, str]:
    parsed = urlparse(locator)
    key = parsed.path.lstrip("/")
    if (
        parsed.scheme != "s3"
        or parsed.netloc != expected_bucket
        or not key.startswith(f"{BACKUP_PREFIX}/")
        or not key.endswith(".dump.enc")
        or ".." in key.split("/")
    ):
        raise ValueError("Backup locator is invalid.")
    return parsed.netloc, key


def _download_object(s3: Any, bucket: str, key: str, destination: Path) -> dict[str, Any]:
    response = s3.get_object(Bucket=bucket, Key=key)
    body = response["Body"]
    bytes_written = 0
    with destination.open("wb") as handle:
        while True:
            chunk = body.read(1024 * 1024)
            if not chunk:
                break
            handle.write(chunk)
            bytes_written += len(chunk)
    if bytes_written != response.get("ContentLength"):
        raise RuntimeError("Downloaded backup length verification failed.")
    return response


def restore_drill(
    settings: Mapping[str, str],
    runner: Any,
    s3: Any,
    *,
    locator: str,
    spool_root: Path = Path("/opt/datavest/shared/spool/backups"),
    destination_database: str = RESTORE_DATABASE,
) -> None:
    if destination_database != RESTORE_DATABASE:
        raise ValueError(f"Restore destination must be exactly {RESTORE_DATABASE}.")
    encryption_secret = _required(settings, "DATAVEST_BACKUP_ENCRYPTION_SECRET")
    bucket = _required(settings, "DATAVEST_S3_BUCKET")
    expected_database = _database_name(_required(settings, "DATABASE_URL"))
    locator_bucket, key = _parse_locator(locator, bucket)
    work_directory = _prepare_spool(spool_root)
    encrypted = work_directory / "restore.dump.enc"
    plaintext = work_directory / "restore.dump"

    try:
        response = _download_object(s3, locator_bucket, key, encrypted)
        metadata = {
            str(name).lower(): str(value)
            for name, value in response.get("Metadata", {}).items()
        }
        expected_sha = metadata.get("sha256", "")
        if (
            len(expected_sha) != 64
            or sha256_file(encrypted) != expected_sha
            or metadata.get("database") != expected_database
        ):
            raise RuntimeError("Downloaded backup checksum verification failed.")
        runner.run(
            [
                "openssl",
                "enc",
                "-d",
                "-aes-256-cbc",
                "-pbkdf2",
                "-in",
                str(encrypted),
                "-out",
                str(plaintext),
                "-pass",
                "env:DATAVEST_BACKUP_PASSPHRASE",
            ],
            env=_command_environment(DATAVEST_BACKUP_PASSPHRASE=encryption_secret),
        )
        runner.run(ADMIN_PREFIX + ["dropdb", "--if-exists", RESTORE_DATABASE])
        runner.run(ADMIN_PREFIX + ["createdb", RESTORE_DATABASE])
        try:
            runner.run(
                ADMIN_PREFIX
                + [
                    "pg_restore",
                    "--exit-on-error",
                    "--no-owner",
                    "--dbname",
                    RESTORE_DATABASE,
                    str(plaintext),
                ]
            )
            migration = runner.run(
                ADMIN_PREFIX
                + [
                    "psql",
                    "--no-psqlrc",
                    "--tuples-only",
                    "--no-align",
                    "--dbname",
                    RESTORE_DATABASE,
                    "--command",
                    "SELECT to_regclass('public._prisma_migrations') IS NOT NULL;",
                ],
                capture_output=True,
                text=True,
            )
            tables = runner.run(
                ADMIN_PREFIX
                + [
                    "psql",
                    "--no-psqlrc",
                    "--tuples-only",
                    "--no-align",
                    "--dbname",
                    RESTORE_DATABASE,
                    "--command",
                    (
                        "SELECT count(*) FROM pg_catalog.pg_tables "
                        "WHERE schemaname = 'public' "
                        "AND tablename <> '_prisma_migrations';"
                    ),
                ],
                capture_output=True,
                text=True,
            )
            if migration.stdout.strip() != "t" or int(tables.stdout.strip()) < 1:
                raise RuntimeError("Restore drill database verification failed.")
        finally:
            runner.run(ADMIN_PREFIX + ["dropdb", "--if-exists", RESTORE_DATABASE])
    finally:
        plaintext.unlink(missing_ok=True)
        encrypted.unlink(missing_ok=True)
        shutil.rmtree(work_directory, ignore_errors=True)


def _s3_client(settings: Mapping[str, str]) -> Any:
    import boto3

    return boto3.client(
        "s3",
        endpoint_url=_required(settings, "DATAVEST_S3_ENDPOINT_URL"),
        aws_access_key_id=_required(settings, "DATAVEST_S3_ACCESS_KEY_ID"),
        aws_secret_access_key=_required(settings, "DATAVEST_S3_SECRET_ACCESS_KEY"),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Encrypted DataVest PostgreSQL backups.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    create = subparsers.add_parser("create")
    create.add_argument("--env-file", required=True)
    restore = subparsers.add_parser("restore-drill")
    restore.add_argument("--env-file", required=True)
    restore.add_argument("--locator", required=True)
    args = parser.parse_args()

    from datavest_env import read_env_file

    settings = read_env_file(Path(args.env_file))
    runner = SubprocessRunner()
    s3 = _s3_client(settings)
    if args.command == "create":
        locator = create_backup(settings, runner, s3)
        print(f"backup_status=ok locator={locator}")
        return 0
    if os.geteuid() != 0:
        raise PermissionError("restore-drill must run as root.")
    restore_drill(settings, runner, s3, locator=args.locator)
    print("restore_drill_status=ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
