from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Iterator

import psycopg

from backtest.models import Bar
from backtest.providers import BinanceSpotAdapter, VnstockAdapter
from backtest.publication import (
    PostgresDatasetPublisher,
    prepare_dataset_publication,
    publish_dataset,
)
from worker import database_url


ASSETS = {
    "FPT": {
        "market": "vn_equity",
        "canonical_key": "VN:HOSE:FPT",
        "asset_name": "FPT Corporation",
        "currency": "VND",
        "venue": "HOSE",
        "timezone": "Asia/Ho_Chi_Minh",
        "maximum_leverage": Decimal("2"),
        "provider_code": "vnstock-free",
        "provider_name": "Vnstock Free",
        "provider_symbol": "FPT",
        "terms_url": "https://vnstocks.com/docs/vnstock",
        "base_price": Decimal("100000"),
    },
    "BTC": {
        "market": "crypto_spot",
        "canonical_key": "CRYPTO:BINANCE:BTCUSDT",
        "asset_name": "Bitcoin / Tether",
        "currency": "USDT",
        "venue": "BINANCE",
        "timezone": "UTC",
        "maximum_leverage": Decimal("1"),
        "provider_code": "binance-public",
        "provider_name": "Binance Public Spot",
        "provider_symbol": "BTCUSDT",
        "terms_url": "https://developers.binance.com/en/docs/products/spot/rest-api",
        "base_price": Decimal("42000"),
    },
    "XAU": {
        "market": "metal_spot",
        "canonical_key": "METAL:OTC:XAUUSD",
        "asset_name": "Gold Spot / US Dollar",
        "currency": "USD",
        "venue": "OTC",
        "timezone": "UTC",
        "maximum_leverage": Decimal("1"),
        "provider_code": "vnstock-free",
        "provider_name": "Vnstock Free",
        "provider_symbol": "Gold",
        "terms_url": "https://vnstocks.com/docs/vnstock/du-lieu-thi-truong-market-data",
        "base_price": Decimal("2000"),
    },
}


def _timestamps(asset: str, timeframe: str, count: int) -> Iterator[datetime]:
    current = datetime(2024, 1, 1, tzinfo=timezone.utc)
    yielded = 0
    if timeframe == "1d":
        while yielded < count:
            if asset == "BTC" or current.weekday() < 5:
                yield current
                yielded += 1
            current += timedelta(days=1)
        return
    if asset == "FPT":
        while yielded < count:
            if current.weekday() < 5:
                for hour in (2, 3, 4, 6, 7):
                    if yielded >= count:
                        return
                    yield current.replace(hour=hour)
                    yielded += 1
            current += timedelta(days=1)
        return
    while yielded < count:
        if asset == "BTC" or current.weekday() < 5:
            yield current
            yielded += 1
        current += timedelta(hours=1)


def fixture_bars(asset: str, timeframe: str, count: int) -> list[Bar]:
    metadata = ASSETS[asset]
    base_price = Decimal(metadata["base_price"])
    rows: list[Bar] = []
    previous_close = base_price
    for index, timestamp in enumerate(_timestamps(asset, timeframe, count)):
        wave = Decimal(str(math.sin(index / 7.0) * 0.07 + math.sin(index / 19.0) * 0.03))
        trend = Decimal(index) / Decimal(count) * Decimal("0.12")
        close = base_price * (Decimal("1") + wave + trend)
        open_price = previous_close
        high = max(open_price, close) * Decimal("1.004")
        low = min(open_price, close) * Decimal("0.996")
        rows.append(
            Bar(
                asset=asset,
                timestamp=timestamp,
                timeframe=timeframe,
                open=open_price,
                high=high,
                low=low,
                close=close,
                volume=Decimal(1_000_000 + index * 1_000),
                source="research_fixture",
            )
        )
        previous_close = close
    return rows


def live_bars(asset: str, timeframe: str) -> list[Bar]:
    end = datetime.now(timezone.utc)
    start = end - (timedelta(days=730) if timeframe == "1d" else timedelta(days=40))
    metadata = ASSETS[asset]
    if asset == "BTC":
        return BinanceSpotAdapter().fetch(
            symbol=str(metadata["provider_symbol"]),
            asset=asset,
            timeframe=timeframe,
            start=start,
            end=end,
        )
    return VnstockAdapter().fetch(
        symbol=str(metadata["provider_symbol"]),
        asset=asset,
        timeframe=timeframe,
        start=start,
        end=end,
    )


def bootstrap(mode: str) -> list[dict[str, object]]:
    results: list[dict[str, object]] = []
    with psycopg.connect(database_url(), autocommit=False) as connection:
        publisher = PostgresDatasetPublisher(connection)
        for timeframe in ("1d", "1h"):
            for asset, metadata in ASSETS.items():
                rows = live_bars(asset, timeframe) if mode == "live" else fixture_bars(
                    asset,
                    timeframe,
                    260 if timeframe == "1d" else 600,
                )
                prepared = prepare_dataset_publication(
                    rows,
                    market=str(metadata["market"]),
                    provider_code=str(metadata["provider_code"]),
                    provider_name=str(metadata["provider_name"]),
                    provider_symbol=str(metadata["provider_symbol"]),
                    canonical_key=str(metadata["canonical_key"]),
                    asset_name=str(metadata["asset_name"]),
                    currency=str(metadata["currency"]),
                    venue=str(metadata["venue"]),
                    timezone_name=str(metadata["timezone"]),
                    maximum_leverage=Decimal(metadata["maximum_leverage"]),
                    terms_url=str(metadata["terms_url"]),
                    source_metadata={
                        "mode": mode,
                        "licenseScope": "research_only",
                        "provider": metadata["provider_code"],
                        "providerSymbol": metadata["provider_symbol"],
                    },
                )
                result = publish_dataset(publisher, prepared)
                results.append({"asset": asset, "timeframe": timeframe, **result})
        connection.commit()
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish versioned research datasets.")
    parser.add_argument("--mode", choices=("fixture", "live"), default="fixture")
    args = parser.parse_args()
    print(json.dumps(bootstrap(args.mode), indent=2))


if __name__ == "__main__":
    main()
