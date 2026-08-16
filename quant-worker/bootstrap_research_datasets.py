from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Iterator

import psycopg

from backtest.catalog import FEEDS
from backtest.models import Bar
from backtest.providers import BinanceSpotAdapter, VnstockAdapter
from backtest.publication import (
    PostgresDatasetPublisher,
    prepare_dataset_publication,
    publish_dataset,
)
from backtest.run_repository import database_url


FIXTURE_BASE_PRICES = {
    "FPT": Decimal("100000"),
    "BTC": Decimal("42000"),
    "XAU": Decimal("2000"),
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
    base_price = FIXTURE_BASE_PRICES[asset]
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
    start = end - timedelta(days=730)
    feed = FEEDS[asset]
    if asset == "BTC":
        return BinanceSpotAdapter().fetch(
            symbol=feed.provider_symbol,
            asset=asset,
            timeframe=timeframe,
            start=start,
            end=end,
        )
    return VnstockAdapter().fetch(
        symbol=feed.provider_symbol,
        asset=asset,
        timeframe=timeframe,
        start=start,
        end=end,
    )


def bootstrap(mode: str) -> list[dict[str, object]]:
    results: list[dict[str, object]] = []
    with psycopg.connect(database_url(), autocommit=False) as connection:
        publisher = PostgresDatasetPublisher(connection)
        for timeframe in ("1d",):
            for asset, feed in FEEDS.items():
                rows = live_bars(asset, timeframe) if mode == "live" else fixture_bars(
                    asset,
                    timeframe,
                    260,
                )
                prepared = prepare_dataset_publication(
                    rows,
                    market=feed.market,
                    provider_code=feed.provider_code,
                    provider_name=feed.provider_name,
                    provider_symbol=feed.provider_symbol,
                    canonical_key=feed.canonical_key,
                    asset_name=feed.asset_name,
                    currency=feed.currency,
                    venue=feed.venue,
                    timezone_name=feed.timezone_name,
                    maximum_leverage=feed.maximum_leverage,
                    terms_url=feed.terms_url,
                    source_metadata={
                        "mode": mode,
                        "licenseScope": "research_only",
                        "provider": feed.provider_code,
                        "providerSymbol": feed.provider_symbol,
                        "clientProvider": feed.client_provider,
                        "upstreamProvider": feed.upstream_provider,
                    },
                )
                result = publish_dataset(publisher, prepared)
                results.append(
                    {
                        "asset": asset,
                        "timeframe": timeframe,
                        "provider": feed.provider_code,
                        **result,
                    }
                )
        connection.commit()
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish versioned research datasets.")
    parser.add_argument("--mode", choices=("fixture", "live"), default="fixture")
    args = parser.parse_args()
    print(json.dumps(bootstrap(args.mode), indent=2))


if __name__ == "__main__":
    main()
