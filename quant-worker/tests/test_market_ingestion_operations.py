from pathlib import Path

from verify_market_ingestion import verify_health


ROOT = Path(__file__).resolve().parents[2]


def test_health_verifier_rejects_recent_terminal_provider_failures() -> None:
    errors = verify_health(
        {
            "missing_dataset_count": 0,
            "stale_dataset_count": 0,
            "oldest_backlog_at": None,
            "recent_provider_failure_count": 2,
        },
        maximum_backlog_age_hours=6,
        maximum_recent_failures=0,
    )

    assert errors == ["provider_failures"]


def test_scheduler_wrapper_drains_retries_and_verifies_every_scheduled_batch() -> None:
    source = (ROOT / "scripts" / "run-market-ingestion.ps1").read_text(encoding="utf-8")

    assert '"--retry-failed"' in source
    assert '"--retry-limit"' in source
    assert '"--drain"' in source
    assert '"--max-total"' in source
    assert "verify-market-ingestion.ps1" in source
    assert "$OrganizationSlug" in source
    assert "$UserEmail" in source
    assert '"--start-command"' in source
    assert '"--finish-run"' in source
    assert "$schedulerRunId = $null" in source
    assert source.rfind("& $taskVerificationPath") < source.rfind('"--finish-run"')
    assert "sync_corporate_actions.py" in source
    assert "publish_adjusted_datasets.py" in source
    assert '$Command -in @("daily", "all")' in source


def test_scheduler_artifact_has_exactly_one_hourly_and_one_daily_trigger() -> None:
    source = (ROOT / "deploy" / "windows" / "quant-ingestion-tasks.xml").read_text(
        encoding="utf-8"
    )

    assert source.count("run-market-ingestion.ps1 -Command hourly") == 1
    assert source.count("run-market-ingestion.ps1 -Command daily") == 1
    assert "PT1H" in source
    assert "01:15:00Z" in source

    installer = (ROOT / "deploy" / "windows" / "install-quant-ingestion-tasks.ps1").read_text(
        encoding="utf-8"
    )
    assert "[switch]$Install" in installer
    assert "Register-ScheduledTask" in installer
    assert installer.count("New-ScheduledTaskTrigger") == 2


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
    assert "Exit 1" in wrapper


def test_quant_lab_mounts_bilingual_ingestion_health_dashboard() -> None:
    quant_lab = (ROOT / "src" / "components" / "QuantLab.tsx").read_text(encoding="utf-8")
    panel = (ROOT / "src" / "components" / "MarketDataHealthPanel.tsx").read_text(
        encoding="utf-8"
    )
    dictionary = (ROOT / "src" / "lib" / "i18n" / "dictionary.ts").read_text(
        encoding="utf-8"
    )

    assert "<MarketDataHealthPanel />" in quant_lab
    assert 't("quant.dataHealth.title")' in panel
    assert dictionary.count("dataHealth: {") == 2
