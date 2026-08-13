from datetime import datetime, timezone
from decimal import Decimal

from smart_insights.evidence import EvidenceBundle, EvidenceFact
from smart_insights.grounding import GroundingAccepted, verify
from smart_insights.openai_responses import StructuredInsightOutput


def bundle() -> EvidenceBundle:
    fact = EvidenceFact(
        "e1", "o1", "gold.etf_flow_tonnes", "XAU", "125.4", "125.4 t",
        ("125.4", "125.4 t"), "tonnes_1dp", "TONNES", "2026-07-01T00:00:00+00:00",
        "2026-07-31T00:00:00+00:00", "2026-08-05T00:00:00+00:00", "wgc-gold-etf",
        "https://www.gold.org/data", "gold-regime-v1", (),
    )
    return EvidenceBundle("s1", "gold", ("XAU",), (fact,), ("e1",), (), (), Decimal("75.9"), datetime(2026, 8, 13, tzinfo=timezone.utc).isoformat(), "org", "fp")


def output(**changes: object) -> StructuredInsightOutput:
    values = dict(
        headline="Gold ETF flow", what_changed="Gold ETF flow was 125.4 t for 2026-07-31.",
        why_it_matters="XAU demand should be monitored.", supporting_evidence_ids=("e1",),
        contradicting_evidence_ids=(), affected_assets=("XAU",), time_horizon="WEEKS_1_4",
        risk_scenarios=(), suggested_check_template="MONITOR", confidence=70,
    )
    values.update(changes)
    return StructuredInsightOutput(**values)


def test_grounding_accepts_exact_evidence_formatting() -> None:
    assert isinstance(verify(output(), bundle()), GroundingAccepted)


def test_grounding_rejects_unknown_number_and_confidence() -> None:
    assert verify(output(what_changed="Flow was 999 t."), bundle()).reason_code == "UNSUPPORTED_NUMBER"
    assert verify(output(confidence=90), bundle()).reason_code == "CONFIDENCE_EXCEEDS_DATA"


def test_grounding_rejects_evidence_scope_assets_and_actions() -> None:
    assert verify(output(supporting_evidence_ids=("foreign",)), bundle()).reason_code == "EVIDENCE_SCOPE_VIOLATION"
    assert verify(output(affected_assets=("BTC",)), bundle()).reason_code == "ASSET_MISMATCH"
    assert verify(output(why_it_matters="Buy XAU now."), bundle()).reason_code == "DISALLOWED_ACTION"
