from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import pytest

from backtest.models import Bar
from dataset_sync.codec import DatasetSyncError, decode_dataset, encode_dataset
from dataset_sync.contracts import DatasetKey, DatasetManifest


UTC = timezone.utc


def _bars() -> list[Bar]:
    return [
        Bar(
            asset="BTC",
            timestamp=datetime(2024, 1, day, tzinfo=UTC),
            timeframe="1d",
            open=Decimal("100.00000000"),
            high=Decimal("110.00000000"),
            low=Decimal("90.00000000"),
            close=Decimal("101.12345678"),
            volume=Decimal("123.4567"),
            source="binance-public",
        )
        for day in range(1, 4)
    ]


def _manifest(digest: object) -> DatasetManifest:
    return DatasetManifest(
        key=DatasetKey("binance-public", "CRYPTO:BTC", "1d", "raw"),
        symbol="BTC",
        asset_name="Bitcoin",
        market="crypto_spot",
        venue="BINANCE",
        currency="USDT",
        timezone_name="UTC",
        maximum_leverage="1",
        provider_name="Binance public",
        provider_symbol="BTCUSDT",
        terms_url=None,
        coverage_start=digest.coverage_start,
        coverage_end=digest.coverage_end,
        row_count=digest.row_count,
        missing_bar_count=0,
        quality_status="passed",
        quality_summary={"status": "passed"},
        quality_issues=(),
        source_metadata={"mode": "live"},
        dataset_checksum=digest.dataset_checksum,
        object_key="operations/dataset-sync/test/datasets/BTC.csv.gz",
        compressed_bytes=digest.compressed_bytes,
        compressed_sha256=digest.compressed_sha256,
    )


def test_codec_is_deterministic_and_preserves_decimal_bars(tmp_path: Path) -> None:
    first = tmp_path / "first.csv.gz"
    second = tmp_path / "second.csv.gz"

    first_digest = encode_dataset(_bars(), first)
    second_digest = encode_dataset(_bars(), second)

    assert first.read_bytes() == second.read_bytes()
    assert first_digest == second_digest
    assert decode_dataset(first, _manifest(first_digest)) == tuple(_bars())


def test_decoder_rejects_tampered_compressed_dataset(tmp_path: Path) -> None:
    path = tmp_path / "bars.csv.gz"
    digest = encode_dataset(_bars(), path)
    path.write_bytes(path.read_bytes() + b"tampered")

    with pytest.raises(DatasetSyncError, match="Compressed"):
        decode_dataset(path, _manifest(digest))
