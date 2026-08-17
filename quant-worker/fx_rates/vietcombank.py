from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import json
from typing import Any
from urllib.parse import urlencode

from smart_insights.http import UrllibTransport


SOURCE = "vietcombank"
SOURCE_URL = "https://www.vietcombank.com.vn/api/exchangerates"


class FxSchemaDrift(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class FxObservation:
    effective_date: date
    transfer_buy: Decimal
    sell: Decimal
    mid: Decimal
    source: str
    fetched_at: datetime


def _decimal(value: object) -> Decimal:
    if not isinstance(value, (str, int, float, Decimal)) or isinstance(value, bool):
        raise FxSchemaDrift("USD_RATE_INVALID")
    try:
        parsed = Decimal(str(value).replace(",", "").strip())
    except (InvalidOperation, ValueError) as error:
        raise FxSchemaDrift("USD_RATE_INVALID") from error
    if not parsed.is_finite() or parsed <= 0:
        raise FxSchemaDrift("USD_RATE_INVALID")
    return parsed


def _provider_date(value: object) -> date:
    if not isinstance(value, str):
        raise FxSchemaDrift("PROVIDER_DATE_INVALID")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError as error:
        raise FxSchemaDrift("PROVIDER_DATE_INVALID") from error


def parse_vietcombank_response(
    payload: Mapping[str, object],
    *,
    requested_date: date,
    fetched_at: datetime | None = None,
) -> FxObservation:
    effective_date = _provider_date(payload.get("Date"))
    if effective_date > requested_date:
        raise FxSchemaDrift("PROVIDER_DATE_AFTER_REQUEST")
    rows = payload.get("Data")
    if not isinstance(rows, Sequence) or isinstance(rows, (str, bytes)):
        raise FxSchemaDrift("DATA_INVALID")
    usd = next(
        (
            row
            for row in rows
            if isinstance(row, Mapping)
            and str(row.get("currencyCode", "")).strip().upper() == "USD"
        ),
        None,
    )
    if usd is None:
        raise FxSchemaDrift("USD_RATE_MISSING")
    transfer_buy = _decimal(usd.get("transfer"))
    sell = _decimal(usd.get("sell"))
    return FxObservation(
        effective_date=effective_date,
        transfer_buy=transfer_buy,
        sell=sell,
        mid=(transfer_buy + sell) / Decimal("2"),
        source=SOURCE,
        fetched_at=fetched_at or datetime.now(timezone.utc),
    )


def fetch_day(
    transport: UrllibTransport,
    requested_date: date,
) -> FxObservation:
    url = f"{SOURCE_URL}?{urlencode({'date': requested_date.isoformat()})}"
    response = transport.fetch(url, timeout_seconds=20.0, max_bytes=1_000_000)
    try:
        payload: Any = json.loads(response.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise FxSchemaDrift("INVALID_JSON") from error
    if not isinstance(payload, Mapping):
        raise FxSchemaDrift("INVALID_JSON")
    return parse_vietcombank_response(payload, requested_date=requested_date)


def backfill_window(today: date) -> tuple[date, date]:
    try:
        start = today.replace(year=today.year - 10)
    except ValueError:
        start = today.replace(year=today.year - 10, day=28)
    return start, today


def inclusive_dates(start: date, end: date) -> list[date]:
    if end < start:
        raise ValueError("End date must not precede start date.")
    return [
        current
        for offset in range((end - start).days + 1)
        if (current := start + timedelta(days=offset)).weekday() < 5
    ]
