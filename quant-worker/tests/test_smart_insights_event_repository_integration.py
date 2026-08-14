from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
import hashlib
import os
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row
import pytest

from smart_insights.artifacts import StoredArtifact
from smart_insights.contracts import RawSnapshot
from smart_insights.event_contracts import EventInput
from smart_insights.event_normalization import normalize_event
from smart_insights.event_repository import PostgresEventRepository
from smart_insights.sources import source_for_code


NOW = datetime(2026, 8, 14, 12, tzinfo=timezone.utc)


def _test_database_url() -> str:
    raw_url = os.getenv("TEST_DATABASE_URL")
    if not raw_url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL integration tests.")
    parts = urlsplit(raw_url)
    query = urlencode(
        [(key, value) for key, value in parse_qsl(parts.query) if key != "schema"]
    )
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


def _source(base_code: str):
    suffix = uuid4().hex[:8]
    return replace(
        source_for_code(base_code),
        code=f"qa-event-{suffix}",
        name=f"QA event {suffix}",
    )


def _snapshot(source_url: str, content: bytes) -> RawSnapshot:
    return RawSnapshot(
        content=content,
        content_type="application/json",
        source_url=source_url,
        effective_at=NOW,
        published_at=None,
        observed_at=NOW,
    )


def _artifact(snapshot: RawSnapshot, source_code: str) -> StoredArtifact:
    content_hash = hashlib.sha256(snapshot.content).hexdigest()
    return StoredArtifact(
        locator=f"{source_code}/2026/08/{content_hash}.json.gz",
        content_hash=content_hash,
        byte_count=len(snapshot.content),
    )


def _event(source_code: str, key: str):
    normalized = normalize_event(
        EventInput(
            source_code="gdelt-events",
            source_event_key=key,
            category="natural_hazard",
            subcategory="flood",
            title="Flooding near Manila",
            occurred_at=NOW,
            provider_severity=None,
            country="PH",
            region="Manila",
            latitude=14.6,
            longitude=120.98,
            affected_count=None,
            fatalities=None,
            source_url="https://example.org/events/1",
            dimensions={"entities": ["Manila"]},
        ),
        NOW,
    )
    return replace(normalized, source_code=source_code)


def _cleanup(connection: psycopg.Connection, source_codes: tuple[str, ...]) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT DISTINCT member.cluster_id
            FROM global_event_cluster_members member
            JOIN global_event_observations observation ON observation.id = member.observation_id
            JOIN data_providers provider ON provider.id = observation.provider_id
            WHERE provider.code = ANY(%s)
            """,
            (list(source_codes),),
        )
        cluster_ids = [row["cluster_id"] for row in cursor.fetchall()]
        cursor.execute(
            "DELETE FROM provider_runs WHERE provider = ANY(%s)", (list(source_codes),)
        )
        cursor.execute(
            """
            DELETE FROM global_event_observations
            WHERE provider_id IN (SELECT id FROM data_providers WHERE code = ANY(%s))
            """,
            (list(source_codes),),
        )
        if cluster_ids:
            cursor.execute(
                """
                DELETE FROM global_event_clusters cluster
                WHERE cluster.id = ANY(%s)
                  AND NOT EXISTS (
                    SELECT 1 FROM global_event_cluster_members member
                    WHERE member.cluster_id = cluster.id
                  )
                """,
                (cluster_ids,),
            )
        cursor.execute(
            """
            DELETE FROM insight_raw_snapshots
            WHERE provider_id IN (SELECT id FROM data_providers WHERE code = ANY(%s))
            """,
            (list(source_codes),),
        )
        cursor.execute("DELETE FROM data_providers WHERE code = ANY(%s)", (list(source_codes),))


def test_postgres_event_publication_persists_nullable_severity_and_is_idempotent() -> None:
    source = _source("gdelt-events")
    snapshot = _snapshot(source.urls[0], b'{"events":[1]}')
    connection = psycopg.connect(
        _test_database_url(), autocommit=True, row_factory=dict_row
    )
    try:
        repository = PostgresEventRepository(connection, clock=lambda: NOW)
        first = repository.publish(
            source, snapshot, _artifact(snapshot, source.code), (_event(source.code, "one"),)
        )
        replay = repository.publish(
            source, snapshot, _artifact(snapshot, source.code), (_event(source.code, "one"),)
        )

        assert first.inserted == 1
        assert first.clusters_created == 1
        assert replay.unchanged == 1
        clusters = tuple(
            cluster
            for cluster in repository.clusters(as_of=NOW)
            if (source.code, "one") in cluster.observation_keys
        )
        assert len(clusters) == 1
        assert clusters[0].normalized_severity is None
        assert repository.source_health(source.code)["last_run_status"] == "succeeded"
    finally:
        _cleanup(connection, (source.code,))
        connection.close()


def test_postgres_event_publication_corroborates_across_providers() -> None:
    first_source = _source("gdacs-events")
    second_source = _source("nasa-eonet")
    first_snapshot = _snapshot(first_source.urls[0], b'{"events":[1]}')
    second_snapshot = _snapshot(second_source.urls[0], b'{"events":[2]}')
    connection = psycopg.connect(
        _test_database_url(), autocommit=True, row_factory=dict_row
    )
    try:
        repository = PostgresEventRepository(connection, clock=lambda: NOW)
        repository.publish(
            first_source,
            first_snapshot,
            _artifact(first_snapshot, first_source.code),
            (_event(first_source.code, "one"),),
        )
        outcome = repository.publish(
            second_source,
            second_snapshot,
            _artifact(second_snapshot, second_source.code),
            (_event(second_source.code, "two"),),
        )

        assert outcome.clusters_created == 0
        clusters = tuple(
            cluster
            for cluster in repository.clusters(as_of=NOW)
            if (first_source.code, "one") in cluster.observation_keys
        )
        assert len(clusters) == 1
        assert clusters[0].corroboration_count == 2
        assert len(clusters[0].observation_keys) == 2
    finally:
        _cleanup(connection, (first_source.code, second_source.code))
        connection.close()
