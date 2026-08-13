from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import os
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row
import pytest

from smart_insights.artifacts import StoredArtifact
from smart_insights.contracts import ObservationInput, RawSnapshot
from smart_insights.repository import (
    ConcurrentPublicationError,
    PostgresInsightRepository,
    UnknownMetricError,
)
from smart_insights.sources import source_for_code


NOW = datetime(2026, 8, 13, 2, tzinfo=timezone.utc)


def _test_database_url() -> str:
    raw_url = os.getenv("TEST_DATABASE_URL")
    if not raw_url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL integration tests.")
    parts = urlsplit(raw_url)
    query = urlencode(
        [(key, value) for key, value in parse_qsl(parts.query) if key != "schema"]
    )
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


def _source():
    suffix = uuid4().hex[:8]
    return replace(
        source_for_code("alternative-fng"),
        code=f"qa-smart-{suffix}",
        name=f"QA Smart {suffix}",
    )


def _snapshot(source_url: str, value: str) -> RawSnapshot:
    return RawSnapshot(
        content=f'{{"value":"{value}"}}'.encode(),
        content_type="application/json",
        source_url=source_url,
        effective_at=NOW,
        published_at=NOW - timedelta(minutes=5),
        observed_at=NOW + timedelta(minutes=1),
    )


def _artifact(snapshot: RawSnapshot, source_code: str) -> StoredArtifact:
    content_hash = hashlib.sha256(snapshot.content).hexdigest()
    return StoredArtifact(
        locator=f"{source_code}/2026/08/{content_hash}.json.gz",
        content_hash=content_hash,
        byte_count=len(snapshot.content),
    )


def _row(metric_code: str, value: str) -> ObservationInput:
    return ObservationInput(
        metric_code=metric_code,
        value=Decimal(value),
        effective_at=NOW,
        published_at=NOW - timedelta(minutes=5),
        dimensions={"scope": "global"},
    )


def _seed_metric(connection: psycopg.Connection, metric_code: str) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO metric_definitions (
              id, code, market, name, unit, frequency, direction,
              methodology_version, freshness_sla_minutes, metadata, created_at, updated_at
            ) VALUES (
              gen_random_uuid(), %s, 'crypto', 'QA metric', 'index', 'daily', 1,
              'qa-v1', 1440, '{}'::jsonb, NOW(), NOW()
            )
            """,
            (metric_code,),
        )


def _cleanup(
    connection: psycopg.Connection, *, source_code: str, metric_codes: tuple[str, ...]
) -> None:
    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM provider_runs WHERE provider = %s", (source_code,))
        cursor.execute(
            """
            DELETE FROM metric_observations
            WHERE provider_id IN (SELECT id FROM data_providers WHERE code = %s)
            """,
            (source_code,),
        )
        cursor.execute(
            """
            DELETE FROM insight_raw_snapshots
            WHERE provider_id IN (SELECT id FROM data_providers WHERE code = %s)
            """,
            (source_code,),
        )
        cursor.execute("DELETE FROM data_providers WHERE code = %s", (source_code,))
        cursor.execute("DELETE FROM metric_definitions WHERE code = ANY(%s)", (list(metric_codes),))


def test_publication_revision_is_idempotent_and_correction_creates_revision_two() -> None:
    source = _source()
    metric_code = f"crypto.qa.{uuid4().hex[:8]}"
    connection = psycopg.connect(
        _test_database_url(), autocommit=True, row_factory=dict_row
    )
    try:
        _seed_metric(connection, metric_code)
        repository = PostgresInsightRepository(connection, clock=lambda: NOW + timedelta(minutes=2))
        first_snapshot = _snapshot(source.urls[0], "10")
        first = repository.publish(
            source, first_snapshot, _artifact(first_snapshot, source.code), [_row(metric_code, "10")]
        )
        unchanged = repository.publish(
            source, first_snapshot, _artifact(first_snapshot, source.code), [_row(metric_code, "10")]
        )
        corrected_snapshot = _snapshot(source.urls[0], "11")
        corrected = repository.publish(
            source,
            corrected_snapshot,
            _artifact(corrected_snapshot, source.code),
            [_row(metric_code, "11")],
        )

        assert first.status == "succeeded"
        assert unchanged.status == "unchanged"
        assert unchanged.snapshot_id == first.snapshot_id
        assert corrected.status == "succeeded"
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT revision, value
                FROM metric_observations observation
                JOIN metric_definitions metric ON metric.id = observation.metric_definition_id
                WHERE metric.code = %s
                ORDER BY revision
                """,
                (metric_code,),
            )
            assert cursor.fetchall() == [
                {"revision": 1, "value": Decimal("10.0000000000")},
                {"revision": 2, "value": Decimal("11.0000000000")},
            ]
    finally:
        _cleanup(connection, source_code=source.code, metric_codes=(metric_code,))
        connection.close()


def test_publication_rolls_back_everything_when_one_metric_is_unknown() -> None:
    source = _source()
    metric_code = f"crypto.qa.{uuid4().hex[:8]}"
    connection = psycopg.connect(
        _test_database_url(), autocommit=True, row_factory=dict_row
    )
    try:
        _seed_metric(connection, metric_code)
        snapshot = _snapshot(source.urls[0], "10")
        repository = PostgresInsightRepository(connection)
        with pytest.raises(UnknownMetricError):
            repository.publish(
                source,
                snapshot,
                _artifact(snapshot, source.code),
                [_row(metric_code, "10"), _row("crypto.qa.unknown", "20")],
            )

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT COUNT(*) AS count
                FROM insight_raw_snapshots snapshot
                JOIN data_providers provider ON provider.id = snapshot.provider_id
                WHERE provider.code = %s
                """,
                (source.code,),
            )
            assert cursor.fetchone()["count"] == 0
    finally:
        _cleanup(connection, source_code=source.code, metric_codes=(metric_code,))
        connection.close()


def test_quarantine_and_failed_run_leave_last_accepted_observation_queryable() -> None:
    source = _source()
    metric_code = f"crypto.qa.{uuid4().hex[:8]}"
    connection = psycopg.connect(
        _test_database_url(), autocommit=True, row_factory=dict_row
    )
    try:
        _seed_metric(connection, metric_code)
        repository = PostgresInsightRepository(connection, clock=lambda: NOW + timedelta(minutes=2))
        accepted = _snapshot(source.urls[0], "10")
        repository.publish(
            source, accepted, _artifact(accepted, source.code), [_row(metric_code, "10")]
        )
        rejected = _snapshot(source.urls[0], "invalid")
        repository.quarantine(
            source,
            rejected,
            _artifact(rejected, source.code),
            error_code="INVALID_RESPONSE",
        )
        repository.record_failure(
            source,
            error_code="NETWORK_ERROR",
            started_at=NOW + timedelta(minutes=3),
            finished_at=NOW + timedelta(minutes=4),
            retry_count=2,
        )

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT observation.value, snapshot.status
                FROM metric_observations observation
                JOIN metric_definitions metric ON metric.id = observation.metric_definition_id
                JOIN insight_raw_snapshots snapshot ON snapshot.id = observation.raw_snapshot_id
                WHERE metric.code = %s
                ORDER BY observation.revision DESC
                LIMIT 1
                """,
                (metric_code,),
            )
            assert cursor.fetchone() == {
                "value": Decimal("10.0000000000"),
                "status": "validated",
            }
        assert repository.last_source_run(source.code)["status"] == "failed"
        assert repository.last_successful_source_run(source.code)["status"] == "succeeded"
        assert repository.source_health_rows(source.code)[0]["last_effective_at"] == NOW
    finally:
        _cleanup(connection, source_code=source.code, metric_codes=(metric_code,))
        connection.close()


def test_publication_advisory_lock_excludes_same_source_and_effective_day() -> None:
    source = _source()
    metric_code = f"crypto.qa.{uuid4().hex[:8]}"
    lock_connection = psycopg.connect(_test_database_url(), row_factory=dict_row)
    publish_connection = psycopg.connect(
        _test_database_url(), autocommit=True, row_factory=dict_row
    )
    try:
        _seed_metric(publish_connection, metric_code)
        lock_key = f"smart-insights:{source.code}:{NOW.date().isoformat()}"
        with lock_connection.cursor() as cursor:
            cursor.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (lock_key,)
            )
        snapshot = _snapshot(source.urls[0], "10")
        with pytest.raises(ConcurrentPublicationError):
            PostgresInsightRepository(publish_connection).publish(
                source,
                snapshot,
                _artifact(snapshot, source.code),
                [_row(metric_code, "10")],
            )
    finally:
        lock_connection.rollback()
        lock_connection.close()
        _cleanup(
            publish_connection, source_code=source.code, metric_codes=(metric_code,)
        )
        publish_connection.close()
