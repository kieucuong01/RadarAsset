from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from smart_insights.collectors.gdacs import GdacsCollector
from smart_insights.event_repository import EventRepository
from smart_insights.http import HttpResponse


NOW = datetime(2026, 8, 14, 12, tzinfo=timezone.utc)
FIXTURE = Path(__file__).parent / "fixtures" / "smart_insights" / "events" / "gdacs.json"


class FakeTransport:
    def fetch(self, url: str, *, timeout_seconds: float, max_bytes: int) -> HttpResponse:
        return HttpResponse(200, {"content-type": "application/json"}, FIXTURE.read_bytes(), url)


def test_event_pipeline_links_raw_normalized_cluster_score_impact_and_health() -> None:
    from smart_insights.macro_pipeline import process_global_event_batch

    batch = GdacsCollector(transport=FakeTransport()).collect(observed_at=NOW)
    result = process_global_event_batch(
        EventRepository(),
        batch,
        frequency_anomaly=70.0,
        market_stress=60.0,
    )

    assert batch.snapshot.metadata["content_sha256"]
    assert result.publication.inserted == 1
    assert len(result.clusters) == 1
    assert result.risk.status == "AVAILABLE"
    assert result.risk.value is not None
    assert {impact.asset for impact in result.asset_impacts} == {"BTC", "XAU"}
    assert result.source_health.status == "healthy"
    assert result.source_health.records_fetched == 1


def test_normal_scheduler_selects_only_sources_that_passed_the_full_live_gate() -> None:
    import collect_smart_insights

    daily = {source.code for source in collect_smart_insights.select_sources("daily")}
    weekly = {source.code for source in collect_smart_insights.select_sources("weekly")}

    assert {"gdacs-events", "usgs-earthquakes", "nasa-eonet"} <= daily
    assert "bis-statistics" in weekly
    assert "gdelt-events" not in daily
    assert "eia-energy" not in daily


def test_event_sources_are_available_to_explicit_live_smoke() -> None:
    import collect_smart_insights

    collectors = collect_smart_insights.build_event_collectors(transport=FakeTransport())
    outcome = collect_smart_insights.run_event_live_smoke(
        "gdacs-events", as_of=NOW, event_collectors=collectors
    )

    assert outcome.status == "succeeded"
    assert outcome.records_fetched == 1
    assert outcome.effective_at is not None


def test_every_enabled_event_or_context_source_has_a_scheduler_handler() -> None:
    import collect_smart_insights

    event_handlers = set(collect_smart_insights.build_event_collectors())
    batch_handlers = set(collect_smart_insights.build_batch_collectors())

    assert {"gdacs-events", "usgs-earthquakes", "nasa-eonet"} <= event_handlers
    assert "bis-statistics" in batch_handlers
