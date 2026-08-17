from __future__ import annotations

from pathlib import Path

import pytest

from dataset_sync.config import load_dataset_sync_settings


def _env(path: Path, extra: str = "") -> Path:
    path.write_text(
        "\n".join(
            [
                "DATABASE_URL=postgresql://user:database-password@127.0.0.1:5432/datavest",
                "DATAVEST_S3_ENDPOINT_URL=https://s3.example.test",
                "DATAVEST_S3_BUCKET=datavest",
                "DATAVEST_S3_ACCESS_KEY_ID=access-key",
                "DATAVEST_S3_SECRET_ACCESS_KEY=secret-access-key",
                extra,
            ]
        ),
        encoding="utf-8",
    )
    return path


def test_settings_read_required_values_without_exposing_secrets(tmp_path: Path) -> None:
    settings = load_dataset_sync_settings(_env(tmp_path / ".env"), environ={})

    assert settings.bucket == "datavest"
    assert "database-password" not in repr(settings)
    assert "secret-access-key" not in repr(settings)


def test_settings_reject_wrong_bucket_before_any_s3_request(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="bucket"):
        load_dataset_sync_settings(
            _env(tmp_path / ".env", "DATAVEST_S3_BUCKET=other"), environ={}
        )


def test_settings_can_read_s3_credentials_from_a_separate_ignored_file(tmp_path: Path) -> None:
    database_env = tmp_path / "database.env"
    database_env.write_text(
        "DATABASE_URL=postgresql://user:database-password@127.0.0.1:5432/datavest\n",
        encoding="utf-8",
    )
    s3_env = _env(tmp_path / "s3.env")

    settings = load_dataset_sync_settings(database_env, environ={}, s3_env_file=s3_env)

    assert settings.bucket == "datavest"


def test_scan_mode_allows_database_only_environment(tmp_path: Path) -> None:
    database_env = tmp_path / "database.env"
    database_env.write_text(
        "DATABASE_URL=postgresql://user:database-password@127.0.0.1:5432/datavest\n",
        encoding="utf-8",
    )

    settings = load_dataset_sync_settings(database_env, environ={}, require_s3=False)

    assert settings.database_url.startswith("postgresql://")
    assert settings.bucket == ""
