from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlencode, urlsplit

from smart_insights.event_contracts import EventCollectionBatch, EventInput
from smart_insights.event_normalization import normalize_event
from smart_insights.http import UrllibTransport
from smart_insights.sources import source_for_code

from .event_common import completed, fetch_event_json, required_str, schema_drift


class GdeltCollector:
    def __init__(self, *, transport: Any | None = None) -> None:
        self.source = source_for_code("gdelt-events")
        self._transport = transport or UrllibTransport()

    def collect(self, *, observed_at: datetime) -> EventCollectionBatch:
        start = observed_at - timedelta(days=1)
        query = urlencode(
            {
                "query": '(shipping OR sanctions OR conflict OR "supply disruption")',
                "mode": "artlist",
                "format": "json",
                "maxrecords": "75",
                "sort": "datedesc",
                "startdatetime": start.strftime("%Y%m%d%H%M%S"),
                "enddatetime": observed_at.strftime("%Y%m%d%H%M%S"),
            }
        )
        request_url = f"{self.source.urls[0]}?{query}"
        fetched = fetch_event_json(
            source=self.source,
            transport=self._transport,
            request_url=request_url,
            observed_at=observed_at,
        )
        if isinstance(fetched, EventCollectionBatch):
            return fetched
        snapshot, payload = fetched
        try:
            rows = payload["articles"] if isinstance(payload, dict) else None
            if not isinstance(rows, list) or len(rows) > 75:
                raise ValueError("rows")
            events = []
            for raw in rows:
                if not isinstance(raw, dict):
                    raise ValueError("row")
                seen = datetime.strptime(required_str(raw.get("seendate")), "%Y%m%dT%H%M%SZ").replace(tzinfo=observed_at.tzinfo)
                provider_url = required_str(raw.get("url"))
                source_url = (
                    provider_url if urlsplit(provider_url).scheme == "https" else None
                )
                events.append(
                    normalize_event(
                        EventInput(
                            source_code=self.source.code,
                            source_event_key=provider_url,
                            category="geopolitical",
                            subcategory="news_corroboration",
                            title=required_str(raw.get("title")),
                            occurred_at=seen,
                            provider_severity=None,
                            country=raw.get("sourcecountry") if isinstance(raw.get("sourcecountry"), str) else None,
                            region=None,
                            latitude=None,
                            longitude=None,
                            affected_count=None,
                            fatalities=None,
                            source_url=source_url,
                            dimensions={
                                "domain": required_str(raw.get("domain")),
                                "language": required_str(raw.get("language")),
                            },
                            quality_flags=(
                                ("article_evidence_only",)
                                if source_url is not None
                                else (
                                    "article_evidence_only",
                                    "non_https_source_url_omitted",
                                )
                            ),
                        ),
                        observed_at,
                    )
                )
        except (KeyError, TypeError, ValueError):
            return schema_drift(self.source, snapshot)
        return completed(self.source, snapshot, events)
