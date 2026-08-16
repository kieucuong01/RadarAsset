from datetime import datetime, timezone
import hashlib

import pytest

from smart_insights.artifacts import StoredArtifact
from smart_insights.contracts import RawSnapshot
from smart_insights.repository import PostgresInsightRepository
from smart_insights.sources import source_for_code


OBSERVED_AT = datetime(2026, 8, 17, 3, 15, tzinfo=timezone.utc)


def snapshot() -> RawSnapshot:
    return RawSnapshot(
        content=b'{"records":[1]}',
        content_type="application/json",
        source_url="https://www.bis.org/statistics/",
        effective_at=None,
        published_at=None,
        observed_at=OBSERVED_AT,
    )


def artifact(locator: str) -> StoredArtifact:
    content = snapshot().content
    return StoredArtifact(
        locator=locator,
        content_hash=hashlib.sha256(content).hexdigest(),
        byte_count=len(content),
    )


def test_repository_accepts_local_and_s3_artifact_locators() -> None:
    source = source_for_code("bis-statistics")
    digest = hashlib.sha256(snapshot().content).hexdigest()

    for locator in (
        f"bis-statistics/2026/08/{digest}.json.gz",
        f"s3://datavest/smart-insights/raw/bis-statistics/2026/08/{digest}.json.gz",
    ):
        PostgresInsightRepository._verify_artifact(source, snapshot(), artifact(locator))


@pytest.mark.parametrize(
    "locator",
    (
        "s3://datavest/smart-insights/raw/coinshares-weekly/2026/08/{digest}.json.gz",
        "s3://datavest/smart-insights/raw/bis-statistics/2025/08/{digest}.json.gz",
        "s3://datavest/smart-insights/raw/bis-statistics/2026/07/{digest}.json.gz",
        "s3://datavest/smart-insights/raw/bis-statistics/2026/08/"
        + "0" * 64
        + ".json.gz",
        "https://datavest.example/bis-statistics/2026/08/{digest}.json.gz",
    ),
)
def test_repository_rejects_artifact_locator_mismatch(locator: str) -> None:
    source = source_for_code("bis-statistics")
    digest = hashlib.sha256(snapshot().content).hexdigest()

    with pytest.raises(ValueError, match="Stored artifact"):
        PostgresInsightRepository._verify_artifact(
            source,
            snapshot(),
            artifact(locator.format(digest=digest)),
        )
