from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row
import pytest

from collect_smart_insights import run_calendar_live_smoke, run_calendar_schedule
from smart_insights.artifacts import StoredArtifact
from smart_insights.collectors.cryptocraft import CryptoCraftCollector
from smart_insights.contracts import RawSnapshot
from smart_insights.repository import PostgresInsightRepository
from smart_insights.scheduling import ScheduledSourceJob, due_calendar_jobs
from smart_insights.sources import is_source_url_allowed, source_for_code


NOW = datetime(2026, 8, 13, 13, 0, tzinfo=timezone.utc)
FIXTURES = Path(__file__).parent / "fixtures" / "smart_insights" / "macro"


def fixture_text(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


class FakeFirecrawl:
    def __init__(self, markdown: str, *, raw_html: str = "<table></table>") -> None:
        self.markdown = markdown
        self.raw_html = raw_html
        self.calls: list[str] = []

    def scrape(self, source: object, url: str) -> RawSnapshot:
        self.calls.append(url)
        payload = {
            "markdown": self.markdown,
            "rawHtml": self.raw_html,
            "metadata": {"sourceURL": url},
        }
        return RawSnapshot(
            content=json.dumps(payload).encode("utf-8"),
            content_type="application/json",
            source_url=url,
            effective_at=None,
            published_at=None,
            observed_at=NOW,
            metadata={"collector": "firecrawl"},
        )


def test_current_week_parses_timezone_date_carry_and_values() -> None:
    firecrawl = FakeFirecrawl(fixture_text("cryptocraft-current.md"))
    batch = CryptoCraftCollector(firecrawl=firecrawl).collect_week(
        "current", observed_at=NOW
    )

    assert batch.error_code is None
    assert firecrawl.calls == ["https://www.cryptocraft.com/calendar?week=this"]
    assert len(batch.events) == 5
    high = next(row for row in batch.events if row.name == "Core CPI m/m")
    assert high.event_at_utc == datetime(2026, 8, 13, 12, 30, tzinfo=timezone.utc)
    assert high.source_timezone == "America/New_York"
    assert high.source_event_key == (
        "cryptocraft:USD:core-cpi-m-m:2026-08-13T12:30:00Z"
    )
    assert high.actual == "0.2%"
    assert high.forecast == "0.3%"
    claims = next(row for row in batch.events if row.name == "Unemployment Claims")
    assert claims.event_date == date(2026, 8, 13)
    assert claims.event_at_utc == high.event_at_utc


def test_all_day_tentative_blank_actual_and_duplicate_names_are_preserved() -> None:
    batch = CryptoCraftCollector(
        firecrawl=FakeFirecrawl(fixture_text("cryptocraft-current.md"))
    ).collect_week("current", observed_at=NOW)

    core = [row for row in batch.events if row.name == "Core CPI m/m"]
    assert len(core) == 2
    assert len({row.source_event_key for row in core}) == 2
    assert core[1].actual is None
    all_day = next(row for row in batch.events if row.time_status == "all_day")
    tentative = next(row for row in batch.events if row.time_status == "tentative")
    assert all_day.event_at_utc is None
    assert tentative.event_at_utc is None
    assert tentative.event_date == date(2026, 8, 14)


def test_timezone_database_handles_daylight_saving_not_fixed_offset() -> None:
    batch = CryptoCraftCollector(
        firecrawl=FakeFirecrawl(fixture_text("cryptocraft-next.md"))
    ).collect_week("next", observed_at=datetime(2026, 11, 1, tzinfo=timezone.utc))

    payrolls = next(row for row in batch.events if row.name == "Nonfarm Payrolls")
    assert payrolls.event_at_utc == datetime(2026, 11, 5, 13, 30, tzinfo=timezone.utc)
    assert payrolls.source_timezone == "America/New_York"


def test_raw_html_restores_impact_and_detail_when_markdown_loses_icons() -> None:
    markdown = """Calendar Time Zone: America/New_York (GMT -4)
| Date | Time | Country | Impact | Event | Actual | Forecast | Previous |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Thu Aug 13 | 8:30am | US |  | Core CPI m/m | 0.2% | 0.3% | 0.3% |
"""
    raw_html = """
<section>Calendar Time Zone: America/New_York (GMT -4)</section>
<table><tr class="calendar__row" data-event-id="1001">
  <td class="calendar__cell calendar__date date">Thu Aug 13</td>
  <td class="calendar__cell calendar__time time">8:30am</td>
  <td class="calendar__cell calendar__country country">US</td>
  <td class="calendar__cell calendar__impact impact"><span class="icon icon--ff-impact-red"></span></td>
  <td class="calendar__cell calendar__event event"><a href="/calendar/1001-us-core-cpi-m-m">Core CPI m/m</a></td>
  <td class="calendar__cell calendar__actual actual">0.2%</td>
  <td class="calendar__cell calendar__forecast forecast">0.3%</td>
  <td class="calendar__cell calendar__previous previous">0.3%</td>
</tr></table>
"""
    batch = CryptoCraftCollector(
        firecrawl=FakeFirecrawl(markdown, raw_html=raw_html)
    ).collect_week("current", observed_at=NOW)

    assert batch.error_code is None
    assert batch.events[0].impact == "high"
    assert batch.events[0].detail_url == (
        "https://www.cryptocraft.com/calendar/1001-us-core-cpi-m-m"
    )


def test_calendar_live_smoke_uses_the_production_parser_without_writes() -> None:
    outcome = run_calendar_live_smoke(
        CryptoCraftCollector(
            firecrawl=FakeFirecrawl(fixture_text("cryptocraft-current.md"))
        ),
        as_of=NOW,
    )

    assert outcome.status == "succeeded"
    assert outcome.records_fetched == 5
    assert outcome.error_code is None


def test_actual_revision_keeps_the_same_source_identity() -> None:
    first = CryptoCraftCollector(
        firecrawl=FakeFirecrawl(fixture_text("cryptocraft-current.md"))
    ).collect_week("current", observed_at=NOW)
    revised = CryptoCraftCollector(
        firecrawl=FakeFirecrawl(fixture_text("cryptocraft-actual-revision.md"))
    ).collect_week("current", observed_at=NOW)

    before = next(row for row in first.events if row.name == "Core CPI m/m")
    after = revised.events[0]
    assert after.source_event_key == before.source_event_key
    assert before.actual == "0.2%"
    assert after.actual == "0.3%"


def test_missing_timezone_and_duplicate_conflict_fail_closed() -> None:
    no_timezone = fixture_text("cryptocraft-current.md").replace(
        "Calendar Time Zone: America/New_York (GMT -4)\n", ""
    )
    missing = CryptoCraftCollector(firecrawl=FakeFirecrawl(no_timezone)).collect_week(
        "current", observed_at=NOW
    )
    assert missing.error_code == "MISSING_TIMEZONE"
    assert missing.events == ()

    original_row = (
        "| Thu Aug 13 | 8:30am | US | High | Core CPI m/m | 0.3% | 0.3% | 0.3% | "
        "https://www.cryptocraft.com/calendar/1001-us-core-cpi-m-m |"
    )
    conflict = fixture_text("cryptocraft-actual-revision.md").replace(
        original_row,
        original_row
        + "\n| Thu Aug 13 | 8:30am | US | High | Core CPI m/m | 0.4% | 0.3% | 0.3% | "
        + "https://www.cryptocraft.com/calendar/1001-us-core-cpi-m-m |",
    )
    duplicate = CryptoCraftCollector(firecrawl=FakeFirecrawl(conflict)).collect_week(
        "current", observed_at=NOW
    )
    assert duplicate.error_code == "DUPLICATE_CONFLICT"
    assert duplicate.events == ()


def test_calendar_urls_are_fixed_and_detail_urls_are_allow_listed() -> None:
    source = source_for_code("cryptocraft")
    assert source.enabled is False
    assert is_source_url_allowed(
        source, "https://www.cryptocraft.com/calendar/1001-us-core-cpi-m-m"
    )
    assert not is_source_url_allowed(source, "https://example.com/calendar/1001")
    assert not is_source_url_allowed(source, "https://www.cryptocraft.com/thread/1001")
    with pytest.raises(ValueError, match="INVALID_WEEK"):
        CryptoCraftCollector(
            firecrawl=FakeFirecrawl(fixture_text("cryptocraft-current.md"))
        ).collect_week("other", observed_at=NOW)
    detail_firecrawl = FakeFirecrawl(fixture_text("cryptocraft-actual-revision.md"))
    detail = CryptoCraftCollector(firecrawl=detail_firecrawl).collect_detail(
        "https://www.cryptocraft.com/calendar/1001-us-core-cpi-m-m",
        observed_at=NOW,
    )
    assert detail.error_code is None
    assert detail_firecrawl.calls == [
        "https://www.cryptocraft.com/calendar/1001-us-core-cpi-m-m"
    ]


def test_calendar_cadence_selects_current_and_next_jobs_at_boundaries() -> None:
    assert due_calendar_jobs(
        NOW,
        events=(),
        last_success={
            "cryptocraft-current": NOW - timedelta(hours=2),
            "cryptocraft-next": NOW - timedelta(hours=8),
        },
    ) == (ScheduledSourceJob("cryptocraft-current", "current"),)

    assert ScheduledSourceJob("cryptocraft-next", "next") in due_calendar_jobs(
        NOW,
        events=(),
        last_success={
            "cryptocraft-current": NOW - timedelta(hours=1),
            "cryptocraft-next": NOW - timedelta(hours=12),
        },
    )


def test_high_impact_detail_window_is_inclusive_and_medium_is_excluded() -> None:
    batch = CryptoCraftCollector(
        firecrawl=FakeFirecrawl(fixture_text("cryptocraft-current.md"))
    ).collect_week("current", observed_at=NOW)
    high = next(row for row in batch.events if row.name == "Core CPI m/m")
    medium = next(
        row
        for row in batch.events
        if row.name == "Core CPI m/m" and row.impact == "medium"
    )
    assert high.event_at_utc is not None
    detail_job = ScheduledSourceJob(
        f"cryptocraft-event:{high.source_event_key}", high.detail_url or ""
    )

    assert detail_job not in due_calendar_jobs(
        high.event_at_utc - timedelta(minutes=31), events=(high,), last_success={}
    )
    assert detail_job in due_calendar_jobs(
        high.event_at_utc - timedelta(minutes=30), events=(high,), last_success={}
    )
    assert detail_job in due_calendar_jobs(
        high.event_at_utc + timedelta(minutes=90), events=(high,), last_success={}
    )
    assert detail_job not in due_calendar_jobs(
        high.event_at_utc + timedelta(minutes=91), events=(high,), last_success={}
    )
    assert not any(
        job.job_code.startswith("cryptocraft-event:")
        for job in due_calendar_jobs(
            medium.event_at_utc or NOW, events=(medium,), last_success={}
        )
    )


def test_event_detail_job_respects_fifteen_minute_last_success() -> None:
    event = CryptoCraftCollector(
        firecrawl=FakeFirecrawl(fixture_text("cryptocraft-current.md"))
    ).collect_week("current", observed_at=NOW).events[0]
    assert event.event_at_utc is not None
    job_code = f"cryptocraft-event:{event.source_event_key}"

    jobs = due_calendar_jobs(
        event.event_at_utc,
        events=(event,),
        last_success={
            "cryptocraft-current": event.event_at_utc,
            "cryptocraft-next": event.event_at_utc,
            job_code: event.event_at_utc - timedelta(minutes=14),
        },
    )
    assert not any(job.job_code == job_code for job in jobs)


def test_calendar_runner_reports_not_due_without_fetching() -> None:
    class Repository:
        @staticmethod
        def latest_calendar_events(*, as_of: datetime) -> tuple[()]:
            assert as_of == NOW
            return ()

        @staticmethod
        def last_successful_calendar_jobs() -> dict[str, datetime]:
            return {
                "cryptocraft-current": NOW,
                "cryptocraft-next": NOW,
            }

    class NeverCollector:
        def collect_week(self, week: str, *, observed_at: datetime) -> None:
            raise AssertionError("A not-due schedule must not fetch.")

        def collect_detail(self, detail_url: str, *, observed_at: datetime) -> None:
            raise AssertionError("A not-due schedule must not fetch.")

    outcomes, exit_code = run_calendar_schedule(
        "calendar-current",
        as_of=NOW,
        repository=Repository(),  # type: ignore[arg-type]
        artifact_store=object(),  # type: ignore[arg-type]
        collector=NeverCollector(),  # type: ignore[arg-type]
    )

    assert exit_code == 0
    assert outcomes[0].status == "not_due"


def _test_database_url() -> str:
    raw_url = os.getenv("TEST_DATABASE_URL")
    if not raw_url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL integration tests.")
    parts = urlsplit(raw_url)
    query = urlencode(
        [(key, value) for key, value in parse_qsl(parts.query) if key != "schema"]
    )
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


def _artifact(snapshot: RawSnapshot, source_code: str) -> StoredArtifact:
    content_hash = hashlib.sha256(snapshot.content).hexdigest()
    return StoredArtifact(
        locator=f"{source_code}/2026/08/{content_hash}.json.gz",
        content_hash=content_hash,
        byte_count=len(snapshot.content),
    )


def test_calendar_publication_is_idempotent_and_retains_actual_revision() -> None:
    first = CryptoCraftCollector(
        firecrawl=FakeFirecrawl(fixture_text("cryptocraft-current.md"))
    ).collect_week("current", observed_at=NOW)
    revised = CryptoCraftCollector(
        firecrawl=FakeFirecrawl(fixture_text("cryptocraft-actual-revision.md"))
    ).collect_week("current", observed_at=NOW)
    source = replace(
        first.source,
        code=f"qa-calendar-{uuid4().hex[:8]}",
        name="QA CryptoCraft Calendar",
    )
    key = revised.events[0].source_event_key
    connection = psycopg.connect(
        _test_database_url(), autocommit=True, row_factory=dict_row
    )
    try:
        repository = PostgresInsightRepository(connection, clock=lambda: NOW)
        published = repository.publish_calendar_batch(
            source,
            first.snapshot,
            _artifact(first.snapshot, source.code),
            first.events,
            job_code="cryptocraft-current",
        )
        unchanged = repository.publish_calendar_batch(
            source,
            first.snapshot,
            _artifact(first.snapshot, source.code),
            first.events,
            job_code="cryptocraft-current",
        )
        corrected = repository.publish_calendar_batch(
            source,
            revised.snapshot,
            _artifact(revised.snapshot, source.code),
            revised.events,
            job_code="cryptocraft-current",
        )

        assert published.observations_inserted == 5
        assert unchanged.status == "unchanged"
        assert corrected.observations_inserted == 1
        assert repository.last_successful_calendar_jobs(source.code) == {
            "cryptocraft-current": NOW
        }
        latest = repository.latest_calendar_events(as_of=NOW, source_code=source.code)
        assert next(row for row in latest if row.source_event_key == key).actual == "0.3%"
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT actual, revision
                FROM economic_events
                WHERE source_code = %s AND source_event_key = %s
                ORDER BY revision
                """,
                (source.code, key),
            )
            assert cursor.fetchall() == [
                {"actual": "0.2%", "revision": 1},
                {"actual": "0.3%", "revision": 2},
            ]
    finally:
        with connection.cursor() as cursor:
            cursor.execute(
                "DELETE FROM economic_events WHERE source_code = %s", (source.code,)
            )
            cursor.execute(
                "DELETE FROM provider_runs WHERE provider = %s", (source.code,)
            )
            cursor.execute(
                "DELETE FROM insight_raw_snapshots WHERE provider_id IN "
                "(SELECT id FROM data_providers WHERE code = %s)",
                (source.code,),
            )
            cursor.execute(
                "DELETE FROM data_providers WHERE code = %s", (source.code,)
            )
        connection.close()
