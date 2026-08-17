from __future__ import annotations

from collections.abc import Mapping
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, InvalidOperation
import json
from typing import Any
from urllib.parse import urlencode

from fx_rates.vietcombank import FxObservation, FxSchemaDrift
from smart_insights.http import UrllibTransport


SOURCE_URL = "https://query1.finance.yahoo.com/v8/finance/chart/USDVND=X"


def parse_yahoo_chart(
    payload: Mapping[str, Any],
    *,
    start: date,
    end: date,
    fetched_at: datetime | None = None,
) -> list[FxObservation]:
    chart = payload.get("chart")
    if not isinstance(chart, Mapping) or chart.get("error") is not None:
        raise FxSchemaDrift("YAHOO_CHART_INVALID")
    results = chart.get("result")
    if not isinstance(results, list) or not results or not isinstance(results[0], Mapping):
        raise FxSchemaDrift("YAHOO_CHART_MISSING")
    result = results[0]
    meta = result.get("meta")
    if not isinstance(meta, Mapping) or meta.get("symbol") != "USDVND=X":
        raise FxSchemaDrift("YAHOO_SYMBOL_INVALID")
    offset = meta.get("gmtoffset")
    if not isinstance(offset, int):
        raise FxSchemaDrift("YAHOO_TIMEZONE_INVALID")
    timestamps = result.get("timestamp")
    indicators = result.get("indicators")
    if not isinstance(timestamps, list) or not isinstance(indicators, Mapping):
        raise FxSchemaDrift("YAHOO_SERIES_INVALID")
    quotes = indicators.get("quote")
    if not isinstance(quotes, list) or not quotes or not isinstance(quotes[0], Mapping):
        raise FxSchemaDrift("YAHOO_QUOTES_INVALID")
    closes = quotes[0].get("close")
    if not isinstance(closes, list) or len(closes) != len(timestamps):
        raise FxSchemaDrift("YAHOO_SERIES_LENGTH_INVALID")

    observed_at = fetched_at or datetime.now(timezone.utc)
    by_date: dict[date, FxObservation] = {}
    for timestamp, close in zip(timestamps, closes, strict=True):
        if not isinstance(timestamp, int) or close is None:
            continue
        effective_date = datetime.fromtimestamp(timestamp + offset, timezone.utc).date()
        if effective_date < start or effective_date > end:
            continue
        try:
            rate = Decimal(str(close))
        except (InvalidOperation, ValueError) as error:
            raise FxSchemaDrift("YAHOO_RATE_INVALID") from error
        if not rate.is_finite() or rate <= 0:
            raise FxSchemaDrift("YAHOO_RATE_INVALID")
        by_date[effective_date] = FxObservation(
            effective_date=effective_date,
            transfer_buy=rate,
            sell=rate,
            mid=rate,
            source="yahoo_finance",
            fetched_at=observed_at,
        )
    if not by_date:
        raise FxSchemaDrift("YAHOO_HISTORY_EMPTY")
    return [by_date[key] for key in sorted(by_date)]


def fetch_range(
    transport: UrllibTransport,
    *,
    start: date,
    end: date,
) -> list[FxObservation]:
    period1 = int(datetime.combine(start, time.min, tzinfo=timezone.utc).timestamp())
    period2 = int(
        datetime.combine(end + timedelta(days=1), time.min, tzinfo=timezone.utc).timestamp()
    )
    url = f"{SOURCE_URL}?{urlencode({'period1': period1, 'period2': period2, 'interval': '1d', 'events': 'history'})}"
    response = transport.fetch(url, timeout_seconds=30.0, max_bytes=5_000_000)
    try:
        payload: Any = json.loads(response.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise FxSchemaDrift("YAHOO_INVALID_JSON") from error
    if not isinstance(payload, Mapping):
        raise FxSchemaDrift("YAHOO_INVALID_JSON")
    return parse_yahoo_chart(payload, start=start, end=end)
