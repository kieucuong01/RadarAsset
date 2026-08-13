from datetime import datetime
from decimal import Decimal

import pytest

from backtest.models import Bar
from backtest.publication import prepare_dataset_publication, publish_dataset


def bars() -> list[Bar]:
    return [
        Bar(
            asset="BTC",
            timestamp=datetime.fromisoformat(timestamp.replace("Z", "+00:00")),
            timeframe="1h",
            open=Decimal("100"),
            high=Decimal("102"),
            low=Decimal("99"),
            close=Decimal("101"),
            volume=Decimal("10"),
            source="binance-public-spot",
        )
        for timestamp in (
            "2024-01-01T00:00:00Z",
            "2024-01-01T01:00:00Z",
            "2024-01-01T03:00:00Z",
        )
    ]


class FakePublisher:
    def __init__(self) -> None:
        self.received = None

    def publish(self, prepared):
        self.received = prepared
        return {
            "datasetVersionId": "version-2",
            "version": 2,
            "active": True,
            "checksum": prepared.checksum,
        }


def test_prepare_and_publish_preserves_provenance_quality_and_checksum() -> None:
    prepared = prepare_dataset_publication(
        bars(),
        market="crypto_spot",
        provider_code="binance-public",
        provider_name="Binance public Spot",
        provider_symbol="BTCUSDT",
        canonical_key="CRYPTO:BINANCE:BTCUSDT",
        asset_name="Bitcoin / Tether",
        currency="USDT",
        venue="BINANCE",
        timezone_name="UTC",
        maximum_leverage=Decimal("1"),
        terms_url="https://developers.binance.com/en/docs/products/spot/rest-api",
        source_metadata={"mode": "public-api", "licenseScope": "research_only"},
    )

    assert prepared.missing_bar_count == 1
    assert prepared.quality_status == "warning"
    assert prepared.row_count == 3
    assert len(prepared.checksum) == 64
    assert prepared.source_metadata == {
        "mode": "public-api",
        "licenseScope": "research_only",
        "calendarVersion": "crypto-24x7-v1",
        "calendarCertifiedFrom": None,
        "calendarCertifiedTo": None,
    }
    assert prepared.adjustment_policy == "raw"
    assert prepared.source_metadata["calendarVersion"] == "crypto-24x7-v1"
    assert prepared.issues[0].classification == "PROVIDER_GAP"
    assert prepared.issues[0].range_start == datetime.fromisoformat(
        "2024-01-01T02:00:00+00:00"
    )

    publisher = FakePublisher()
    result = publish_dataset(publisher, prepared)

    assert publisher.received is prepared
    assert result["version"] == 2
    assert result["active"] is True
    assert result["checksum"] == prepared.checksum


def test_prepare_rejects_a_failed_quality_report_before_database_writes() -> None:
    invalid = bars()
    invalid[0] = Bar(**{**invalid[0].__dict__, "high": Decimal("90")})

    with pytest.raises(ValueError, match="quality validation failed"):
        prepare_dataset_publication(
            invalid,
            market="crypto_spot",
            provider_code="binance-public",
            provider_name="Binance public Spot",
            provider_symbol="BTCUSDT",
            canonical_key="CRYPTO:BINANCE:BTCUSDT",
            asset_name="Bitcoin / Tether",
            currency="USDT",
            venue="BINANCE",
            timezone_name="UTC",
            maximum_leverage=Decimal("1"),
            terms_url=None,
            source_metadata={"licenseScope": "research_only"},
        )


def test_prepare_quantizes_numbers_to_postgres_storage_precision() -> None:
    high_precision = bars()
    high_precision[0] = Bar(
        **{
            **high_precision[0].__dict__,
            "open": Decimal("100.123456785"),
            "high": Decimal("102.123456785"),
            "low": Decimal("99.123456785"),
            "close": Decimal("101.123456785"),
            "volume": Decimal("10.12345"),
        }
    )

    prepared = prepare_dataset_publication(
        high_precision,
        market="crypto_spot",
        provider_code="binance-public",
        provider_name="Binance public Spot",
        provider_symbol="BTCUSDT",
        canonical_key="CRYPTO:BINANCE:BTCUSDT",
        asset_name="Bitcoin / Tether",
        currency="USDT",
        venue="BINANCE",
        timezone_name="UTC",
        maximum_leverage=Decimal("1"),
        terms_url=None,
        source_metadata={"licenseScope": "research_only"},
    )

    assert prepared.rows[0].open == Decimal("100.12345679")
    assert prepared.rows[0].high == Decimal("102.12345679")
    assert prepared.rows[0].low == Decimal("99.12345679")
    assert prepared.rows[0].close == Decimal("101.12345679")
    assert prepared.rows[0].volume == Decimal("10.1235")
