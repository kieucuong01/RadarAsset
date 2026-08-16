from __future__ import annotations

from datetime import datetime, timezone
import importlib.util
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest


MODULE_PATH = Path(__file__).parents[2] / "deploy" / "linux" / "backup-postgres.py"
SPEC = importlib.util.spec_from_file_location("datavest_backup_postgres", MODULE_PATH)
assert SPEC and SPEC.loader
backup_postgres = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(backup_postgres)


BASE_ENV = {
    "DATABASE_URL": "postgresql://datavest:secret@127.0.0.1:5432/datavest",
    "DATAVEST_BACKUP_ENCRYPTION_SECRET": "independent-backup-secret",
    "DATAVEST_S3_ENDPOINT_URL": "https://s3.example.test",
    "DATAVEST_S3_BUCKET": "datavest",
    "DATAVEST_S3_ACCESS_KEY_ID": "access",
    "DATAVEST_S3_SECRET_ACCESS_KEY": "secret",
}


class FakeRunner:
    def __init__(self, *, fail_encrypt: bool = False) -> None:
        self.calls: list[dict[str, Any]] = []
        self.plaintext_path: Path | None = None
        self.fail_encrypt = fail_encrypt

    def run(
        self,
        args: list[str],
        *,
        env: dict[str, str] | None = None,
        capture_output: bool = False,
        text: bool = False,
    ) -> SimpleNamespace:
        self.calls.append(
            {
                "args": list(args),
                "env": dict(env or {}),
                "capture_output": capture_output,
                "text": text,
            }
        )
        effective_args = args[4:] if args[:4] == ["runuser", "-u", "postgres", "--"] else args
        if effective_args[0] == "pg_dump":
            output = Path(effective_args[effective_args.index("--file") + 1])
            self.plaintext_path = output
            output.write_bytes(b"plain-postgres-dump")
        elif effective_args[0] == "openssl":
            source = Path(effective_args[effective_args.index("-in") + 1])
            output = Path(effective_args[effective_args.index("-out") + 1])
            if "-d" in effective_args:
                output.write_bytes(b"restored-plain-dump")
            else:
                output.write_bytes(b"encrypted:" + source.read_bytes())
                if self.fail_encrypt:
                    raise RuntimeError("encryption failed")
        elif effective_args[0] == "psql" and capture_output:
            query = effective_args[effective_args.index("--command") + 1]
            stdout = "t\n" if "to_regclass" in query else "3\n"
            return SimpleNamespace(stdout=stdout)
        return SimpleNamespace(stdout="")


class FakeS3:
    def __init__(self, *, fail_put: bool = False) -> None:
        self.fail_put = fail_put
        self.objects: dict[tuple[str, str], tuple[bytes, dict[str, str]]] = {}
        self.put_calls: list[dict[str, Any]] = []

    def put_object(self, **kwargs: Any) -> dict[str, str]:
        self.put_calls.append(kwargs)
        if self.fail_put:
            raise RuntimeError("upload failed")
        body = kwargs["Body"].read()
        self.objects[(kwargs["Bucket"], kwargs["Key"])] = (body, kwargs["Metadata"])
        return {"ETag": "etag"}

    def head_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:
        body, metadata = self.objects[(Bucket, Key)]
        return {"ContentLength": len(body), "Metadata": metadata}

    def get_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:
        body, metadata = self.objects[(Bucket, Key)]
        return {
            "Body": BytesIO(body),
            "ContentLength": len(body),
            "Metadata": metadata,
        }


def test_create_fails_before_side_effects_without_encryption_secret(tmp_path: Path) -> None:
    runner = FakeRunner()
    s3 = FakeS3()
    env = {**BASE_ENV, "DATAVEST_BACKUP_ENCRYPTION_SECRET": ""}

    with pytest.raises(ValueError, match="DATAVEST_BACKUP_ENCRYPTION_SECRET"):
        backup_postgres.create_backup(env, runner, s3, spool_root=tmp_path)

    assert runner.calls == []
    assert s3.put_calls == []


def test_create_encrypts_uploads_verifies_and_removes_plaintext(tmp_path: Path) -> None:
    runner = FakeRunner()
    s3 = FakeS3()
    now = datetime(2026, 8, 17, 1, 2, 3, tzinfo=timezone.utc)

    locator = backup_postgres.create_backup(
        BASE_ENV,
        runner,
        s3,
        spool_root=tmp_path,
        now=lambda: now,
    )

    assert locator == (
        "s3://datavest/operations/backups/postgres/2026/08/"
        "20260817T010203Z.dump.enc"
    )
    pg_dump = runner.calls[0]
    assert pg_dump["args"][:3] == ["pg_dump", "--format=custom", "--no-owner"]
    assert BASE_ENV["DATABASE_URL"] not in pg_dump["args"]
    expected_pg_environment = {
        "PGHOST": "127.0.0.1",
        "PGPORT": "5432",
        "PGUSER": "datavest",
        "PGPASSWORD": "secret",
        "PGDATABASE": "datavest",
    }
    assert {
        name: pg_dump["env"][name] for name in expected_pg_environment
    } == expected_pg_environment
    encryption = runner.calls[1]
    assert encryption["args"][:6] == [
        "openssl",
        "enc",
        "-aes-256-cbc",
        "-pbkdf2",
        "-salt",
        "-in",
    ]
    assert "-pass" in encryption["args"]
    assert BASE_ENV["DATAVEST_BACKUP_ENCRYPTION_SECRET"] not in encryption["args"]
    assert encryption["env"]["DATAVEST_BACKUP_PASSPHRASE"] == (
        BASE_ENV["DATAVEST_BACKUP_ENCRYPTION_SECRET"]
    )
    assert s3.put_calls[0]["ContentType"] == "application/octet-stream"
    assert s3.put_calls[0]["Metadata"]["database"] == "datavest"
    assert len(s3.put_calls[0]["Metadata"]["sha256"]) == 64
    assert runner.plaintext_path is not None
    assert not runner.plaintext_path.exists()
    assert list(tmp_path.rglob("*.dump.enc")) == []


def test_create_keeps_only_encrypted_payload_when_upload_fails(tmp_path: Path) -> None:
    runner = FakeRunner()
    s3 = FakeS3(fail_put=True)

    with pytest.raises(RuntimeError, match="upload failed"):
        backup_postgres.create_backup(BASE_ENV, runner, s3, spool_root=tmp_path)

    assert runner.plaintext_path is not None
    assert not runner.plaintext_path.exists()
    encrypted = list(tmp_path.rglob("*.dump.enc"))
    assert len(encrypted) == 1
    assert encrypted[0].read_bytes().startswith(b"encrypted:")


def test_create_removes_partial_ciphertext_when_encryption_fails(tmp_path: Path) -> None:
    runner = FakeRunner(fail_encrypt=True)

    with pytest.raises(RuntimeError, match="encryption failed"):
        backup_postgres.create_backup(BASE_ENV, runner, FakeS3(), spool_root=tmp_path)

    assert list(tmp_path.rglob("*.dump*")) == []


def test_restore_drill_uses_exact_isolated_database_and_drops_it(tmp_path: Path) -> None:
    runner = FakeRunner()
    s3 = FakeS3()
    key = "operations/backups/postgres/2026/08/20260817T010203Z.dump.enc"
    payload = b"encrypted-backup"
    checksum = backup_postgres.sha256_bytes(payload)
    s3.objects[("datavest", key)] = (
        payload,
        {"sha256": checksum, "database": "datavest"},
    )

    backup_postgres.restore_drill(
        BASE_ENV,
        runner,
        s3,
        locator=f"s3://datavest/{key}",
        spool_root=tmp_path,
    )

    commands = [call["args"] for call in runner.calls]
    admin_prefix = ["runuser", "-u", "postgres", "--"]
    assert admin_prefix + ["createdb", "datavest_restore_test"] in commands
    assert any(
        command[:9]
        == admin_prefix
        + [
            "pg_restore",
            "--exit-on-error",
            "--no-owner",
            "--dbname",
            "datavest_restore_test",
        ]
        for command in commands
    )
    assert commands[-1] == admin_prefix + [
        "dropdb",
        "--if-exists",
        "datavest_restore_test",
    ]
    assert list(tmp_path.rglob("*.dump*")) == []


def test_restore_rejects_any_other_destination_before_side_effects(tmp_path: Path) -> None:
    runner = FakeRunner()
    s3 = FakeS3()

    with pytest.raises(ValueError, match="datavest_restore_test"):
        backup_postgres.restore_drill(
            BASE_ENV,
            runner,
            s3,
            locator="s3://datavest/operations/backups/postgres/example.dump.enc",
            spool_root=tmp_path,
            destination_database="datavest",
        )

    assert runner.calls == []
