from __future__ import annotations

from datetime import date, datetime, time, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
from typing import Any
from urllib.parse import urlencode

from smart_insights.contracts import ObservationInput, RawSnapshot
from smart_insights.http import UrllibTransport
from smart_insights.sources import source_for_code

from .energy_common import ContextCollectionBatch


_SERIES = {
    "RBRTE": "macro.energy.brent_usd_bbl",
    "RWTC": "macro.energy.wti_usd_bbl",
}


class EiaEnergyCollector:
    def __init__(self, *, api_key: str | None, transport: Any | None = None) -> None:
        self.source = source_for_code("eia-energy")
        self._api_key = api_key.strip() if api_key else None
        self._transport = transport or UrllibTransport()

    def collect_prices(self, *, start: date, end: date, observed_at: datetime) -> ContextCollectionBatch:
        if not self._api_key:
            return ContextCollectionBatch(self.source.code, None, (), "disabled", "NOT_CONFIGURED")
        if start > end:
            raise ValueError("EIA date range is invalid.")
        query = urlencode(
            [
                ("api_key", self._api_key),
                ("frequency", "daily"),
                ("data[0]", "value"),
                ("facets[series][]", "RBRTE"),
                ("facets[series][]", "RWTC"),
                ("start", start.isoformat()),
                ("end", end.isoformat()),
                ("sort[0][column]", "period"),
                ("sort[0][direction]", "asc"),
                ("offset", "0"),
                ("length", "500"),
            ]
        )
        request_url = f"{self.source.urls[0]}petroleum/pri/spt/data/?{query}"
        response = self._transport.fetch(request_url, timeout_seconds=20, max_bytes=8_000_000)
        snapshot = RawSnapshot(
            content=response.body,
            content_type="application/json",
            source_url=self.source.urls[0],
            effective_at=None,
            published_at=None,
            observed_at=observed_at,
            metadata={
                "content_sha256": hashlib.sha256(response.body).hexdigest(),
                "parser_version": self.source.parser_version,
                "route": "petroleum/pri/spt/data",
            },
        )
        if response.status != 200 or response.url != request_url:
            return ContextCollectionBatch(self.source.code, snapshot, (), "failed", "INVALID_RESPONSE")
        try:
            payload = json.loads(response.body)
            envelope = payload["response"]
            rows = envelope["data"]
            if not isinstance(envelope, dict) or not isinstance(rows, list) or len(rows) > 500:
                raise ValueError("schema")
            observations = []
            for raw in rows:
                if not isinstance(raw, dict):
                    raise ValueError("row")
                series = raw.get("series")
                if series not in _SERIES or raw.get("units") != "dollars per barrel":
                    raise ValueError("series")
                period = date.fromisoformat(str(raw.get("period")))
                value = Decimal(str(raw.get("value")))
                if not value.is_finite():
                    raise ValueError("value")
                observations.append(ObservationInput(
                    metric_code=_SERIES[series],
                    value=value,
                    effective_at=datetime.combine(period, time.min, tzinfo=timezone.utc),
                    dimensions={"provider_series": series, "unit": "USD/barrel"},
                ))
        except (KeyError, TypeError, ValueError, InvalidOperation, json.JSONDecodeError, UnicodeDecodeError):
            return ContextCollectionBatch(self.source.code, snapshot, (), "failed", "SCHEMA_DRIFT")
        return ContextCollectionBatch(self.source.code, snapshot, tuple(observations), "succeeded")
