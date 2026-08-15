from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_FLOOR
import hashlib
import json
import re

from smart_insights.evidence import EvidenceBundle
from smart_insights.asset_opinion_contracts import (
    AssetOpinionAiOutput,
    AssetOpinionGroundingAccepted,
)
from smart_insights.openai_responses import (
    ALLOWED_ASSET_ACTIONS,
    ALLOWED_CHECKS,
    ALLOWED_HORIZONS,
    StructuredInsightOutput,
)


_NUMBER = re.compile(r"(?<![A-Za-z_])[-+]?\d+(?:[.,]\d+)?")
_DISALLOWED = re.compile(
    r"\b(?:buy|sell|place an? order|position size|guaranteed|price target|mua ngay|bán ngay|đặt lệnh|chắc chắn|mục tiêu giá)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True, slots=True)
class GroundingAccepted:
    output: StructuredInsightOutput
    bundle_fingerprint: str


@dataclass(frozen=True, slots=True)
class GroundingRejected:
    reason_code: str
    field_path: str
    output_hash: str
    bundle_fingerprint: str


def _hash(output: StructuredInsightOutput) -> str:
    return hashlib.sha256(json.dumps(output.__dict__ if hasattr(output, "__dict__") else {
        field: getattr(output, field) for field in output.__dataclass_fields__
    }, sort_keys=True, default=list, separators=(",", ":")).encode("utf-8")).hexdigest()


def _reject(reason: str, path: str, output: StructuredInsightOutput, bundle: EvidenceBundle) -> GroundingRejected:
    return GroundingRejected(reason, path, _hash(output), bundle.fingerprint)


def verify(output: StructuredInsightOutput, bundle: EvidenceBundle) -> GroundingAccepted | GroundingRejected:
    evidence_ids = {row.evidence_id for row in bundle.evidence}
    referenced = set(output.supporting_evidence_ids) | set(output.contradicting_evidence_ids)
    if not referenced <= evidence_ids:
        return _reject("EVIDENCE_SCOPE_VIOLATION", "evidence_ids", output, bundle)
    if not set(output.affected_assets) <= set(bundle.affected_assets):
        return _reject("ASSET_MISMATCH", "affected_assets", output, bundle)
    if output.time_horizon not in ALLOWED_HORIZONS:
        return _reject("TIME_HORIZON_INVALID", "time_horizon", output, bundle)
    if output.suggested_check_template not in ALLOWED_CHECKS:
        return _reject("DISALLOWED_ACTION", "suggested_check_template", output, bundle)
    if output.confidence > int(bundle.data_confidence_ceiling.to_integral_value(rounding=ROUND_FLOOR)):
        return _reject("CONFIDENCE_EXCEEDS_DATA", "confidence", output, bundle)
    if output.confidence > 60 and not set(bundle.contradicting_evidence_ids) <= set(output.contradicting_evidence_ids):
        return _reject("CONTRADICTION_OMITTED", "contradicting_evidence_ids", output, bundle)
    if _DISALLOWED.search(output.prose):
        return _reject("DISALLOWED_ACTION", "prose", output, bundle)
    allowed_numbers: set[str] = set()
    for fact in bundle.evidence:
        for value in (*fact.normalized_tokens, fact.effective_start, fact.effective_end):
            allowed_numbers.update(token.replace(",", ".") for token in _NUMBER.findall(value))
    for token in _NUMBER.findall(output.prose):
        normalized = token.replace(",", ".")
        if normalized not in allowed_numbers:
            return _reject("UNSUPPORTED_NUMBER", "prose", output, bundle)
    for fact in bundle.evidence:
        if fact.display_value in output.prose and fact.unit == "TONNES" and " t" not in output.prose:
            return _reject("UNIT_MISMATCH", "prose", output, bundle)
    return GroundingAccepted(output, bundle.fingerprint)


def _asset_hash(output: AssetOpinionAiOutput) -> str:
    return hashlib.sha256(
        json.dumps(
            {field: getattr(output, field) for field in output.__dataclass_fields__},
            sort_keys=True,
            default=list,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def _asset_reject(
    reason: str,
    path: str,
    output: AssetOpinionAiOutput,
    bundle: EvidenceBundle,
) -> GroundingRejected:
    return GroundingRejected(reason, path, _asset_hash(output), bundle.fingerprint)


def verify_asset_opinion(
    output: AssetOpinionAiOutput,
    bundle: EvidenceBundle,
    deterministic_action: str,
) -> AssetOpinionGroundingAccepted | GroundingRejected:
    evidence_ids = {row.evidence_id for row in bundle.evidence}
    referenced = set(output.supporting_evidence_ids) | set(
        output.contradicting_evidence_ids
    )
    if not referenced <= evidence_ids:
        return _asset_reject("EVIDENCE_SCOPE_VIOLATION", "evidence_ids", output, bundle)
    if output.affected_assets != bundle.affected_assets or len(output.affected_assets) != 1:
        return _asset_reject("ASSET_MISMATCH", "affected_assets", output, bundle)
    if output.time_horizon not in ALLOWED_HORIZONS:
        return _asset_reject("TIME_HORIZON_INVALID", "time_horizon", output, bundle)
    if output.personalized_action not in ALLOWED_ASSET_ACTIONS:
        return _asset_reject(
            "DISALLOWED_ACTION", "personalized_action", output, bundle
        )
    if output.personalized_action != deterministic_action:
        return _asset_reject("ACTION_MISMATCH", "personalized_action", output, bundle)
    if output.confidence > int(
        bundle.data_confidence_ceiling.to_integral_value(rounding=ROUND_FLOOR)
    ):
        return _asset_reject("CONFIDENCE_EXCEEDS_DATA", "confidence", output, bundle)
    if output.confidence > 60 and not set(bundle.contradicting_evidence_ids) <= set(
        output.contradicting_evidence_ids
    ):
        return _asset_reject(
            "CONTRADICTION_OMITTED", "contradicting_evidence_ids", output, bundle
        )
    if _DISALLOWED.search(output.prose):
        return _asset_reject("DISALLOWED_ACTION", "prose", output, bundle)
    allowed_numbers: set[str] = set()
    for fact in bundle.evidence:
        for value in (*fact.normalized_tokens, fact.effective_start, fact.effective_end):
            allowed_numbers.update(
                token.replace(",", ".") for token in _NUMBER.findall(value)
            )
    for token in _NUMBER.findall(output.prose):
        if token.replace(",", ".") not in allowed_numbers:
            return _asset_reject("UNSUPPORTED_NUMBER", "prose", output, bundle)
    return AssetOpinionGroundingAccepted(output, bundle.fingerprint)
