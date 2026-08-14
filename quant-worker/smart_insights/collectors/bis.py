from __future__ import annotations

import csv
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, InvalidOperation
import hashlib
from io import StringIO
from typing import Any

from smart_insights.contracts import ObservationInput, RawSnapshot
from smart_insights.http import UrllibTransport
from smart_insights.sources import source_for_code

from .energy_common import ContextCollectionBatch


def _month_end(value: str) -> datetime:
    year_text, month_text = value.split("-", 1)
    year, month = int(year_text), int(month_text)
    if month not in range(1, 13):
        raise ValueError("month")
    if month == 12:
        end = date(year, 12, 31)
    else:
        end = date(year, month + 1, 1) - timedelta(days=1)
    return datetime.combine(end, time.min, tzinfo=timezone.utc)


class BisCollector:
    def __init__(self, *, transport: Any | None = None) -> None:
        self.source = source_for_code("bis-statistics")
        self._transport = transport or UrllibTransport()

    def collect_context(self, *, observed_at: datetime) -> ContextCollectionBatch:
        start_period = f"{observed_at.year - 5}-01"
        request_url = (
            "https://stats.bis.org/api/v1/data/WS_LONG_CPI/M.US.771/all"
            f"?startPeriod={start_period}&format=csvfile"
        )
        response = self._transport.fetch(request_url, timeout_seconds=20, max_bytes=8_000_000)
        snapshot = RawSnapshot(
            content=response.body,
            content_type="text/csv",
            source_url=self.source.urls[0],
            effective_at=None,
            published_at=None,
            observed_at=observed_at,
            metadata={
                "content_sha256": hashlib.sha256(response.body).hexdigest(),
                "parser_version": self.source.parser_version,
                "flow": "WS_LONG_CPI",
            },
        )
        if response.status != 200 or response.url != request_url:
            return ContextCollectionBatch(self.source.code, snapshot, (), "failed", "INVALID_RESPONSE")
        try:
            text = response.body.decode("utf-8-sig")
            rows = list(csv.DictReader(StringIO(text)))
            if not rows or len(rows) > self.source.max_rows:
                raise ValueError("rows")
            observations = []
            for raw in rows:
                if set(("FREQ", "REF_AREA", "UNIT_MEASURE", "TIME_PERIOD", "OBS_VALUE")) - set(raw):
                    raise ValueError("columns")
                if raw["FREQ"] != "M" or raw["REF_AREA"] != "US" or raw["UNIT_MEASURE"] != "771":
                    raise ValueError("series")
                if raw["OBS_VALUE"] == "NaN":
                    continue
                value = Decimal(raw["OBS_VALUE"])
                if not value.is_finite():
                    raise ValueError("value")
                observations.append(ObservationInput(
                    metric_code="macro.bis.us_cpi_yoy_pct",
                    value=value,
                    effective_at=_month_end(raw["TIME_PERIOD"]),
                    dimensions={
                        "provider_flow": "WS_LONG_CPI",
                        "unit": "% YoY",
                        "evidence_only": "true",
                    },
                ))
        except (KeyError, TypeError, ValueError, InvalidOperation, UnicodeDecodeError):
            return ContextCollectionBatch(self.source.code, snapshot, (), "failed", "SCHEMA_DRIFT")
        return ContextCollectionBatch(self.source.code, snapshot, tuple(observations), "succeeded")
