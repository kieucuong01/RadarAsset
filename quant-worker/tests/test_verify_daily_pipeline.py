from datetime import date, datetime, timezone
from uuid import UUID

from verify_daily_pipeline import (
    build_output,
    load_daily_pipeline_health,
    verify_daily_pipeline_health,
)


class Cursor:
    def __init__(self, row):
        self.row = row
        self.query = ""
        self.params = ()

    def execute(self, query, params):
        self.query = query
        self.params = params

    def fetchone(self):
        return self.row

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None


class Connection:
    def __init__(self, row):
        self.value = Cursor(row)

    def cursor(self, **_kwargs):
        return self.value


def healthy_row():
    return {
        "market_run_id": "run-1",
        "market_run_status": "succeeded",
        "market_finished_at": datetime(2026, 8, 16, 1, 20, tzinfo=timezone.utc),
        "membership_count": 3,
        "briefing_count": 3,
        "latest_briefing_at": datetime(2026, 8, 16, 1, 30, tzinfo=timezone.utc),
        "fx_effective_date": date(2026, 8, 16),
        "fx_source": "yahoo_finance",
    }


def test_loader_bounds_market_run_to_requested_local_day_and_counts_memberships() -> None:
    connection = Connection(healthy_row())

    result = load_daily_pipeline_health(
        connection, date(2026, 8, 16), "Asia/Bangkok"
    )

    assert result["membership_count"] == 3
    assert "market_ingestion_scheduler_runs" in connection.value.query
    assert "daily_briefings" in connection.value.query
    assert "organization_memberships" in connection.value.query
    assert "fx_rates" in connection.value.query
    assert connection.value.params == (
        datetime(2026, 8, 15, 17, tzinfo=timezone.utc),
        datetime(2026, 8, 16, 17, tzinfo=timezone.utc),
        date(2026, 8, 16),
        date(2026, 8, 16),
    )


def test_verifier_accepts_one_successful_market_run_and_every_member_briefing() -> None:
    assert verify_daily_pipeline_health(healthy_row()) == []


def test_verifier_rejects_missing_or_failed_market_run_before_briefing_evidence() -> None:
    missing = {**healthy_row(), "market_run_id": None, "market_run_status": None}
    failed = {**healthy_row(), "market_run_status": "failed"}

    assert verify_daily_pipeline_health(missing) == ["DAILY_MARKET_RUN_MISSING"]
    assert verify_daily_pipeline_health(failed) == ["DAILY_MARKET_RUN_FAILED"]


def test_verifier_rejects_incomplete_member_briefing_coverage() -> None:
    row = {**healthy_row(), "membership_count": 3, "briefing_count": 2}

    assert verify_daily_pipeline_health(row) == ["DAILY_BRIEFING_INCOMPLETE"]


def test_verifier_rejects_missing_or_stale_fx_rate() -> None:
    missing = {**healthy_row(), "fx_effective_date": None}
    stale = {**healthy_row(), "fx_effective_date": date(2026, 8, 11)}

    assert verify_daily_pipeline_health(missing, local_date=date(2026, 8, 16)) == [
        "DAILY_FX_RATE_MISSING"
    ]
    assert verify_daily_pipeline_health(stale, local_date=date(2026, 8, 16)) == [
        "DAILY_FX_RATE_STALE"
    ]


def test_output_serializes_database_uuid_and_timestamps() -> None:
    row = {
        **healthy_row(),
        "market_run_id": UUID("11111111-1111-4111-8111-111111111111"),
    }

    output = build_output(
        row,
        local_date=date(2026, 8, 16),
        timezone_name="Asia/Bangkok",
        errors=[],
    )

    assert output["market"]["runId"] == "11111111-1111-4111-8111-111111111111"
    assert output["market"]["finishedAt"] == "2026-08-16T01:20:00+00:00"
