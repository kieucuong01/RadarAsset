from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from backtest.models import Bar
from dataset_sync.codec import decode_dataset
from dataset_sync.exporter import DatasetExportRecord, build_exported_batch
from dataset_sync.selection import EligibilityCandidate


UTC = timezone.utc
NOW = datetime(2026, 8, 17, 1, 2, 3, tzinfo=UTC)


def _record() -> DatasetExportRecord:
    candidate = EligibilityCandidate(
        dataset_version_id="00000000-0000-0000-0000-000000000001",
        provider_code="binance-public",
        provider_active=True,
        instrument_active=True,
        canonical_key="CRYPTO:BTC",
        symbol="BTC",
        market="crypto_spot",
        timeframe="1d",
        adjustment_policy="raw",
        coverage_end=datetime(2024, 1, 3, tzinfo=UTC),
        declared_row_count=3,
        actual_row_count=3,
        quality_status="warning",
        source_metadata={"mode": "live"},
        row_sources=("binance-public",),
    )
    rows = tuple(
        Bar(
            asset="BTC",
            timestamp=datetime(2024, 1, day, tzinfo=UTC),
            timeframe="1d",
            open=Decimal("100"),
            high=Decimal("110"),
            low=Decimal("90"),
            close=Decimal("101"),
            volume=Decimal("10"),
            source="binance-public",
        )
        for day in range(1, 4)
    )
    return DatasetExportRecord(
        candidate=candidate,
        provider_name="Binance public",
        provider_symbol="BTCUSDT",
        terms_url=None,
        asset_name="Bitcoin",
        venue="BINANCE",
        currency="USDT",
        timezone_name="UTC",
        maximum_leverage=Decimal("1"),
        coverage_start=rows[0].timestamp,
        missing_bar_count=1,
        quality_summary={"status": "warning", "issueCount": 1},
        quality_issues=({"code": "gap", "severity": "warning"},),
        rows=rows,
    )


def test_exporter_creates_verified_one_dataset_package_and_manifest(tmp_path: Path) -> None:
    batch = build_exported_batch((_record(),), tmp_path, now=NOW)

    assert batch.manifest.batch_id == "20260817T010203Z-7ac1b8d7010b"
    assert batch.manifest.datasets[0].quality_status == "warning"
    assert batch.manifest.datasets[0].quality_issues == ({"code": "gap", "severity": "warning"},)
    assert batch.manifest_path.read_bytes() == batch.manifest_bytes
    assert decode_dataset(batch.dataset_paths[0], batch.manifest.datasets[0]) == _record().rows
