from __future__ import annotations

from datetime import date, datetime, timezone
from pathlib import Path

from smart_insights.http import HttpResponse


NOW = datetime(2026, 8, 14, 12, tzinfo=timezone.utc)
FIXTURES = Path(__file__).parent / "fixtures" / "smart_insights" / "macro"


class FakeTransport:
    def __init__(self, body: bytes, *, content_type: str) -> None:
        self.body = body
        self.content_type = content_type
        self.calls: list[str] = []

    def fetch(self, url: str, *, timeout_seconds: float, max_bytes: int) -> HttpResponse:
        assert 0 < timeout_seconds <= 30
        assert 0 < max_bytes <= 10_000_000
        self.calls.append(url)
        return HttpResponse(200, {"content-type": self.content_type}, self.body, url)


def test_eia_missing_key_is_not_configured_without_network_request() -> None:
    from smart_insights.collectors.eia import EiaEnergyCollector

    transport = FakeTransport(b"should not be used", content_type="application/json")
    result = EiaEnergyCollector(api_key=None, transport=transport).collect_prices(
        start=date(2026, 8, 1), end=date(2026, 8, 14), observed_at=NOW
    )

    assert result.status == "disabled"
    assert result.error_code == "NOT_CONFIGURED"
    assert result.snapshot is None
    assert transport.calls == []


def test_eia_parses_allowlisted_series_units_and_redacts_key_from_snapshot() -> None:
    from smart_insights.collectors.eia import EiaEnergyCollector

    transport = FakeTransport((FIXTURES / "eia-prices.json").read_bytes(), content_type="application/json")
    result = EiaEnergyCollector(api_key="private-test-key", transport=transport).collect_prices(
        start=date(2026, 8, 1), end=date(2026, 8, 14), observed_at=NOW
    )

    assert result.status == "succeeded"
    assert result.error_code is None
    assert {row.metric_code for row in result.observations} == {"macro.energy.brent_usd_bbl", "macro.energy.wti_usd_bbl"}
    assert all(row.dimensions["unit"] == "USD/barrel" for row in result.observations)
    assert result.snapshot is not None
    assert "private-test-key" not in result.snapshot.source_url
    assert "private-test-key" not in str(result.snapshot.metadata)
    assert "api_key=private-test-key" in transport.calls[0]


def test_bis_parses_fixed_sdmx_csv_as_context_only() -> None:
    from smart_insights.collectors.bis import BisCollector

    transport = FakeTransport((FIXTURES / "bis-cpi.csv").read_bytes(), content_type="text/csv")
    result = BisCollector(transport=transport).collect_context(observed_at=NOW)

    assert result.status == "succeeded"
    assert len(result.observations) == 2
    assert all(row.dimensions["evidence_only"] == "true" for row in result.observations)
    assert all(row.effective_at.tzinfo is not None for row in result.observations)
