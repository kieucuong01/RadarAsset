from datetime import datetime, timedelta, timezone
from decimal import Decimal

from smart_insights.asset_opinion_contracts import (
    AssetCandidate,
    AssetOpinionAiOutput,
    AssetOpinionMarketData,
    MarketBar,
    QuantFact,
    UniverseResult,
)
from smart_insights.asset_opinion_pipeline import (
    AssetOpinionBatch,
    build_asset_opinion_drafts,
)
from smart_insights.asset_opinion_quant import build_quant_opinion
from smart_insights.personalization import UserInsightPreference


NOW = datetime(2026, 8, 15, tzinfo=timezone.utc)


def candidate(symbol: str, market: str) -> AssetCandidate:
    return AssetCandidate(symbol, symbol, market, Decimal("0"), 0)


def bars(symbol: str, count: int) -> tuple[MarketBar, ...]:
    return tuple(
        MarketBar(
            f"{symbol}-bar-{index}",
            symbol,
            NOW - timedelta(days=count - index - 1),
            Decimal(100 + index),
            NOW - timedelta(days=count - index - 1),
        )
        for index in range(count)
    )


def fact(symbol: str, metric: str, source: str, score: str) -> QuantFact:
    return QuantFact(
        f"{symbol}-{metric}",
        metric,
        Decimal("1"),
        "RATIO",
        NOW,
        NOW,
        source,
        source,
        f"https://example.test/{source}",
        Decimal(score),
        Decimal("80"),
        True,
        False,
        "asset-opinion-facts-v1",
    )


def batch(*, sufficient: bool = True) -> AssetOpinionBatch:
    assets = (candidate("BTC", "crypto"), candidate("XAU", "gold"))
    count = 80 if sufficient else 20
    market_data = AssetOpinionMarketData(
        bars=tuple((row.symbol, bars(row.symbol, count)) for row in assets),
        facts=(
            ("BTC", (fact("BTC", "crypto.etf.net_flow_usd", "farside", "60"),)),
            ("XAU", (fact("XAU", "gold.cftc.managed_money_net_oi", "cftc", "40"),)),
        ),
    )
    return AssetOpinionBatch(
        universe=UniverseResult(assets, ()),
        market_data=market_data,
        preferences=UserInsightPreference(locale="vi", risk_tolerance="moderate"),
        as_of=NOW,
        organization_id="organization",
    )


class SpySynthesizer:
    def __init__(self) -> None:
        self.calls = 0

    def __call__(self, evidence_bundle, **kwargs):
        self.calls += 1
        return AssetOpinionAiOutput(
            thesis="Xu hướng định lượng được xác nhận.",
            bull_case="Dòng tiền tiếp tục hỗ trợ.",
            base_case="Theo dõi thêm xác nhận.",
            bear_case="Luận điểm yếu đi khi dòng tiền đảo chiều.",
            invalidation_conditions=("Dòng tiền không còn hiệu lực.",),
            supporting_evidence_ids=evidence_bundle.supporting_evidence_ids,
            contradicting_evidence_ids=evidence_bundle.contradicting_evidence_ids,
            affected_assets=evidence_bundle.affected_assets,
            time_horizon="WEEKS_1_4",
            personalized_action=kwargs["deterministic_action"],
            confidence=min(60, int(evidence_bundle.data_confidence_ceiling)),
        )


def test_one_asset_failure_does_not_drop_other_opinions() -> None:
    synthesizer = SpySynthesizer()

    def fails_only_for_xau(**kwargs):
        if kwargs["asset"].symbol == "XAU":
            raise ValueError("fixture failure")
        return build_quant_opinion(**kwargs)

    drafts = build_asset_opinion_drafts(
        batch(),
        synthesizer=synthesizer,
        build_quant=fails_only_for_xau,
    )

    assert tuple(row.symbol for row in drafts) == ("BTC", "XAU")
    assert drafts[0].explanation_status == "accepted"
    assert drafts[1].explanation_status == "unavailable"
    assert drafts[1].rejection_code == "QUANT_CALCULATION_FAILED"


def test_failed_gate_skips_ai_and_never_creates_explanation() -> None:
    synthesizer = SpySynthesizer()

    drafts = build_asset_opinion_drafts(batch(sufficient=False), synthesizer=synthesizer)

    assert synthesizer.calls == 0
    assert all(row.explanation_status == "insufficient_data" for row in drafts)
    assert all(row.ai_output is None for row in drafts)
    assert all(
        row.quant.personalized_action == "NO_ACTION_INSUFFICIENT_DATA"
        for row in drafts
    )


def test_accepted_opinion_is_grounded_to_exactly_one_asset() -> None:
    drafts = build_asset_opinion_drafts(batch(), synthesizer=SpySynthesizer())

    assert all(row.explanation_status == "accepted" for row in drafts)
    assert all(row.evidence_bundle.affected_assets == (row.symbol,) for row in drafts)
    assert all(row.ai_output is not None for row in drafts)


def test_one_ai_failure_degrades_only_that_asset_to_quant_only() -> None:
    accepted = SpySynthesizer()

    def fails_only_for_xau(evidence_bundle, **kwargs):
        if evidence_bundle.affected_assets == ("XAU",):
            raise TimeoutError("provider timeout")
        return accepted(evidence_bundle, **kwargs)

    drafts = build_asset_opinion_drafts(batch(), synthesizer=fails_only_for_xau)

    assert tuple(row.symbol for row in drafts) == ("BTC", "XAU")
    assert drafts[0].explanation_status == "accepted"
    assert drafts[1].explanation_status == "quant_only"
    assert drafts[1].ai_output is None
    assert drafts[1].rejection_code == "AI_PROCESSING_FAILED"
