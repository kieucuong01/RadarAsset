from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from smart_insights.artifacts import ArtifactStore, artifact_store_from_env
from smart_insights.contracts import RawSnapshot


def s3_env(tmp_path: Path) -> dict[str, str]:
    return {
        "SMART_INSIGHTS_ARTIFACT_BACKEND": "s3",
        "SMART_INSIGHTS_ARTIFACT_SPOOL_ROOT": str(tmp_path),
        "DATAVEST_S3_ENDPOINT_URL": "https://s3.example.invalid",
        "DATAVEST_S3_BUCKET": "datavest",
        "DATAVEST_S3_ACCESS_KEY_ID": "test-access-key",
        "DATAVEST_S3_SECRET_ACCESS_KEY": "test-secret-key",
        "DATAVEST_S3_ARTIFACT_PREFIX": "smart-insights/raw",
    }


def test_factory_defaults_to_filesystem(tmp_path: Path) -> None:
    store = artifact_store_from_env({"SMART_INSIGHTS_ARTIFACT_ROOT": str(tmp_path)})

    assert isinstance(store, ArtifactStore)
    stored = store.write(
        RawSnapshot(
            content=b"payload",
            content_type="application/json",
            source_url="https://example.com/data",
            effective_at=None,
            published_at=None,
            observed_at=datetime(2026, 8, 16, tzinfo=timezone.utc),
        ),
        "example-source",
    )
    assert store.read(stored.locator) == b"payload"


def test_factory_rejects_unknown_backend() -> None:
    with pytest.raises(
        ValueError,
        match="SMART_INSIGHTS_ARTIFACT_BACKEND must be filesystem or s3",
    ):
        artifact_store_from_env({"SMART_INSIGHTS_ARTIFACT_BACKEND": "public-http"})


@pytest.mark.parametrize(
    "missing",
    [
        "DATAVEST_S3_ENDPOINT_URL",
        "DATAVEST_S3_BUCKET",
        "DATAVEST_S3_ACCESS_KEY_ID",
        "DATAVEST_S3_SECRET_ACCESS_KEY",
        "SMART_INSIGHTS_ARTIFACT_SPOOL_ROOT",
    ],
)
def test_s3_factory_requires_every_private_setting(
    missing: str, tmp_path: Path
) -> None:
    env = s3_env(tmp_path)
    del env[missing]

    with pytest.raises(ValueError, match=missing):
        artifact_store_from_env(env)
