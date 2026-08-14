from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

from smart_insights.http import HttpResponse


NOW = datetime(2026, 8, 14, 12, tzinfo=timezone.utc)
FIXTURES = Path(__file__).parent / "fixtures" / "smart_insights" / "events"


class FakeTransport:
    def __init__(self, body: bytes, *, status: int = 200) -> None:
        self.body = body
        self.status = status
        self.calls: list[tuple[str, float, int]] = []

    def fetch(self, url: str, *, timeout_seconds: float, max_bytes: int) -> HttpResponse:
        self.calls.append((url, timeout_seconds, max_bytes))
        return HttpResponse(
            status=self.status,
            headers={"content-type": "application/json"},
            body=self.body,
            url=url,
        )


@pytest.mark.parametrize(
    ("module_name", "class_name", "fixture_name", "source_code"),
    (
        ("gdelt", "GdeltCollector", "gdelt.json", "gdelt-events"),
        ("gdacs", "GdacsCollector", "gdacs.json", "gdacs-events"),
        ("usgs", "UsgsCollector", "usgs.json", "usgs-earthquakes"),
        ("eonet", "EonetCollector", "eonet.json", "nasa-eonet"),
    ),
)
def test_event_collectors_preserve_raw_payload_and_normalize_provider_ids(
    module_name: str, class_name: str, fixture_name: str, source_code: str
) -> None:
    module = __import__(f"smart_insights.collectors.{module_name}", fromlist=[class_name])
    collector_type = getattr(module, class_name)
    body = (FIXTURES / fixture_name).read_bytes()
    transport = FakeTransport(body)

    batch = collector_type(transport=transport).collect(observed_at=NOW)

    assert batch.source_code == source_code
    assert batch.error_code is None
    assert len(batch.events) == 1
    assert batch.events[0].source_event_key
    assert batch.events[0].occurred_at.tzinfo is not None
    assert batch.snapshot.content == body
    assert batch.snapshot.metadata["content_sha256"] == hashlib.sha256(body).hexdigest()
    assert batch.snapshot.metadata["parser_version"].endswith("-v1")
    request_url, timeout, max_bytes = transport.calls[0]
    assert request_url.startswith("https://")
    assert 0 < timeout <= 30
    assert 0 < max_bytes <= 10_000_000


def test_event_collector_urls_are_bounded_and_non_secret() -> None:
    from smart_insights.collectors.eonet import EonetCollector
    from smart_insights.collectors.gdacs import GdacsCollector
    from smart_insights.collectors.gdelt import GdeltCollector
    from smart_insights.collectors.usgs import UsgsCollector

    cases = (
        (GdeltCollector, "gdelt.json", {"query", "mode", "format", "maxrecords", "sort", "startdatetime", "enddatetime"}),
        (GdacsCollector, "gdacs.json", {"eventlist", "fromdate", "todate", "alertlevel", "limit"}),
        (UsgsCollector, "usgs.json", {"format", "starttime", "endtime", "minmagnitude", "limit", "orderby"}),
        (EonetCollector, "eonet.json", {"status", "days", "limit"}),
    )
    for collector_type, fixture_name, expected_keys in cases:
        transport = FakeTransport((FIXTURES / fixture_name).read_bytes())
        collector_type(transport=transport).collect(observed_at=NOW)
        query = parse_qs(urlsplit(transport.calls[0][0]).query)
        assert set(query) == expected_keys
        assert all("key" not in key.casefold() and "token" not in key.casefold() for key in query)


@pytest.mark.parametrize(
    ("module_name", "class_name"),
    (
        ("gdelt", "GdeltCollector"),
        ("gdacs", "GdacsCollector"),
        ("usgs", "UsgsCollector"),
        ("eonet", "EonetCollector"),
    ),
)
def test_event_collectors_reject_partial_schema_drift(
    module_name: str, class_name: str
) -> None:
    module = __import__(f"smart_insights.collectors.{module_name}", fromlist=[class_name])
    collector_type = getattr(module, class_name)
    transport = FakeTransport(b'{"articles":[{"id":null}],"events":[{"id":null}],"features":[{}]}')

    batch = collector_type(transport=transport).collect(observed_at=NOW)

    assert batch.events == ()
    assert batch.error_code == "SCHEMA_DRIFT"


def test_gdelt_omits_non_https_article_link_without_losing_the_observation() -> None:
    from smart_insights.collectors.gdelt import GdeltCollector

    payload = json.loads((FIXTURES / "gdelt.json").read_bytes())
    payload["articles"][0]["url"] = "http://example.org/news/red-sea-shipping-disruption"
    batch = GdeltCollector(transport=FakeTransport(json.dumps(payload).encode())).collect(
        observed_at=NOW
    )

    assert batch.error_code is None
    assert batch.events[0].source_url is None
    assert "non_https_source_url_omitted" in batch.events[0].quality_flags


def test_gdacs_marks_provider_timestamp_without_offset_as_assumed_utc() -> None:
    from smart_insights.collectors.gdacs import GdacsCollector

    payload = json.loads((FIXTURES / "gdacs.json").read_bytes())
    payload["features"][0]["properties"]["fromdate"] = "2026-08-13T03:15:00"
    batch = GdacsCollector(transport=FakeTransport(json.dumps(payload).encode())).collect(
        observed_at=NOW
    )

    assert batch.error_code is None
    assert batch.events[0].occurred_at.tzinfo is not None
    assert "provider_timezone_assumed_utc" in batch.events[0].quality_flags
