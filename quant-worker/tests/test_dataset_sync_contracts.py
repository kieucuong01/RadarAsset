from __future__ import annotations

from datetime import datetime, timezone

import pytest

from dataset_sync.contracts import (
    BatchManifest,
    DatasetKey,
    DatasetManifest,
    parse_manifest,
    serialize_manifest,
)


UTC = timezone.utc


def _dataset() -> DatasetManifest:
    return DatasetManifest(
        key=DatasetKey(
            provider_code="binance-public",
            canonical_key="CRYPTO:BTC",
            timeframe="1d",
            adjustment_policy="raw",
        ),
        symbol="BTC",
        asset_name="Bitcoin",
        market="crypto_spot",
        venue="BINANCE",
        currency="USDT",
        timezone_name="UTC",
        maximum_leverage="1",
        provider_name="Binance public",
        provider_symbol="BTCUSDT",
        terms_url="https://www.binance.com/en/terms",
        coverage_start=datetime(2024, 1, 1, tzinfo=UTC),
        coverage_end=datetime(2024, 1, 3, tzinfo=UTC),
        row_count=3,
        missing_bar_count=0,
        quality_status="passed",
        quality_summary={"status": "passed"},
        quality_issues=(),
        source_metadata={"mode": "live"},
        dataset_checksum="a" * 64,
        object_key="operations/dataset-sync/20260817T010203Z-0123456789ab/datasets/BTC-a.csv.gz",
        compressed_bytes=123,
        compressed_sha256="b" * 64,
    )


def test_dataset_key_rejects_hourly_history() -> None:
    with pytest.raises(ValueError, match="daily raw"):
        DatasetKey(
            provider_code="binance-public",
            canonical_key="CRYPTO:BTC",
            timeframe="1h",
            adjustment_policy="raw",
        )


def test_batch_manifest_rejects_duplicate_dataset_key() -> None:
    dataset = _dataset()
    with pytest.raises(ValueError, match="unique"):
        BatchManifest(
            schema_version=1,
            batch_id="20260817T010203Z-0123456789ab",
            exported_at=datetime(2026, 8, 17, 1, 2, 3, tzinfo=UTC),
            status="complete",
            datasets=(dataset, dataset),
        )


def test_manifest_round_trip_rejects_unknown_fields() -> None:
    manifest = BatchManifest(
        schema_version=1,
        batch_id="20260817T010203Z-0123456789ab",
        exported_at=datetime(2026, 8, 17, 1, 2, 3, tzinfo=UTC),
        status="complete",
        datasets=(_dataset(),),
    )

    assert parse_manifest(serialize_manifest(manifest)) == manifest
    with pytest.raises(ValueError, match="unknown"):
        parse_manifest(serialize_manifest(manifest)[:-1] + b',"other":true}')
