from __future__ import annotations

from dataclasses import FrozenInstanceError
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from smart_insights.contracts import (
    CollectionMode,
    LicenseScope,
    Market,
    ObservationInput,
    RawSnapshot,
    SourceDefinition,
    SourceRunResult,
)
from smart_insights.sources import (
    SOURCE_CODES,
    is_source_url_allowed,
    source_for_code,
    sources_for_schedule,
)


NOW = datetime(2026, 8, 13, tzinfo=timezone.utc)


def test_registry_rejects_unknown_and_non_https_sources() -> None:
    assert source_for_code("alternative-fng").collection_mode is CollectionMode.API
    with pytest.raises(KeyError):
        source_for_code("user-supplied")
    with pytest.raises(ValueError, match="HTTPS"):
        SourceDefinition(
            code="bad",
            name="Bad",
            market=Market.CRYPTO,
            collection_mode=CollectionMode.API,
            license_scope=LicenseScope.RESEARCH_ONLY,
            urls=("http://example.test",),
            schedule="daily",
            freshness_sla_minutes=1_440,
            parser_version="1",
            quality_tier=Decimal("1"),
        )


def test_registry_is_code_owned_disabled_and_quality_weighted() -> None:
    assert SOURCE_CODES == (
        "alternative-fng",
        "bitinfocharts-top-addresses",
        "cftc-disaggregated",
        "cftc-legacy",
        "coinmetrics-community",
        "coinshares-weekly",
        "cryptocraft",
        "defillama-chains",
        "defillama-stablecoins",
        "deribit-public",
        "farside-btc-etf",
        "farside-eth-etf",
        "farside-sol-etf",
        "fred",
        "mempool-space",
        "wgc-central-bank",
        "wgc-gold-etf",
    )
    assert all(not source_for_code(code).enabled for code in SOURCE_CODES)
    assert source_for_code("fred").license_scope is LicenseScope.PUBLIC_OFFICIAL
    assert source_for_code("fred").quality_tier == Decimal("1.00")
    assert source_for_code("farside-btc-etf").quality_tier == Decimal("0.70")
    assert source_for_code("bitinfocharts-top-addresses").quality_tier == Decimal(
        "0.50"
    )
    assert sources_for_schedule("daily") == ()


def test_discovered_links_remain_inside_source_specific_paths() -> None:
    cryptocraft = source_for_code("cryptocraft")
    assert is_source_url_allowed(
        cryptocraft, "https://www.cryptocraft.com/calendar/123-us-cpi"
    )
    assert not is_source_url_allowed(
        cryptocraft, "https://www.cryptocraft.com/news/123-us-cpi"
    )
    assert not is_source_url_allowed(
        cryptocraft, "https://evil.invalid/calendar/123-us-cpi"
    )

    coinshares = source_for_code("coinshares-weekly")
    assert is_source_url_allowed(
        coinshares,
        "https://coinshares.com/insights/research-data/fund-flows-weekly-2026-08-10/",
    )
    assert not is_source_url_allowed(
        coinshares, "https://coinshares.com/company/investor-relations/"
    )

    wgc = source_for_code("wgc-gold-etf")
    assert is_source_url_allowed(
        wgc, "https://www.gold.org/download/file/12345/gold-etf-flows.xlsx"
    )
    assert not is_source_url_allowed(
        wgc, "https://www.gold.org/download/file/12345/gold-etf-flows.pdf"
    )


def test_dimension_key_is_canonical_and_contract_is_frozen() -> None:
    row = ObservationInput(
        metric_code="crypto.etf.net_flow_usd",
        value=Decimal("10"),
        effective_at=NOW,
        dimensions={"fund": "IBIT", "asset": "BTC"},
    )
    assert row.dimension_key == '{"asset":"BTC","fund":"IBIT"}'
    with pytest.raises(FrozenInstanceError):
        row.metric_code = "crypto.changed"  # type: ignore[misc]


def test_observation_period_requires_both_boundaries_and_ends_at_effective_time() -> None:
    with pytest.raises(ValueError, match="both be present"):
        ObservationInput(
            metric_code="macro.calendar.event",
            value=Decimal("1"),
            effective_at=NOW,
            effective_start=NOW - timedelta(hours=1),
        )
    with pytest.raises(ValueError, match="period end"):
        ObservationInput(
            metric_code="macro.calendar.event",
            value=Decimal("1"),
            effective_at=NOW,
            effective_start=NOW - timedelta(hours=2),
            effective_end=NOW - timedelta(hours=1),
        )


def test_snapshot_and_source_run_require_aware_ordered_timestamps() -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        RawSnapshot(
            content=b"{}",
            content_type="application/json",
            source_url="https://example.test/source",
            effective_at=None,
            published_at=None,
            observed_at=datetime(2026, 8, 13),
        )
    with pytest.raises(ValueError, match="before it started"):
        SourceRunResult(
            source_code="alternative-fng",
            status="succeeded",
            records_fetched=1,
            error_code=None,
            retry_count=0,
            started_at=NOW,
            finished_at=NOW - timedelta(seconds=1),
        )
