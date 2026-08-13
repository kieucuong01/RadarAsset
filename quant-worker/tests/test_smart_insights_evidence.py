from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from smart_insights.evidence import (
    EvidenceObservation,
    SignalEvidenceInput,
    build_bundle,
    canonical_sha256,
    format_evidence_number,
)


NOW = datetime(2026, 8, 13, 1, tzinfo=timezone.utc)


def observation(value: str, observed_at: datetime) -> EvidenceObservation:
    return EvidenceObservation(
        id=f"obs-{value}", metric_code="crypto.etf.net_flow_usd", asset="BTC",
        value=Decimal(value), unit="USD_MILLION", effective_start=NOW - timedelta(days=1),
        effective_end=NOW - timedelta(days=1), observed_at=observed_at,
        source_code="farside-btc-etf", source_url="https://farside.co.uk/btc/",
        methodology_version="crypto-regime-v1", warnings=(), decimals=1,
    )


def test_bundle_freezes_only_point_in_time_accessible_evidence() -> None:
    signal = SignalEvidenceInput("signal-1", "crypto", ("BTC",), Decimal("82.40"))
    bundle = build_bundle(
        signal=signal,
        observations=(observation("125.4", NOW), observation("999", NOW + timedelta(days=1))),
        tenant_id="org-1", as_of=NOW,
    )
    assert [item.raw_value for item in bundle.evidence] == ["125.4"]
    assert bundle.fingerprint == canonical_sha256(bundle.to_json(include_fingerprint=False))


def test_displayed_number_map_declares_rounding_and_unit() -> None:
    number = format_evidence_number(value=Decimal("125.40"), unit="USD_MILLION", decimals=1)
    assert number.display == "$125.4m"
    assert number.normalized_tokens == ("125.4", "$125.4m")
    assert number.format_rule == "currency_compact_usd_million_1dp"


def test_unknown_unit_is_not_eligible_for_synthesis() -> None:
    with pytest.raises(ValueError, match="Unsupported evidence unit"):
        format_evidence_number(value=Decimal("1"), unit="mystery", decimals=0)
