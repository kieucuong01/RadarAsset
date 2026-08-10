from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Iterable
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from .models import Bar
from .quality import normalize_bars


class BinanceSpotAdapter:
    base_url = "https://data-api.binance.vision/api/v3/klines"

    @staticmethod
    def parse_klines(payload: Iterable[list[Any]], *, asset: str, timeframe: str) -> list[Bar]:
        rows: list[Bar] = []
        for item in payload:
            if len(item) < 12:
                raise ValueError("Binance kline payload is incomplete.")
            rows.append(
                Bar(
                    asset=asset,
                    timestamp=datetime.fromtimestamp(int(item[0]) / 1000, tz=timezone.utc),
                    timeframe=timeframe,
                    open=Decimal(str(item[1])),
                    high=Decimal(str(item[2])),
                    low=Decimal(str(item[3])),
                    close=Decimal(str(item[4])),
                    volume=Decimal(str(item[5])),
                    source="binance-public-spot",
                )
            )
        return normalize_bars(rows)

    def fetch(
        self,
        *,
        symbol: str,
        asset: str,
        timeframe: str,
        start: datetime,
        end: datetime,
    ) -> list[Bar]:
        params = urlencode(
            {
                "symbol": symbol,
                "interval": timeframe,
                "startTime": int(start.timestamp() * 1000),
                "endTime": int(end.timestamp() * 1000),
                "limit": 1000,
            }
        )
        request = Request(f"{self.base_url}?{params}", headers={"User-Agent": "RadarAsset/1.0"})
        with urlopen(request, timeout=15) as response:  # noqa: S310 - fixed allow-listed host
            payload = json.loads(response.read().decode("utf-8"))
        if not isinstance(payload, list):
            raise ValueError("Binance kline response must be an array.")
        return self.parse_klines(payload, asset=asset, timeframe=timeframe)


class VnstockAdapter:
    @staticmethod
    def parse_records(
        records: Iterable[dict[str, Any]],
        *,
        asset: str,
        timeframe: str,
        source: str,
    ) -> list[Bar]:
        rows: list[Bar] = []
        local_zone = ZoneInfo("Asia/Ho_Chi_Minh")
        for record in records:
            raw_time = record.get("time")
            if isinstance(raw_time, datetime):
                timestamp = raw_time
            elif isinstance(raw_time, str):
                timestamp = datetime.fromisoformat(raw_time.replace("Z", "+00:00"))
            else:
                raise ValueError("Vnstock row is missing a valid time field.")
            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=local_zone)
            rows.append(
                Bar(
                    asset=asset,
                    timestamp=timestamp.astimezone(timezone.utc),
                    timeframe=timeframe,
                    open=Decimal(str(record["open"])),
                    high=Decimal(str(record["high"])),
                    low=Decimal(str(record["low"])),
                    close=Decimal(str(record["close"])),
                    volume=(
                        None
                        if record.get("volume") is None
                        else Decimal(str(record["volume"]))
                    ),
                    source=source,
                )
            )
        return normalize_bars(rows)

    def fetch(
        self,
        *,
        symbol: str,
        asset: str,
        timeframe: str,
        start: datetime,
        end: datetime,
    ) -> list[Bar]:
        from vnstock.ui import Market

        market = Market()
        instrument = market.equity(symbol) if asset == "FPT" else market.commodity("Gold")
        frame = instrument.ohlcv(
            start=start.date().isoformat(),
            end=end.date().isoformat(),
            interval="1D" if timeframe == "1d" else "1h",
        )
        records = frame.to_dict("records")
        return self.parse_records(
            records,
            asset=asset,
            timeframe=timeframe,
            source="vnstock-free",
        )
