import os
from datetime import datetime, timezone
from pathlib import Path

import psycopg
import pytest

from ingest_market_data import psycopg_connection_url
from verify_market_ingestion import SchedulerAlreadyRunning, finish_scheduler_run, recover_stale_scheduler_runs, retire_out_of_scope_requests, start_scheduler_run, verify_health
from verify_market_ingestion import health_json_output, load_health


ROOT = Path(__file__).resolve().parents[2]


def test_daily_health_query_executes_without_ambiguous_join_columns() -> None:
    database_url = os.getenv("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL integration tests.")

    with psycopg.connect(psycopg_connection_url(database_url)) as connection:
        health = load_health(connection, ("BTC",))

    assert health["missing_dataset_count"] >= 0
    assert health["stale_dataset_count"] >= 0


def test_health_verifier_keeps_recent_provider_failures_as_diagnostics() -> None:
    errors = verify_health(
        {
            "missing_dataset_count": 0,
            "stale_dataset_count": 0,
            "oldest_backlog_at": None,
            "recent_provider_failure_count": 2,
            "worker_heartbeat_at": None,
            "due_backlog_count": 0,
        },
        maximum_backlog_age_hours=6,
        maximum_recent_failures=0,
    )

    assert errors == []


def test_health_verifier_requires_live_worker_when_due_work_exists() -> None:
    errors = verify_health(
        {
            "missing_dataset_count": 0,
            "stale_dataset_count": 0,
            "oldest_backlog_at": None,
            "recent_provider_failure_count": 0,
            "worker_heartbeat_at": datetime(2026, 8, 14, 9, 0, tzinfo=timezone.utc),
            "due_backlog_count": 4,
        },
        maximum_backlog_age_hours=6,
        maximum_recent_failures=0,
        now=datetime(2026, 8, 14, 9, 5, tzinfo=timezone.utc),
    )

    assert errors == ["worker_stale"]


def test_health_json_serializes_all_operational_timestamps() -> None:
    now = datetime(2026, 8, 14, 9, 5, tzinfo=timezone.utc)

    output = health_json_output(
        {
            "oldest_backlog_at": now,
            "oldest_due_backlog_at": now,
            "last_scheduler_success_at": now,
            "worker_heartbeat_at": now,
        },
        [],
    )

    assert output["oldest_due_backlog_at"] == now.isoformat()


def test_scheduler_wrapper_keeps_bounded_manual_retry_and_drain_mode() -> None:
    source = (ROOT / "scripts" / "run-market-ingestion.ps1").read_text(encoding="utf-8")

    assert '"--retry-failed"' in source
    assert '"--retry-limit"' in source
    assert '"--drain"' in source
    assert '"--max-total"' in source
    assert '[switch]$DrainRequests' in source
    assert "$OrganizationSlug" in source
    assert "$UserEmail" in source
    assert '"--start-command"' in source
    assert '"--finish-run"' in source
    assert "$schedulerRunId = $null" in source
    assert source.rfind("& $taskVerificationPath") < source.rfind('"--finish-run"')
    assert "finally" in source
    assert "$schedulerFinished" in source
    assert "sync_corporate_actions.py" in source
    assert "publish_adjusted_datasets.py" in source
    assert '$Command -in @("daily", "all")' in source
    assert "$taskCorporateActionExitCode" in source
    assert '"--queued-count"' in source
    assert '"--processed-count"' in source


def test_scheduler_artifact_has_bounded_four_hourly_daily_and_weekly_triggers() -> None:
    source = (ROOT / "deploy" / "windows" / "quant-ingestion-tasks.xml").read_text(
        encoding="utf-8"
    )

    assert "run-market-ingestion.ps1 -Command hourly" not in source
    assert source.count("run-smart-insights.ps1 -Schedule four-hourly") == 1
    assert source.count("refresh-asset-opinions.ps1") == 1
    assert source.count("run-smart-insights.ps1 -Schedule weekly") == 1
    assert "PT4H" in source
    assert "01:15:00Z" in source
    assert "P1W" in source

    installer = (ROOT / "deploy" / "windows" / "install-quant-ingestion-tasks.ps1").read_text(
        encoding="utf-8"
    )
    assert "[switch]$Install" in installer
    assert "Register-ScheduledTask" in installer
    assert installer.count("New-ScheduledTaskTrigger") == 3
    assert "[switch]$Verify" in installer
    assert "RestartCount" in installer
    assert "-RunLevel Limited" in installer
    assert "-RunLevel Highest" not in installer
    assert '$ErrorActionPreference = "Stop"' in installer
    assert '$PSNativeCommandUseErrorActionPreference = $true' in installer
    assert "if ($Verify)" in installer
    assert installer.index("if ($Verify)") < installer.index("New-ScheduledTaskSettingsSet")
    assert "Get-ScheduledTaskInfo" in installer
    assert ".Actions" in installer
    assert "LastTaskResult" in installer
    assert "refresh-asset-opinions.ps1" in installer
    assert '"RadarAsset Market Ingestion Hourly"' in installer
    assert '"RadarAsset Market Ingestion Daily"' in installer
    assert "Disable-ScheduledTask" in installer
    assert "Legacy intraday task" in installer


def test_daily_asset_opinion_refresh_runs_all_stages_in_fail_closed_order() -> None:
    wrapper = (ROOT / "scripts" / "refresh-asset-opinions.ps1").read_text(
        encoding="utf-8"
    )

    market = wrapper.index('run-market-ingestion.ps1')
    sources = wrapper.index('run-smart-insights.ps1')
    briefing = wrapper.index('"briefing"')
    assert market < sources < briefing
    assert '$taskAssets = @(' not in wrapper
    assert '-Command "daily"' in wrapper
    assert '-DrainRequests' in wrapper
    assert '-AllMemberships' in wrapper
    assert '-Schedule "calendar-current"' in wrapper
    assert "verify_daily_pipeline.py" in wrapper
    assert wrapper.count("if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }") == 5

    installer = (
        ROOT / "deploy" / "windows" / "install-quant-ingestion-tasks.ps1"
    ).read_text(encoding="utf-8")
    assert 'refresh-asset-opinions.ps1' in installer


def test_scheduled_wrapper_enqueues_without_draining_the_full_universe() -> None:
    wrapper = (ROOT / "scripts" / "run-market-ingestion.ps1").read_text(encoding="utf-8")

    assert '[switch]$DrainRequests' in wrapper
    assert 'if ($DrainRequests) {' in wrapper
    assert "@($taskCatalogOutput)[-1]" in wrapper
    drain_block = wrapper.split('if ($DrainRequests) {', 1)[1]
    assert '"--retry-failed"' in drain_block
    assert '"--drain"' in drain_block
    enqueue_path = wrapper.split('if ($DrainRequests) {', 1)[0]
    assert '"--retry-failed"' not in enqueue_path
    assert '"--drain"' not in enqueue_path
    assert "& $taskPython @taskArguments" not in enqueue_path
    assert "$taskVerificationPath" not in wrapper


def test_post_run_verifier_checks_scheduler_backlog_and_data_freshness() -> None:
    wrapper = (ROOT / "scripts" / "verify-market-ingestion.ps1").read_text(
        encoding="utf-8"
    )
    source = (ROOT / "quant-worker" / "verify_market_ingestion.py").read_text(
        encoding="utf-8"
    )

    assert "verify_market_ingestion.py" in wrapper
    assert "market_ingestion_scheduler_runs" in source
    assert "INSERT INTO market_ingestion_scheduler_runs" in source
    assert "UPDATE market_ingestion_scheduler_runs" in source
    assert "market_ingestion_requests" in source
    assert "dataset_versions" in source
    assert "missing_bar_count" in source
    assert "load_daily_scope_symbols" in source
    assert "'1d'::text AS timeframe" in source
    assert "CROSS JOIN (VALUES ('1d'), ('1h'))" not in source
    assert "DISTINCT ON (dataset.asset_id)" in source
    assert "Exit 1" in wrapper
    assert '.venv\\Scripts\\python.exe' in wrapper


def test_scheduler_start_recovers_abandoned_running_rows() -> None:
    class Cursor:
        rowcount = 2

        def execute(self, query, params):
            self.query = query
            self.params = params

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

    class Connection:
        def __init__(self):
            self.cursor_value = Cursor()

        def cursor(self):
            return self.cursor_value

        def commit(self):
            self.committed = True

    connection = Connection()

    assert recover_stale_scheduler_runs(connection, maximum_age_minutes=180) == 2
    assert "status = 'failed'" in connection.cursor_value.query
    assert connection.cursor_value.params == (180,)
    assert connection.committed is True


def test_retire_out_of_scope_requests_marks_only_active_unsupported_work() -> None:
    class Cursor:
        rowcount = 7

        def execute(self, query, params):
            self.query = query
            self.params = params

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

    class Connection:
        def __init__(self):
            self.value = Cursor()

        def cursor(self):
            return self.value

        def commit(self):
            self.committed = True

    connection = Connection()
    allowed = ("VNINDEX", "VN30", "FPT", "BTC", "XAU")

    assert retire_out_of_scope_requests(connection, allowed) == 7
    assert "status IN ('queued', 'running')" in connection.value.query
    assert "error_code = 'SCOPE_RETIRED'" in connection.value.query
    assert "UPPER(asset.symbol) = ANY(%s)" in connection.value.query
    assert connection.value.params == (list(allowed),)
    assert connection.committed is True


def test_scheduler_start_rejects_duplicate_active_command() -> None:
    class Cursor:
        rowcount = 0

        def __init__(self):
            self.calls = []
            self.rows = [{"id": "existing-run"}]

        def execute(self, query, params):
            self.calls.append((query, params))

        def fetchone(self):
            return self.rows.pop(0) if self.rows else None

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

    class Connection:
        def __init__(self):
            self.value = Cursor()

        def cursor(self, **_kwargs):
            return self.value

        def commit(self):
            pass

    connection = Connection()

    try:
        start_scheduler_run(connection, "daily")
    except SchedulerAlreadyRunning as error:
        assert error.run_id == "existing-run"
    else:
        raise AssertionError("duplicate scheduler command must be rejected")

    assert "WHERE command = %s AND status = 'running'" in connection.value.calls[2][0]


def test_scheduler_finish_persists_operational_counts() -> None:
    class Cursor:
        rowcount = 1

        def execute(self, query, params):
            self.query = query
            self.params = params

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

    class Connection:
        def __init__(self):
            self.value = Cursor()

        def cursor(self):
            return self.value

        def commit(self):
            self.committed = True

    connection = Connection()
    finish_scheduler_run(
        connection,
        "11111111-1111-4111-8111-111111111111",
        "failed",
        queued_count=8,
        retried_count=2,
        processed_count=6,
        failed_count=1,
        error_code="provider_failure",
    )

    assert "queued_count = %s" in connection.value.query
    assert connection.value.params[:6] == ("failed", 8, 2, 6, 1, "provider_failure")


def test_quant_lab_mounts_bilingual_ingestion_health_dashboard() -> None:
    quant_lab = (ROOT / "src" / "components" / "QuantLab.tsx").read_text(encoding="utf-8")
    panel = (ROOT / "src" / "components" / "MarketDataHealthPanel.tsx").read_text(
        encoding="utf-8"
    )
    dictionaries = [
        (ROOT / "src" / "lib" / "i18n" / "dictionaries" / locale / "quant.ts").read_text(
            encoding="utf-8"
        )
        for locale in ("vi", "en")
    ]

    assert "<MarketDataHealthPanel />" in quant_lab
    assert 't("quant.dataHealth.title")' in panel
    assert all(dictionary.count("dataHealth: {") == 1 for dictionary in dictionaries)
