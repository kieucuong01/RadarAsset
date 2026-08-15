from __future__ import annotations

from dataclasses import dataclass
import json
import time
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from smart_insights.evidence import EvidenceBundle
from smart_insights.asset_opinion_contracts import AssetOpinionAiOutput


ALLOWED_HORIZONS = ("INTRADAY", "DAYS_1_7", "WEEKS_1_4", "MONTHS_1_3")
ALLOWED_CHECKS = (
    "MONITOR", "REVIEW_ALLOCATION", "CHECK_DRAWDOWN_OR_STOP_POLICY",
    "REDUCE_EVENT_RISK_FOR_REVIEW", "WAIT_FOR_CONFIRMATION",
    "NO_ACTION_INSUFFICIENT_DATA",
)

ALLOWED_ASSET_ACTIONS = (
    "HOLD",
    "REVIEW_INCREASE",
    "REVIEW_REDUCE_RISK",
    "WAIT_CONFIRMATION",
    "NO_ACTION_INSUFFICIENT_DATA",
)

OUTPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "headline", "what_changed", "why_it_matters", "supporting_evidence_ids",
        "contradicting_evidence_ids", "affected_assets", "time_horizon",
        "risk_scenarios", "suggested_check_template", "confidence",
    ],
    "properties": {
        "headline": {"type": "string", "maxLength": 140},
        "what_changed": {"type": "string", "maxLength": 700},
        "why_it_matters": {"type": "string", "maxLength": 700},
        "supporting_evidence_ids": {"type": "array", "items": {"type": "string"}, "maxItems": 12},
        "contradicting_evidence_ids": {"type": "array", "items": {"type": "string"}, "maxItems": 12},
        "affected_assets": {"type": "array", "items": {"type": "string"}, "maxItems": 20},
        "time_horizon": {"type": "string", "enum": list(ALLOWED_HORIZONS)},
        "risk_scenarios": {"type": "array", "items": {"type": "string", "maxLength": 280}, "maxItems": 3},
        "suggested_check_template": {"type": "string", "enum": list(ALLOWED_CHECKS)},
        "confidence": {"type": "integer", "minimum": 0, "maximum": 100},
    },
}

SYSTEM_PROMPT_V1 = """You are the interpretation layer of a quantitative personal-investment research cockpit.
Use only facts and evidence IDs in the supplied JSON bundle. Do not browse, use outside knowledge,
calculate a new market number, or guess a missing value. Copy every displayed number exactly from an
evidence fact, preserving its unit, asset, and effective period. Include supplied contradictory evidence
when confidence is above 60. Return prose in {locale}; do not translate evidence IDs, asset codes, units,
enums, or formatted numbers. Choose one allowed suggested-check template. Never create an order, exact
trade size, guaranteed forecast, or price target. If the evidence is insufficient, choose
NO_ACTION_INSUFFICIENT_DATA and lower confidence. Return only the required structured output."""

ASSET_OPINION_OUTPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "thesis",
        "bull_case",
        "base_case",
        "bear_case",
        "invalidation_conditions",
        "supporting_evidence_ids",
        "contradicting_evidence_ids",
        "affected_assets",
        "time_horizon",
        "personalized_action",
        "confidence",
    ],
    "properties": {
        "thesis": {"type": "string", "maxLength": 700},
        "bull_case": {"type": "string", "maxLength": 700},
        "base_case": {"type": "string", "maxLength": 700},
        "bear_case": {"type": "string", "maxLength": 700},
        "invalidation_conditions": {
            "type": "array",
            "items": {"type": "string", "maxLength": 280},
            "maxItems": 3,
        },
        "supporting_evidence_ids": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 12,
        },
        "contradicting_evidence_ids": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 12,
        },
        "affected_assets": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 1,
            "maxItems": 1,
        },
        "time_horizon": {"type": "string", "enum": list(ALLOWED_HORIZONS)},
        "personalized_action": {
            "type": "string",
            "enum": list(ALLOWED_ASSET_ACTIONS),
        },
        "confidence": {"type": "integer", "minimum": 0, "maximum": 100},
    },
}

ASSET_OPINION_SYSTEM_PROMPT_V1 = """You explain a deterministic quantitative asset opinion for a personal investor.
Use only the supplied evidence bundle. Do not browse, calculate a new market number, or use outside
knowledge. Copy every displayed number exactly, preserving its unit, asset, and effective period.
Do not change deterministic_action. Include every supplied contradiction when confidence exceeds 60.
Return prose in {locale}; keep asset codes, evidence IDs, units, enums, and numbers unchanged. Never
create an order, exact position size, guaranteed forecast, or price target. Return only the strict
structured output."""


@dataclass(frozen=True, slots=True)
class StructuredInsightOutput:
    headline: str
    what_changed: str
    why_it_matters: str
    supporting_evidence_ids: tuple[str, ...]
    contradicting_evidence_ids: tuple[str, ...]
    affected_assets: tuple[str, ...]
    time_horizon: str
    risk_scenarios: tuple[str, ...]
    suggested_check_template: str
    confidence: int

    @property
    def prose(self) -> str:
        return "\n".join((self.headline, self.what_changed, self.why_it_matters, *self.risk_scenarios))


@dataclass(frozen=True, slots=True)
class AiUnavailable:
    reason_code: str


@dataclass(frozen=True, slots=True)
class AiSchemaError:
    reason_code: str


class JsonTransport(Protocol):
    def post_json(
        self, url: str, body: dict[str, Any], *, headers: dict[str, str], timeout_seconds: int
    ) -> tuple[int, dict[str, Any]]: ...


class UrllibJsonTransport:
    def post_json(
        self, url: str, body: dict[str, Any], *, headers: dict[str, str], timeout_seconds: int
    ) -> tuple[int, dict[str, Any]]:
        request = Request(url, data=json.dumps(body, separators=(",", ":")).encode("utf-8"), headers=headers, method="POST")
        try:
            with urlopen(request, timeout=timeout_seconds) as response:
                return response.status, json.loads(response.read(1_000_001))
        except HTTPError as error:
            return error.code, {}


def _strings(value: object, *, maximum: int, max_length: int | None = None) -> tuple[str, ...] | None:
    if not isinstance(value, list) or len(value) > maximum or any(not isinstance(item, str) for item in value):
        return None
    if max_length is not None and any(len(item) > max_length for item in value):
        return None
    return tuple(value)


def parse_output(payload: object) -> StructuredInsightOutput | AiSchemaError:
    if not isinstance(payload, dict) or set(payload) != set(OUTPUT_SCHEMA["required"]):
        return AiSchemaError("AI_SCHEMA_INVALID")
    headline, changed, matters = payload.get("headline"), payload.get("what_changed"), payload.get("why_it_matters")
    supporting = _strings(payload.get("supporting_evidence_ids"), maximum=12)
    contradicting = _strings(payload.get("contradicting_evidence_ids"), maximum=12)
    assets = _strings(payload.get("affected_assets"), maximum=20)
    scenarios = _strings(payload.get("risk_scenarios"), maximum=3, max_length=280)
    confidence = payload.get("confidence")
    if (
        not isinstance(headline, str) or len(headline) > 140
        or not isinstance(changed, str) or len(changed) > 700
        or not isinstance(matters, str) or len(matters) > 700
        or supporting is None or contradicting is None or assets is None or scenarios is None
        or payload.get("time_horizon") not in ALLOWED_HORIZONS
        or payload.get("suggested_check_template") not in ALLOWED_CHECKS
        or isinstance(confidence, bool) or not isinstance(confidence, int) or not 0 <= confidence <= 100
    ):
        return AiSchemaError("AI_SCHEMA_INVALID")
    return StructuredInsightOutput(
        headline, changed, matters, supporting, contradicting, assets,
        str(payload["time_horizon"]), scenarios, str(payload["suggested_check_template"]), confidence,
    )


def parse_asset_opinion_output(payload: object) -> AssetOpinionAiOutput | AiSchemaError:
    required = set(ASSET_OPINION_OUTPUT_SCHEMA["required"])
    if not isinstance(payload, dict) or set(payload) != required:
        return AiSchemaError("AI_SCHEMA_INVALID")
    prose = tuple(payload.get(key) for key in ("thesis", "bull_case", "base_case", "bear_case"))
    invalidations = _strings(payload.get("invalidation_conditions"), maximum=3, max_length=280)
    supporting = _strings(payload.get("supporting_evidence_ids"), maximum=12)
    contradicting = _strings(payload.get("contradicting_evidence_ids"), maximum=12)
    assets = _strings(payload.get("affected_assets"), maximum=1)
    confidence = payload.get("confidence")
    if (
        any(not isinstance(value, str) or len(value) > 700 for value in prose)
        or invalidations is None
        or supporting is None
        or contradicting is None
        or assets is None
        or len(assets) != 1
        or payload.get("time_horizon") not in ALLOWED_HORIZONS
        or payload.get("personalized_action") not in ALLOWED_ASSET_ACTIONS
        or isinstance(confidence, bool)
        or not isinstance(confidence, int)
        or not 0 <= confidence <= 100
    ):
        return AiSchemaError("AI_SCHEMA_INVALID")
    return AssetOpinionAiOutput(
        thesis=str(prose[0]),
        bull_case=str(prose[1]),
        base_case=str(prose[2]),
        bear_case=str(prose[3]),
        invalidation_conditions=invalidations,
        supporting_evidence_ids=supporting,
        contradicting_evidence_ids=contradicting,
        affected_assets=assets,
        time_horizon=str(payload["time_horizon"]),
        personalized_action=str(payload["personalized_action"]),
        confidence=confidence,
    )


def _extract(response: dict[str, Any]) -> object | None:
    texts = [
        content.get("text")
        for item in response.get("output", []) if isinstance(item, dict)
        for content in item.get("content", []) if isinstance(content, dict) and content.get("type") == "output_text"
    ]
    if len(texts) != 1 or not isinstance(texts[0], str) or len(texts[0]) > 20_000:
        return None
    try:
        return json.loads(texts[0])
    except json.JSONDecodeError:
        return None


def synthesize(
    bundle: EvidenceBundle, *, locale: str, model: str | None, api_key: str | None,
    transport: JsonTransport | None = None, timeout_seconds: int = 30,
    endpoint: str = "https://api.openai.com/v1/responses",
) -> StructuredInsightOutput | AiUnavailable | AiSchemaError:
    if not model or not api_key:
        return AiUnavailable("AI_NOT_CONFIGURED")
    if locale not in {"vi", "en"} or not 1 <= timeout_seconds <= 60:
        return AiUnavailable("AI_CONFIGURATION_INVALID")
    body = {
        "model": model,
        "input": [
            {"role": "system", "content": [{"type": "input_text", "text": SYSTEM_PROMPT_V1.format(locale=locale)}]},
            {"role": "user", "content": [{"type": "input_text", "text": bundle.to_json()}]},
        ],
        "text": {"format": {"type": "json_schema", "name": "smart_insight", "strict": True, "schema": OUTPUT_SCHEMA}},
        "store": False,
    }
    client = transport or UrllibJsonTransport()
    for attempt in range(2):
        try:
            status, response = client.post_json(
                endpoint, body,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                timeout_seconds=timeout_seconds,
            )
        except (OSError, TimeoutError, URLError):
            status, response = 599, {}
        if status == 200:
            extracted = _extract(response)
            return parse_output(extracted) if extracted is not None else AiSchemaError("AI_RESPONSE_INVALID")
        if status != 429 and status < 500:
            break
        if attempt == 0:
            time.sleep(0.05)
    return AiUnavailable("AI_PROVIDER_UNAVAILABLE")


def synthesize_asset_opinion(
    bundle: EvidenceBundle,
    *,
    deterministic_action: str,
    locale: str,
    model: str | None,
    api_key: str | None,
    transport: JsonTransport | None = None,
    timeout_seconds: int = 30,
    endpoint: str = "https://api.openai.com/v1/responses",
) -> AssetOpinionAiOutput | AiUnavailable | AiSchemaError:
    if not model or not api_key:
        return AiUnavailable("AI_NOT_CONFIGURED")
    if (
        locale not in {"vi", "en"}
        or deterministic_action not in ALLOWED_ASSET_ACTIONS
        or not 1 <= timeout_seconds <= 60
    ):
        return AiUnavailable("AI_CONFIGURATION_INVALID")
    user_payload = json.dumps(
        {
            "bundle": json.loads(bundle.to_json()),
            "deterministic_action": deterministic_action,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    body = {
        "model": model,
        "input": [
            {
                "role": "system",
                "content": [
                    {
                        "type": "input_text",
                        "text": ASSET_OPINION_SYSTEM_PROMPT_V1.format(locale=locale),
                    }
                ],
            },
            {
                "role": "user",
                "content": [{"type": "input_text", "text": user_payload}],
            },
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "asset_opinion",
                "strict": True,
                "schema": ASSET_OPINION_OUTPUT_SCHEMA,
            }
        },
        "store": False,
    }
    client = transport or UrllibJsonTransport()
    for attempt in range(2):
        try:
            status, response = client.post_json(
                endpoint,
                body,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                timeout_seconds=timeout_seconds,
            )
        except (OSError, TimeoutError, URLError):
            status, response = 599, {}
        if status == 200:
            extracted = _extract(response)
            return (
                parse_asset_opinion_output(extracted)
                if extracted is not None
                else AiSchemaError("AI_RESPONSE_INVALID")
            )
        if status != 429 and status < 500:
            break
        if attempt == 0:
            time.sleep(0.05)
    return AiUnavailable("AI_PROVIDER_UNAVAILABLE")
