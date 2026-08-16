from pathlib import Path
from datetime import datetime, timezone

import pytest

from backtest.ingestion_repository import QueuedIngestionRequest
from process_ingestion_requests import _prepare_request_dataset
from sync_provider_instruments import market_timeframe_stale_cutoffs


ROOT = Path(__file__).resolve().parents[2]


def test_daily_stale_cutoffs_exclude_intraday() -> None:
    cutoffs = market_timeframe_stale_cutoffs(datetime(2026, 8, 16, 12, tzinfo=timezone.utc))
    assert cutoffs
    assert all(timeframe == "1d" for _, timeframe in cutoffs)


def test_ingestion_worker_rejects_intraday_before_provider_fetch() -> None:
    request = QueuedIngestionRequest(
        id="request-1",
        provider_code="binance-public",
        provider_name="Binance Public Spot",
        terms_url="https://developers.binance.com",
        provider_symbol="BTCUSDT",
        asset="BTC",
        asset_name="Bitcoin",
        market="crypto_spot",
        venue="BINANCE",
        currency="USDT",
        timezone_name="UTC",
        canonical_key="crypto_spot:BINANCE:BTCUSDT",
        maximum_leverage=1,
        timeframe="1h",
        attempt_count=0,
        worker_id="worker-a",
    )

    with pytest.raises(ValueError, match="Unsupported ingestion timeframe"):
        _prepare_request_dataset(request, _FakeRepository(), lambda _: object(), now=None)


def test_worker_user_entrypoints_do_not_advertise_intraday() -> None:
    checked_files = [
        "quant-worker/ingest_market_data.py",
        "quant-worker/process_ingestion_requests.py",
        "quant-worker/backtest/ingestion.py",
        "quant-worker/backtest/run_execution.py",
        "quant-worker/bootstrap_research_datasets.py",
        "quant-worker/service.py",
        "quant-worker/sync_provider_instruments.py",
    ]
    for relative_path in checked_files:
        content = (ROOT / relative_path).read_text(encoding="utf-8")
        assert '"1h"' not in content, relative_path
        assert "four-hourly" not in content, relative_path
        assert "observed_4h" not in content, relative_path
        assert "Command hourly" not in content, relative_path


def test_scheduler_artifacts_do_not_register_intraday_jobs() -> None:
    checked_files = [
        "deploy/windows/install-quant-ingestion-tasks.ps1",
        "deploy/windows/quant-ingestion-tasks.xml",
        "scripts/run-smart-insights.ps1",
    ]
    for relative_path in checked_files:
        content = (ROOT / relative_path).read_text(encoding="utf-8")
        assert "run-market-ingestion.ps1 -Command hourly" not in content, relative_path
        assert "run-smart-insights.ps1 -Schedule four-hourly" not in content, relative_path


class _FakeRepository:
    def load_active(self, _request):
        raise AssertionError("1h must be rejected before repository/provider work")
