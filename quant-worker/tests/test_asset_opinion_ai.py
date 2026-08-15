from dataclasses import replace
from datetime import datetime, timezone
from decimal import Decimal
import json

from smart_insights.asset_opinion_contracts import (
    AssetOpinionAiOutput,
    AssetOpinionGroundingAccepted,
)
from smart_insights.evidence import EvidenceBundle, EvidenceFact
from smart_insights.grounding import verify_asset_opinion
from smart_insights.openai_responses import (
    AiSchemaError,
    AiUnavailable,
    parse_asset_opinion_output,
    synthesize_asset_opinion,
)


NOW = datetime(2026, 8, 15, tzinfo=timezone.utc)


def valid_payload() -> dict[str, object]:
    return {
        "thesis": "BTC giữ xu hướng định lượng tích cực.",
        "bull_case": "Dòng tiền 1.00 tiếp tục hỗ trợ BTC.",
        "base_case": "Theo dõi xác nhận từ dòng tiền 1.00.",
        "bear_case": "Luận điểm yếu đi nếu dòng tiền 1.00 đảo chiều.",
        "invalidation_conditions": ["Dòng tiền 1.00 không còn hiệu lực."],
        "supporting_evidence_ids": ["e1"],
        "contradicting_evidence_ids": [],
        "affected_assets": ["BTC"],
        "time_horizon": "WEEKS_1_4",
        "personalized_action": "HOLD",
        "confidence": 60,
    }


def valid_output() -> AssetOpinionAiOutput:
    output = parse_asset_opinion_output(valid_payload())
    assert isinstance(output, AssetOpinionAiOutput)
    return output


def evidence_fact(identifier: str, value: str = "1.00") -> EvidenceFact:
    return EvidenceFact(
        identifier,
        f"observation-{identifier}",
        "crypto.etf.net_flow_usd",
        "BTC",
        value,
        value,
        (value,),
        "ratio_2dp",
        "RATIO",
        "2026-08-15T00:00:00+00:00",
        "2026-08-15T00:00:00+00:00",
        "2026-08-15T00:00:00+00:00",
        "farside",
        "https://farside.co.uk",
        "asset-opinion-facts-v1",
        (),
    )


def bundle(*, contradiction: bool = False) -> EvidenceBundle:
    facts = (evidence_fact("e1"), evidence_fact("e2", "-1.00")) if contradiction else (evidence_fact("e1"),)
    return EvidenceBundle(
        "signal",
        "crypto",
        ("BTC",),
        facts,
        ("e1",),
        ("e2",) if contradiction else (),
        (),
        Decimal("75"),
        NOW.isoformat(),
        "organization",
        "fingerprint",
    )


class FakeTransport:
    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload
        self.last_json: dict[str, object] | None = None

    def post_json(
        self,
        url: str,
        body: dict[str, object],
        *,
        headers: dict[str, str],
        timeout_seconds: int,
    ) -> tuple[int, dict[str, object]]:
        self.last_json = body
        return 200, {
            "output": [
                {
                    "type": "message",
                    "content": [
                        {"type": "output_text", "text": json.dumps(self.payload)}
                    ],
                }
            ]
        }


def test_asset_opinion_parser_requires_three_scenarios_and_invalidations() -> None:
    output = parse_asset_opinion_output(valid_payload())

    assert isinstance(output, AssetOpinionAiOutput)
    assert output.bull_case
    assert output.base_case
    assert output.bear_case
    assert output.invalidation_conditions
    assert output.personalized_action == "HOLD"


def test_asset_opinion_parser_rejects_extra_fields_and_unknown_action() -> None:
    assert isinstance(
        parse_asset_opinion_output({**valid_payload(), "extra": True}),
        AiSchemaError,
    )
    assert isinstance(
        parse_asset_opinion_output(
            {**valid_payload(), "personalized_action": "BUY"}
        ),
        AiSchemaError,
    )


def test_asset_opinion_request_is_strict_unstored_and_evidence_only() -> None:
    transport = FakeTransport(valid_payload())

    result = synthesize_asset_opinion(
        bundle(),
        deterministic_action="HOLD",
        locale="vi",
        model="configured-model",
        api_key="test-key",
        transport=transport,
    )

    assert isinstance(result, AssetOpinionAiOutput)
    assert transport.last_json is not None
    assert transport.last_json["store"] is False
    assert transport.last_json["text"]["format"]["strict"] is True  # type: ignore[index]
    user_text = transport.last_json["input"][1]["content"][0]["text"]  # type: ignore[index]
    assert '"deterministic_action":"HOLD"' in user_text
    assert '"fingerprint":"fingerprint"' in user_text
    assert "tools" not in transport.last_json


def test_asset_opinion_missing_configuration_is_typed_unavailable() -> None:
    assert synthesize_asset_opinion(
        bundle(),
        deterministic_action="HOLD",
        locale="vi",
        model=None,
        api_key=None,
    ) == AiUnavailable("AI_NOT_CONFIGURED")


def test_asset_opinion_grounding_accepts_exact_evidence() -> None:
    result = verify_asset_opinion(valid_output(), bundle(), "HOLD")
    assert isinstance(result, AssetOpinionGroundingAccepted)


def test_asset_opinion_grounding_rejects_numbers_and_trade_language_in_any_field() -> None:
    unsupported = replace(valid_output(), bull_case="BTC tăng 99%.")
    action = replace(valid_output(), invalidation_conditions=("Mua ngay BTC",))

    assert verify_asset_opinion(unsupported, bundle(), "HOLD").reason_code == "UNSUPPORTED_NUMBER"
    assert verify_asset_opinion(action, bundle(), "HOLD").reason_code == "DISALLOWED_ACTION"


def test_asset_opinion_grounding_rejects_confidence_contradictions_and_action_changes() -> None:
    assert verify_asset_opinion(
        replace(valid_output(), confidence=90), bundle(), "HOLD"
    ).reason_code == "CONFIDENCE_EXCEEDS_DATA"
    assert verify_asset_opinion(
        replace(valid_output(), confidence=70), bundle(contradiction=True), "HOLD"
    ).reason_code == "CONTRADICTION_OMITTED"
    assert verify_asset_opinion(
        replace(valid_output(), personalized_action="REVIEW_INCREASE"),
        bundle(),
        "HOLD",
    ).reason_code == "ACTION_MISMATCH"
