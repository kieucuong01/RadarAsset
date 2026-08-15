from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
import os
from typing import Callable

from .asset_opinion_contracts import (
    AssetCandidate,
    AssetOpinionAiOutput,
    AssetOpinionDraft,
    AssetOpinionGroundingAccepted,
    AssetOpinionMarketData,
    DataGateResult,
    QuantAssetOpinion,
    UniverseResult,
)
from .asset_opinion_quant import METHODOLOGY_VERSION, build_quant_opinion
from .evidence import EvidenceObservation, SignalEvidenceInput, build_bundle
from .grounding import GroundingRejected, verify_asset_opinion
from .openai_responses import (
    AiSchemaError,
    AiUnavailable,
    synthesize_asset_opinion,
)
from .personalization import UserInsightPreference


@dataclass(frozen=True, slots=True)
class AssetOpinionBatch:
    universe: UniverseResult
    market_data: AssetOpinionMarketData
    preferences: UserInsightPreference
    as_of: datetime
    organization_id: str

    def __post_init__(self) -> None:
        if self.as_of.tzinfo is None or self.as_of.utcoffset() is None:
            raise ValueError("as_of must be timezone-aware.")
        if not self.organization_id:
            raise ValueError("organization_id is required.")


QuantBuilder = Callable[..., QuantAssetOpinion]
AssetOpinionSynthesizer = Callable[..., AssetOpinionAiOutput | AiUnavailable | AiSchemaError]


def _unavailable_quant(asset: AssetCandidate) -> QuantAssetOpinion:
    return QuantAssetOpinion(
        asset=asset,
        stance="INSUFFICIENT_DATA",
        quant_score=None,
        confidence=Decimal("0"),
        data_coverage=Decimal("0"),
        gate=DataGateResult(
            passed=False,
            failed_gates=("QUANT_CALCULATION_FAILED",),
            source_families=(),
            numeric_fact_count=0,
        ),
        pillars=(),
        facts=(),
        personalized_action="NO_ACTION_INSUFFICIENT_DATA",
        horizon="WEEKS_1_4",
        freshness="unavailable",
        methodology_version=METHODOLOGY_VERSION,
    )


def _evidence_bundle(
    quant: QuantAssetOpinion,
    *,
    organization_id: str,
    as_of: datetime,
):
    signal_key = f"asset-opinion:{quant.asset.symbol}:{as_of.date().isoformat()}"
    observations = tuple(
        EvidenceObservation(
            id=fact.id,
            metric_code=fact.metric_code,
            asset=quant.asset.symbol,
            value=fact.value,
            unit=fact.unit,
            effective_start=fact.effective_at,
            effective_end=fact.effective_at,
            observed_at=fact.observed_at,
            source_code=fact.source_code,
            source_url=fact.source_url,
            methodology_version=fact.methodology_version,
            warnings=() if fact.fresh else ("STALE",),
            decimals=2,
        )
        for fact in quant.facts
    )
    signal = SignalEvidenceInput(
        signal_id=signal_key,
        market=quant.asset.market,
        affected_assets=(quant.asset.symbol,),
        data_confidence=quant.confidence,
    )
    provisional = build_bundle(
        signal=signal,
        observations=observations,
        tenant_id=organization_id,
        as_of=as_of,
    )
    contradictions = {
        fact.id for fact in quant.facts if fact.contradicting
    }
    contradicting_ids = tuple(
        row.evidence_id
        for row in provisional.evidence
        if row.metric_observation_id in contradictions
    )
    supporting_ids = tuple(
        row.evidence_id
        for row in provisional.evidence
        if row.metric_observation_id not in contradictions
    )
    return build_bundle(
        signal=signal,
        observations=observations,
        tenant_id=organization_id,
        as_of=as_of,
        supporting_ids=supporting_ids,
        contradicting_ids=contradicting_ids,
    )


def build_asset_opinion_drafts(
    inputs: AssetOpinionBatch,
    *,
    synthesizer: AssetOpinionSynthesizer = synthesize_asset_opinion,
    build_quant: QuantBuilder = build_quant_opinion,
) -> tuple[AssetOpinionDraft, ...]:
    drafts: list[AssetOpinionDraft] = []
    for asset in inputs.universe.assets:
        signal_key = f"asset-opinion:{asset.symbol}:{inputs.as_of.date().isoformat()}"
        try:
            quant = build_quant(
                asset=asset,
                bars=inputs.market_data.bars_for(asset.symbol),
                specialized=inputs.market_data.facts_for(asset.symbol),
                as_of=inputs.as_of,
                risk_tolerance=inputs.preferences.risk_tolerance,
            )
        except Exception:
            quant = _unavailable_quant(asset)
            drafts.append(
                AssetOpinionDraft(
                    symbol=asset.symbol,
                    signal_key=signal_key,
                    quant=quant,
                    evidence_bundle=_evidence_bundle(
                        quant,
                        organization_id=inputs.organization_id,
                        as_of=inputs.as_of,
                    ),
                    explanation_status="unavailable",
                    ai_output=None,
                    rejection_code="QUANT_CALCULATION_FAILED",
                )
            )
            continue

        bundle = _evidence_bundle(
            quant,
            organization_id=inputs.organization_id,
            as_of=inputs.as_of,
        )
        if not quant.gate.passed:
            drafts.append(
                AssetOpinionDraft(
                    asset.symbol,
                    signal_key,
                    quant,
                    bundle,
                    "insufficient_data",
                    None,
                    "DATA_GATE_FAILED",
                )
            )
            continue

        try:
            generated = synthesizer(
                bundle,
                deterministic_action=quant.personalized_action,
                locale=inputs.preferences.locale,
                model=os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash"),
                api_key=os.getenv("DEEPSEEK_API_KEY"),
                timeout_seconds=int(os.getenv("DEEPSEEK_TIMEOUT_SECONDS", "30")),
                endpoint=(
                    os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
                    + "/chat/completions"
                ),
            )
            verified = (
                verify_asset_opinion(generated, bundle, quant.personalized_action)
                if isinstance(generated, AssetOpinionAiOutput)
                else generated
            )
        except Exception:
            generated = AiUnavailable("AI_PROCESSING_FAILED")
            verified = generated
        if isinstance(verified, AssetOpinionGroundingAccepted):
            status = "accepted"
            output = verified.output
            rejection_code = None
        else:
            status = "quant_only"
            output = None
            rejection_code = (
                verified.reason_code
                if isinstance(verified, (GroundingRejected, AiUnavailable, AiSchemaError))
                else "AI_EXPLANATION_UNAVAILABLE"
            )
        drafts.append(
            AssetOpinionDraft(
                asset.symbol,
                signal_key,
                quant,
                bundle,
                status,
                output,
                rejection_code,
            )
        )
    return tuple(drafts)
