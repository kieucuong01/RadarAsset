from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import json
import re
from typing import Any
from urllib.parse import parse_qs, urlencode, urlsplit

from smart_insights.contracts import ObservationInput, RawSnapshot
from smart_insights.http import SourceFetchError, UrllibTransport
from smart_insights.sources import source_for_code

from . import CollectionBatch


_METRICS = {
    "AdrActCnt": "crypto.onchain.active_addresses",
    "CapMVRVCur": "crypto.onchain.mvrv",
}
_ALLOWED_QUERY = {
    "assets",
    "metrics",
    "start_time",
    "end_time",
    "frequency",
    "page_size",
    "sort",
    "next_page_token",
}
_NANOSECONDS = re.compile(r"(\.\d{6})\d+(?=Z$|[+-]\d\d:\d\d$)")


def _timestamp(value: object) -> datetime:
    if not isinstance(value, str):
        raise ValueError("INVALID_TIMESTAMP")
    normalized = _NANOSECONDS.sub(r"\1", value).replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as error:
        raise ValueError("INVALID_TIMESTAMP") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("INVALID_TIMESTAMP")
    return parsed.astimezone(timezone.utc)


class CoinMetricsCollector:
    def __init__(self, *, transport: Any | None = None) -> None:
        self.source = source_for_code("coinmetrics-community")
        self._transport = transport or UrllibTransport()

    def collect(self, as_of: datetime) -> CollectionBatch:
        if as_of.tzinfo is None or as_of.utcoffset() is None:
            raise ValueError("as_of must be timezone-aware.")
        cutoff = as_of.astimezone(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        query = urlencode(
            {
                "assets": "btc",
                "metrics": ",".join(_METRICS),
                "start_time": (cutoff - timedelta(days=370)).date().isoformat(),
                "end_time": cutoff.date().isoformat(),
                "frequency": "1d",
                "page_size": "10000",
                "sort": "time",
            }
        )
        next_url: str | None = f"{self.source.urls[0]}?{query}"
        pages: list[dict[str, object]] = []
        parsed_rows: list[tuple[datetime, dict[str, object]]] = []
        last_time: datetime | None = None
        error_code: str | None = None

        for _page_index in range(10):
            if next_url is None:
                break
            response = self._transport.fetch(
                next_url, timeout_seconds=30, max_bytes=10_000_000
            )
            if response.status != 200 or response.url != next_url:
                raise SourceFetchError("INVALID_RESPONSE")
            try:
                payload = json.loads(response.body)
            except (UnicodeDecodeError, json.JSONDecodeError):
                error_code = "INVALID_RESPONSE"
                break
            if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
                error_code = "SCHEMA_DRIFT"
                break
            pages.append(payload)
            for raw in payload["data"]:
                if not isinstance(raw, dict) or raw.get("asset") != "btc":
                    error_code = "SCHEMA_DRIFT"
                    break
                try:
                    effective_at = _timestamp(raw.get("time"))
                except ValueError as error:
                    error_code = str(error)
                    break
                if last_time is not None and effective_at <= last_time:
                    error_code = "PAGINATION_ORDER"
                    break
                last_time = effective_at
                parsed_rows.append((effective_at, raw))
                if len(parsed_rows) > self.source.max_rows:
                    error_code = "RESPONSE_TOO_LARGE"
                    break
            if error_code is not None:
                break
            candidate = payload.get("next_page_url")
            if candidate is None:
                next_url = None
            elif isinstance(candidate, str) and self._valid_next_url(candidate):
                next_url = candidate
            else:
                error_code = "INVALID_PAGINATION"
                break
        else:
            if next_url is not None:
                error_code = "RESPONSE_TOO_LARGE"

        snapshot = RawSnapshot(
            content=json.dumps(
                pages, sort_keys=True, separators=(",", ":")
            ).encode("utf-8"),
            content_type="application/json",
            source_url=self.source.urls[0],
            effective_at=None,
            published_at=None,
            observed_at=as_of,
            metadata={
                "provider_metrics": tuple(_METRICS),
                "frequency": "1d",
                "page_count": len(pages),
                "parser_version": self.source.parser_version,
            },
        )
        if error_code is not None:
            return CollectionBatch(self.source, snapshot, (), error_code)

        observations: list[ObservationInput] = []
        for effective_at, raw in parsed_rows:
            if effective_at >= cutoff:
                continue
            if effective_at != effective_at.replace(
                hour=0, minute=0, second=0, microsecond=0
            ):
                return CollectionBatch(self.source, snapshot, (), "INVALID_TIMESTAMP")
            for provider_metric, metric_code in _METRICS.items():
                raw_value = raw.get(provider_metric)
                if raw_value is None:
                    continue
                try:
                    value = Decimal(str(raw_value))
                except InvalidOperation:
                    return CollectionBatch(self.source, snapshot, (), "INVALID_VALUE")
                if not value.is_finite():
                    return CollectionBatch(self.source, snapshot, (), "INVALID_VALUE")
                observations.append(
                    ObservationInput(
                        metric_code=metric_code,
                        value=value,
                        effective_at=effective_at,
                        asset_symbol="BTC",
                        dimensions={
                            "provider_metric": provider_metric,
                            "frequency": "daily",
                        },
                    )
                )
        return CollectionBatch(self.source, snapshot, tuple(observations))

    def _valid_next_url(self, url: str) -> bool:
        base = urlsplit(self.source.urls[0])
        parsed = urlsplit(url)
        query = parse_qs(parsed.query, keep_blank_values=True)
        return (
            parsed.scheme == "https"
            and parsed.hostname == base.hostname
            and parsed.path == base.path
            and not parsed.username
            and not parsed.password
            and not parsed.fragment
            and "next_page_token" in query
            and set(query) <= _ALLOWED_QUERY
        )
