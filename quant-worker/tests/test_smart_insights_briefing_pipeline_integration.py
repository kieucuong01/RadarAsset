from dataclasses import replace
from datetime import date, datetime, timezone
from decimal import Decimal

from smart_insights.briefing_pipeline import BriefingSignal, generate_briefing, replay_briefing
from smart_insights.evidence import EvidenceObservation
from smart_insights.openai_responses import AiUnavailable
from smart_insights.personalization import CandidateSignal, UserInsightPreference


NOW = datetime(2026, 8, 13, 1, tzinfo=timezone.utc)


class FakeRepository:
    def __init__(self, value: Decimal = Decimal("125.4")) -> None:
        self.value = value
        self.records = []

    def load_briefing_signals(self, organization_id: str, user_id: str, *, as_of: datetime):
        observation = EvidenceObservation(
            "obs", "gold.etf_flow_tonnes", "XAU", self.value, "TONNES", NOW, NOW,
            NOW, "wgc-gold-etf", "https://www.gold.org/data", "gold-regime-v1", (), 1,
        )
        signal = CandidateSignal("signal", "gold", ("XAU",), NOW, None, Decimal("2"), True, False, Decimal("80"), 1)
        return (BriefingSignal(signal, (observation,), (), ()),)

    def load_personalization(self, organization_id: str, user_id: str, *, as_of: datetime):
        return (), (), UserInsightPreference(markets=("gold",), assets=("XAU",))

    def publish_briefing(self, draft):
        existing = next((row for row in self.records if row.fingerprint == draft.fingerprint), None)
        if existing:
            return existing
        record = draft.to_record(f"briefing-{len(self.records) + 1}", len(self.records) + 1)
        self.records.append(record)
        return record

    def load_briefing(self, briefing_id: str):
        return next(row for row in self.records if row.id == briefing_id)


def failing_ai(*args, **kwargs):
    return AiUnavailable("AI_PROVIDER_UNAVAILABLE")


def test_ai_failure_keeps_quant_briefing_without_sample_prose() -> None:
    result = generate_briefing(
        FakeRepository(), organization_id="org", user_id="user", local_date=date(2026, 8, 13),
        timezone_name="Asia/Bangkok", as_of=NOW, synthesizer=failing_ai,
    )
    assert result.status == "quant_only"
    assert result.primary_signal_ids == ("signal",)
    assert result.ai_insight_count == 0


def test_late_data_creates_revision_without_mutating_first() -> None:
    repository = FakeRepository()
    first = generate_briefing(repository, organization_id="org", user_id="user", local_date=date(2026, 8, 13), timezone_name="Asia/Bangkok", as_of=NOW, synthesizer=failing_ai)
    repository.value = Decimal("150.0")
    second = generate_briefing(repository, organization_id="org", user_id="user", local_date=date(2026, 8, 13), timezone_name="Asia/Bangkok", as_of=NOW, synthesizer=failing_ai)
    assert (first.revision, second.revision) == (1, 2)
    assert replay_briefing(repository, first.id).fingerprint == first.fingerprint


def test_identical_replay_does_not_create_a_revision() -> None:
    repository = FakeRepository()
    first = generate_briefing(repository, organization_id="org", user_id="user", local_date=date(2026, 8, 13), timezone_name="Asia/Bangkok", as_of=NOW, synthesizer=failing_ai)
    second = generate_briefing(repository, organization_id="org", user_id="user", local_date=date(2026, 8, 13), timezone_name="Asia/Bangkok", as_of=NOW, synthesizer=failing_ai)
    assert second.id == first.id
    assert len(repository.records) == 1
