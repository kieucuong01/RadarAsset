from __future__ import annotations

from collections.abc import Callable
import csv
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_EVEN
from io import StringIO
import json
from typing import Any
from urllib.parse import urlencode

from smart_insights.contracts import ObservationInput, RawSnapshot
from smart_insights.http import SourceFetchError, UrllibTransport
from smart_insights.macro_registry import CFTC_MARKETS, CftcMarketDefinition
from smart_insights.sources import source_for_code

from . import CollectionBatch


_RATIO_QUANTUM = Decimal("0.0000000001")


def _report_date(value: object) -> datetime:
    if not isinstance(value, str):
        raise ValueError("INVALID_TIMESTAMP")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("INVALID_TIMESTAMP") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )


def _number(value: object) -> Decimal:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError) as error:
        raise ValueError("INVALID_VALUE") from error
    if not number.is_finite():
        raise ValueError("INVALID_VALUE")
    return number


class CftcCollector:
    def __init__(
        self,
        *,
        transport: Any | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._transport = transport or UrllibTransport()
        self._clock = clock or (lambda: datetime.now(timezone.utc))

    def collect(
        self, market: CftcMarketDefinition, *, report_date_from: date
    ) -> CollectionBatch:
        if CFTC_MARKETS.get(market.market_code) != market:
            raise ValueError("CFTC market must be allow-listed.")
        source = source_for_code(market.source_code)
        if market.classification == "noncommercial":
            long_field = "noncomm_positions_long_all"
            short_field = "noncomm_positions_short_all"
        elif market.classification == "managed_money":
            long_field = "m_money_positions_long_all"
            short_field = "m_money_positions_short_all"
        else:
            raise ValueError("CFTC classification is not supported.")
        fields = (
            "market_and_exchange_names",
            "report_date_as_yyyy_mm_dd",
            "cftc_contract_market_code",
            "open_interest_all",
            long_field,
            short_field,
            "futonly_or_combined",
        )
        where = (
            f"cftc_contract_market_code='{market.contract_market_code}' "
            f"AND report_date_as_yyyy_mm_dd>='{report_date_from.isoformat()}T00:00:00.000' "
            "AND futonly_or_combined='FutOnly'"
        )
        query = urlencode(
            {
                "$select": ",".join(fields),
                "$where": where,
                "$order": "report_date_as_yyyy_mm_dd ASC",
                "$limit": "5000",
            }
        )
        request_url = f"{source.urls[0]}?{query}"
        source_url = source.urls[0]
        csv_fallback = False
        try:
            response = self._transport.fetch(
                request_url, timeout_seconds=30, max_bytes=10_000_000
            )
        except SourceFetchError:
            if source.code != "cftc-disaggregated" or len(source.urls) < 2:
                raise
            source_url = source.urls[1]
            response = self._transport.fetch(
                source_url, timeout_seconds=30, max_bytes=10_000_000
            )
            csv_fallback = True
        if response.status != 200 or response.url != request_url:
            if not csv_fallback or response.url != source_url:
                raise SourceFetchError("INVALID_RESPONSE")
        observed_at = self._clock()
        snapshot = RawSnapshot(
            content=response.body,
            content_type="text/csv" if csv_fallback else "application/json",
            source_url=source_url,
            effective_at=None,
            published_at=None,
            observed_at=observed_at,
            metadata={
                "dataset_id": market.dataset_id,
                "classification": market.classification,
                "contract_market_code": market.contract_market_code,
                "report_type": "FutOnly",
                "parser_version": source.parser_version,
            },
        )
        if csv_fallback:
            try:
                records = tuple(csv.reader(StringIO(response.body.decode("utf-8-sig"))))
            except (UnicodeDecodeError, csv.Error):
                return CollectionBatch(source, snapshot, (), "INVALID_RESPONSE")
            if any(len(record) != 191 for record in records):
                return CollectionBatch(source, snapshot, (), "SCHEMA_DRIFT")
            rows = [
                {
                    "market_and_exchange_names": record[0],
                    "report_date_as_yyyy_mm_dd": record[2],
                    "cftc_contract_market_code": record[3],
                    "open_interest_all": record[7],
                    "m_money_positions_long_all": record[13],
                    "m_money_positions_short_all": record[14],
                    "futonly_or_combined": record[190],
                }
                for record in records
                if record[3] == market.contract_market_code
            ]
        else:
            try:
                rows = json.loads(response.body)
            except (UnicodeDecodeError, json.JSONDecodeError):
                return CollectionBatch(source, snapshot, (), "INVALID_RESPONSE")
        if not isinstance(rows, list):
            return CollectionBatch(source, snapshot, (), "SCHEMA_DRIFT")
        if len(rows) > 5_000:
            return CollectionBatch(source, snapshot, (), "RESPONSE_TOO_LARGE")
        observations: list[ObservationInput] = []
        seen_dates: set[datetime] = set()
        for raw in rows:
            if not isinstance(raw, dict):
                return CollectionBatch(source, snapshot, (), "SCHEMA_DRIFT")
            if raw.get("futonly_or_combined") != "FutOnly":
                return CollectionBatch(source, snapshot, (), "UNEXPECTED_REPORT_TYPE")
            if raw.get("cftc_contract_market_code") != market.contract_market_code:
                return CollectionBatch(source, snapshot, (), "UNEXPECTED_CONTRACT")
            try:
                effective_at = _report_date(raw.get("report_date_as_yyyy_mm_dd"))
                open_interest = _number(raw.get("open_interest_all"))
                long_position = _number(raw.get(long_field))
                short_position = _number(raw.get(short_field))
            except ValueError as error:
                return CollectionBatch(source, snapshot, (), str(error))
            if effective_at.date() < report_date_from:
                return CollectionBatch(source, snapshot, (), "OUT_OF_RANGE")
            if effective_at in seen_dates:
                return CollectionBatch(source, snapshot, (), "DUPLICATE_PERIOD")
            seen_dates.add(effective_at)
            if open_interest <= 0 or long_position < 0 or short_position < 0:
                return CollectionBatch(source, snapshot, (), "INVALID_VALUE")
            net_position = long_position - short_position
            net_oi = (net_position / open_interest).quantize(
                _RATIO_QUANTUM, rounding=ROUND_HALF_EVEN
            )
            dimensions = {
                "market": market.market_code,
                "contract_market_code": market.contract_market_code,
                "contract_name": str(raw.get("market_and_exchange_names", "")),
                "dataset_id": market.dataset_id,
                "classification": market.classification,
                "report_type": "FutOnly",
            }
            for metric_code, value in (
                (f"{market.metric_prefix}.open_interest", open_interest),
                (f"{market.metric_prefix}.long_contracts", long_position),
                (f"{market.metric_prefix}.short_contracts", short_position),
                (f"{market.metric_prefix}.net_contracts", net_position),
                (market.net_oi_metric, net_oi),
            ):
                observations.append(
                    ObservationInput(
                        metric_code=metric_code,
                        value=value,
                        effective_at=effective_at,
                        dimensions=dimensions,
                    )
                )
        return CollectionBatch(source, snapshot, tuple(observations))
