from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from smart_insights.metrics.common import (
    ConfidenceInput,
    InsufficientCoverageError,
    RevisionedValue,
    annualized_volatility,
    data_confidence,
    drawdown,
    empirical_percentile,
    latest_revision_as_of,
    rolling_z_score,
    signed_percentile_score,
    simple_return,
    weighted_score,
)
from smart_insights.metrics.crypto import (
    COMPONENT_WEIGHTS,
    CRYPTO_GROUP_COMPONENTS,
    METRIC_DEFINITIONS_BY_CODE,
)
from smart_insights.metrics import crypto as crypto_metrics
from smart_insights.signals import MetricSignalInput, detect_signals


NOW = datetime(2026, 8, 13, tzinfo=timezone.utc)


def test_large_address_metric_contract_is_registered() -> None:
    expected = {
        "crypto.large_address.confirmed_balance_btc": "BTC",
        "crypto.large_address.net_accumulation_btc": "BTC",
        "crypto.large_address.accumulation_breadth": "ratio",
        "crypto.large_address.distribution_breadth": "ratio",
        "crypto.large_address.to_exchange_btc": "BTC",
        "crypto.large_address.from_exchange_btc": "BTC",
        "crypto.large_address.exchange_flow_pressure_btc": "BTC",
        "crypto.large_address.dormant_to_exchange_btc": "BTC",
        "crypto.large_address.dormant_from_exchange_btc": "BTC",
        "crypto.large_address.top10_concentration": "ratio",
        "crypto.large_address.address_coverage": "ratio",
        "crypto.large_address.transaction_coverage": "ratio",
        "crypto.large_address.flow_label_coverage": "ratio",
    }

    assert {
        code: METRIC_DEFINITIONS_BY_CODE[code].unit for code in expected
    } == expected
    assert {
        METRIC_DEFINITIONS_BY_CODE[code].metadata["source"] for code in expected
    } == {"mempool-btc-large-addresses"}


def test_crawled_cycle_and_derivative_metrics_are_evidence_only() -> None:
    cbbi_components = {
        "PiCycle": "pi_cycle",
        "RUPL": "rupl_nupl",
        "RHODL": "rhodl",
        "Puell": "puell",
        "2YMA": "two_year_ma",
        "Trolololo": "trolololo",
        "MVRV": "mvrv",
        "ReserveRisk": "reserve_risk",
        "Woobull": "woobull",
    }
    assert getattr(crypto_metrics, "CBBI_COMPONENTS", None) == cbbi_components
    expected = {
        "crypto.derivatives.margin_borrow.annualized_rate": ("percent", "coinglass-margin-borrow"),
        "crypto.derivatives.margin_borrow.daily_rate": ("percent", "coinglass-margin-borrow"),
        "crypto.derivatives.margin_borrow.hourly_rate": ("percent", "coinglass-margin-borrow"),
        "crypto.derivatives.liquidation.current_price_usd": ("USD", "coinglass-liquidation-maxpain"),
        "crypto.derivatives.liquidation.long_max_pain_price_usd": ("USD", "coinglass-liquidation-maxpain"),
        "crypto.derivatives.liquidation.short_max_pain_price_usd": ("USD", "coinglass-liquidation-maxpain"),
        "crypto.derivatives.liquidation.long_max_pain_level_usd": ("USD", "coinglass-liquidation-maxpain"),
        "crypto.derivatives.liquidation.short_max_pain_level_usd": ("USD", "coinglass-liquidation-maxpain"),
        "crypto.derivatives.liquidation.long_distance_ratio": ("ratio", "coinglass-liquidation-maxpain"),
        "crypto.derivatives.liquidation.short_distance_ratio": ("ratio", "coinglass-liquidation-maxpain"),
        "crypto.cycle.altcoin_season.index": ("index", "blockchaincenter-altcoin-season"),
        "crypto.cycle.cbbi.confidence": ("percent", "cbbi-public"),
        **{
            f"crypto.cycle.cbbi.component.{slug}": ("percent", "cbbi-public")
            for slug in cbbi_components.values()
        },
    }

    for code, (unit, source) in expected.items():
        definition = METRIC_DEFINITIONS_BY_CODE[code]
        assert definition.unit == unit
        assert definition.direction == 0
        assert definition.metadata["source"] == source
        assert definition.metadata["evidence_only"] is True
        assert code not in COMPONENT_WEIGHTS
        assert all(code not in components for components in CRYPTO_GROUP_COMPONENTS.values())


def metric(
    code: str,
    *,
    value: str,
    z: str | None = None,
    percentile: str | None = None,
    effective_at: datetime = NOW,
    trailing_deviation: str | None = None,
    regime_label: str | None = None,
    source_conflict: bool = False,
    is_fresh: bool = True,
    score_visible: bool = True,
) -> MetricSignalInput:
    return MetricSignalInput(
        metric_code=code,
        market="crypto",
        asset_symbol=None,
        effective_at=effective_at,
        value=Decimal(value),
        z_score=Decimal(z) if z is not None else None,
        percentile=Decimal(percentile) if percentile is not None else None,
        trailing_deviation=(
            Decimal(trailing_deviation) if trailing_deviation is not None else None
        ),
        regime_label=regime_label,
        source_conflict=source_conflict,
        is_fresh=is_fresh,
        score_visible=score_visible,
        methodology_version="crypto-regime-v1",
    )


def test_percentile_score_and_missing_coverage_are_deterministic() -> None:
    history = tuple(Decimal(value) for value in ("1", "2", "3", "4", "5"))

    assert empirical_percentile(history, Decimal("5")) == Decimal("1.000000")
    assert signed_percentile_score(Decimal("1"), direction=-1) == Decimal(
        "-100.000000"
    )
    with pytest.raises(InsufficientCoverageError):
        weighted_score(
            {"flow": None, "momentum": Decimal("50")},
            {"flow": Decimal("0.8"), "momentum": Decimal("0.2")},
            minimum_coverage=Decimal("0.6"),
        )


def test_weighted_score_renormalizes_only_after_coverage_gate() -> None:
    assert weighted_score(
        {"flow": Decimal("80"), "momentum": None, "sentiment": Decimal("-20")},
        {
            "flow": Decimal("0.6"),
            "momentum": Decimal("0.2"),
            "sentiment": Decimal("0.2"),
        },
        minimum_coverage=Decimal("0.6"),
    ) == Decimal("55.000000")


def test_returns_volatility_and_drawdown_use_crypto_conventions() -> None:
    assert simple_return(Decimal("100"), Decimal("110")) == Decimal("0.100000")
    assert drawdown(
        tuple(Decimal(value) for value in ("100", "125", "120", "100"))
    ) == Decimal("-0.200000")

    volatility = annualized_volatility(
        tuple(Decimal(value) for value in ("100", "110", "99", "118.8")),
        periods_per_year=365,
    )
    assert volatility is not None
    assert volatility == Decimal("2.818665")


def test_invalid_windows_and_zero_variance_do_not_invent_scores() -> None:
    assert rolling_z_score((Decimal("4"), Decimal("4")), Decimal("5")) is None
    assert rolling_z_score((Decimal("4"),), Decimal("5")) is None
    assert annualized_volatility((Decimal("100"), Decimal("101"))) is None
    assert drawdown(()) is None

    with pytest.raises(ValueError):
        empirical_percentile((), Decimal("1"))
    with pytest.raises(ValueError):
        simple_return(Decimal("0"), Decimal("1"))
    with pytest.raises(ValueError):
        annualized_volatility(
            (Decimal("100"), Decimal("0"), Decimal("110")), periods_per_year=365
        )


def test_latest_revision_as_of_excludes_future_knowledge() -> None:
    rows = (
        RevisionedValue(
            observed_at=NOW - timedelta(hours=2), revision=1, value=Decimal("10")
        ),
        RevisionedValue(
            observed_at=NOW + timedelta(hours=1), revision=2, value=Decimal("12")
        ),
        RevisionedValue(
            observed_at=NOW - timedelta(hours=1), revision=2, value=Decimal("11")
        ),
    )

    selected = latest_revision_as_of(rows, as_of=NOW)

    assert selected is not None
    assert selected.value == Decimal("11")
    assert selected.observed_at <= NOW


def test_confidence_applies_quality_freshness_validation_and_coverage() -> None:
    rows = {
        "official": ConfidenceInput(
            configured_weight=Decimal("0.6"),
            quality_tier=Decimal("1"),
            age_minutes=Decimal("0"),
            freshness_sla_minutes=Decimal("1440"),
            validation_status="passed",
        ),
        "community": ConfidenceInput(
            configured_weight=Decimal("0.4"),
            quality_tier=Decimal("0.85"),
            age_minutes=Decimal("720"),
            freshness_sla_minutes=Decimal("1440"),
            validation_status="warning",
        ),
    }

    assert data_confidence(rows) == Decimal("77.85")

    stale = ConfidenceInput(
        configured_weight=Decimal("1"),
        quality_tier=Decimal("1"),
        age_minutes=Decimal("1441"),
        freshness_sla_minutes=Decimal("1440"),
        validation_status="passed",
    )
    assert data_confidence({"stale": stale}) == Decimal("0.00")

    with pytest.raises(ValueError):
        data_confidence(
            {
                "future": ConfidenceInput(
                    configured_weight=Decimal("1"),
                    quality_tier=Decimal("1"),
                    age_minutes=Decimal("-1"),
                    freshness_sla_minutes=Decimal("1440"),
                    validation_status="passed",
                )
            }
        )


def test_signal_thresholds_do_not_fire_twice() -> None:
    first = detect_signals(
        metric("flow", z="2.1", percentile="0.98", value="5"), previous=None
    )
    second = detect_signals(
        metric("flow", z="2.2", percentile="0.99", value="6"),
        previous=metric("flow", z="2.1", percentile="0.98", value="5"),
    )

    assert [row.kind for row in first] == ["zscore_extreme", "percentile_extreme"]
    assert second == ()
    assert len({row.idempotency_key for row in first}) == 2


def test_flow_sign_regime_conflict_and_freshness_transitions_are_explicit() -> None:
    flow = detect_signals(
        metric("crypto.etf.net_flow_usd", value="-5", trailing_deviation="4"),
        previous=metric("crypto.etf.net_flow_usd", value="3"),
    )
    assert [row.kind for row in flow] == ["flow_sign_change"]

    regime = detect_signals(
        metric("crypto.regime", value="25", regime_label="risk_on"),
        previous=metric("crypto.regime", value="-10", regime_label="neutral"),
    )
    assert [row.kind for row in regime] == ["regime_label_change"]

    conflict = detect_signals(metric("flow", value="5", source_conflict=True))
    assert [row.kind for row in conflict] == ["source_conflict"]

    stale = detect_signals(
        metric("crypto.regime", value="25", is_fresh=False, score_visible=False),
        previous=metric("crypto.regime", value="25", is_fresh=True),
    )
    assert [row.kind for row in stale] == ["freshness_transition"]


def test_below_magnitude_flow_change_and_unchanged_regime_do_not_signal() -> None:
    assert detect_signals(
        metric("flow", value="-2", trailing_deviation="4"),
        previous=metric("flow", value="1"),
    ) == ()
    assert detect_signals(
        metric("crypto.regime", value="20", regime_label="risk_on"),
        previous=metric("crypto.regime", value="10", regime_label="risk_on"),
    ) == ()
