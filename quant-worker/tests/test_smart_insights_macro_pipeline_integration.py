from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import os
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row
import pytest

from smart_insights.collectors.cryptocraft import CalendarEventInput
from smart_insights.macro_pipeline import (
    calculate_event_risk_snapshot,
    calculate_macro_snapshot,
    run_macro_pipeline,
)
from smart_insights.metrics.crypto import ObservationPoint, SignalSnapshotInput
from smart_insights.metrics.macro import MACRO_METRIC_DEFINITIONS, METHODOLOGY_VERSION
from smart_insights.repository import PostgresInsightRepository


NOW = datetime(2026, 8, 13, 13, 0, tzinfo=timezone.utc)


class FakeRepository:
    def __init__(self) -> None:
        self.definitions: tuple[object, ...] = ()
        self.published: list[SignalSnapshotInput] = []

    def upsert_metric_definitions(self, definitions: tuple[object, ...]) -> None:
        self.definitions = definitions

    def metric_observations(
        self, metric_code: str, *, as_of: datetime, limit: int = 5_000
    ) -> tuple[ObservationPoint, ...]:
        cftc = metric_code.startswith("macro.cftc.")
        count = 40 if cftc else 90
        spacing = 7 if cftc else 1
        provider = "cftc-legacy" if cftc else "fred"
        rows = []
        for index in range(count):
            effective_at = NOW - timedelta(days=(count - index) * spacing)
            rows.append(
                ObservationPoint(
                    id=f"{metric_code}:{index}",
                    metric_code=metric_code,
                    value=Decimal(index + 1),
                    effective_at=effective_at,
                    observed_at=effective_at + timedelta(hours=12),
                    provider_code=provider,
                    quality_status="passed",
                    natural_key=f"{metric_code}:{index}",
                    revision=1,
                )
            )
        return tuple(row for row in rows if row.observed_at <= as_of)[-limit:]

    def latest_calendar_events(
        self, *, as_of: datetime, source_code: str = "cryptocraft"
    ) -> tuple[CalendarEventInput, ...]:
        events: list[CalendarEventInput] = []
        for name, category in (("Core CPI m/m", "cpi"), ("Nonfarm Payrolls", "payroll")):
            for index in range(9):
                event_at = NOW - timedelta(days=(8 - index) * 30 + 1)
                events.append(
                    CalendarEventInput(
                        source_event_key=f"cryptocraft:USD:{category}:{index}",
                        name=name,
                        country="US",
                        currency="USD",
                        impact="high",
                        actual=str(index + 1),
                        forecast="0",
                        previous=str(index),
                        event_date=event_at.date(),
                        event_at_utc=event_at,
                        time_status="timed",
                        source_timezone="UTC",
                        detail_url=f"https://www.cryptocraft.com/calendar/{category}-{index}",
                        id=f"event:{category}:{index}",
                        observed_at=event_at + timedelta(minutes=1),
                    )
                )
        future = NOW + timedelta(hours=12)
        events.append(
            CalendarEventInput(
                source_event_key="cryptocraft:USD:fomc:future",
                name="FOMC Rate Decision",
                country="US",
                currency="USD",
                impact="high",
                actual=None,
                forecast="5.25%",
                previous="5.25%",
                event_date=future.date(),
                event_at_utc=future,
                time_status="timed",
                source_timezone="UTC",
                detail_url="https://www.cryptocraft.com/calendar/fomc-future",
                id="event:future",
                observed_at=NOW - timedelta(minutes=5),
            )
        )
        return tuple(
            event
            for event in events
            if event.observed_at is None or event.observed_at <= as_of
        )

    def latest_signal_snapshot(
        self, *, market: str, as_of: datetime
    ) -> dict[str, Any] | None:
        return None

    def publish_signal_snapshot(
        self, snapshot: SignalSnapshotInput
    ) -> tuple[str, str]:
        self.published.append(snapshot)
        return f"snapshot:{len(self.published)}", "succeeded"


def test_macro_snapshot_is_deterministic_coverage_gated_and_replayable() -> None:
    repository = FakeRepository()
    first = calculate_macro_snapshot(repository, as_of=NOW)
    replay = calculate_macro_snapshot(repository, as_of=NOW)

    assert first.methodology_version == METHODOLOGY_VERSION
    assert first.status == "active"
    assert first.coverage == Decimal("1.0000")
    assert len(first.inputs) == 13
    assert first.score is not None and Decimal("-100") <= first.score <= Decimal("100")
    assert first.idempotency_key == replay.idempotency_key
    assert first.inputs == replay.inputs


def test_event_risk_is_separate_from_directional_regime() -> None:
    repository = FakeRepository()
    risk = calculate_event_risk_snapshot(
        repository, as_of=NOW, portfolio_sensitivity=Decimal("0.8")
    )

    assert risk.signal_type == "event_risk"
    assert risk.score == Decimal("80.0000")
    assert risk.label == "high"
    assert risk.status == "active"
    assert risk.inputs[0].source_observation_ids == ("event:future",)


def test_macro_pipeline_publishes_regime_and_event_risk_snapshots() -> None:
    repository = FakeRepository()
    result = run_macro_pipeline(repository, as_of=NOW)

    assert result.regime_snapshot.status == "active"
    assert result.event_risk_snapshot.status == "active"
    assert [row.signal_type for row in repository.published[:2]] == [
        "regime",
        "event_risk",
    ]


def _test_database_url() -> str:
    raw_url = os.getenv("TEST_DATABASE_URL")
    if not raw_url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL integration tests.")
    parts = urlsplit(raw_url)
    query = urlencode(
        [(key, value) for key, value in parse_qsl(parts.query) if key != "schema"]
    )
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


def test_macro_replay_ignores_event_revision_observed_after_as_of() -> None:
    key = f"cryptocraft:USD:core-cpi-replay-{uuid4().hex}:2026-08-13T12:30:00Z"
    connection = psycopg.connect(
        _test_database_url(), autocommit=True, row_factory=dict_row
    )
    try:
        with connection.cursor() as cursor:
            for revision, actual, observed_at in (
                (1, "0.2%", NOW, ),
                (2, "0.3%", NOW + timedelta(hours=1)),
            ):
                cursor.execute(
                    """
                    INSERT INTO economic_events (
                      id, source_code, source_event_key, event, country, currency,
                      impact, actual, forecast, previous, event_date, event_at,
                      time_status, source_timezone, observed_at, revision,
                      quality_status, quality_flags, created_at
                    ) VALUES (
                      gen_random_uuid(), 'cryptocraft', %s, 'Core CPI m/m', 'US', 'USD',
                      'high', %s, '0.3%%', '0.3%%', '2026-08-13',
                      '2026-08-13T12:30:00Z', 'timed', 'UTC', %s, %s,
                      'passed', '[]'::jsonb, NOW()
                    )
                    """,
                    (key, actual, observed_at, revision),
                )
        repository = PostgresInsightRepository(connection)
        replay = repository.latest_calendar_events(
            as_of=NOW + timedelta(minutes=30)
        )
        current = repository.latest_calendar_events(
            as_of=NOW + timedelta(hours=2)
        )
        assert next(row for row in replay if row.source_event_key == key).actual == "0.2%"
        assert next(row for row in current if row.source_event_key == key).actual == "0.3%"
    finally:
        with connection.cursor() as cursor:
            cursor.execute(
                "DELETE FROM economic_events WHERE source_code = 'cryptocraft' "
                "AND source_event_key = %s",
                (key,),
            )
        connection.close()


def test_macro_metric_definitions_persist_with_macro_market() -> None:
    connection = psycopg.connect(
        _test_database_url(), autocommit=True, row_factory=dict_row
    )
    try:
        repository = PostgresInsightRepository(connection)
        repository.upsert_metric_definitions(MACRO_METRIC_DEFINITIONS)
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT COUNT(*) AS count, MIN(market) AS minimum_market,
                       MAX(market) AS maximum_market
                FROM metric_definitions
                WHERE methodology_version = %s
                """,
                (METHODOLOGY_VERSION,),
            )
            row = cursor.fetchone()
            assert row == {
                "count": len(MACRO_METRIC_DEFINITIONS),
                "minimum_market": "macro",
                "maximum_market": "macro",
            }
    finally:
        with connection.cursor() as cursor:
            cursor.execute(
                "DELETE FROM metric_definitions WHERE methodology_version = %s",
                (METHODOLOGY_VERSION,),
            )
        connection.close()
