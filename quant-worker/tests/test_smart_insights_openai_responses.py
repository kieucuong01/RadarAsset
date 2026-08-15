from datetime import datetime, timezone
from decimal import Decimal
import json

from smart_insights.evidence import EvidenceBundle
from smart_insights.openai_responses import AiUnavailable, StructuredInsightOutput, synthesize


def bundle() -> EvidenceBundle:
    return EvidenceBundle("signal", "crypto", ("BTC",), (), (), (), (), Decimal("80"), datetime(2026, 8, 13, tzinfo=timezone.utc).isoformat(), "org", "fp")


class FakeTransport:
    last_json = None

    def post_json(self, url: str, body: dict, *, headers: dict, timeout_seconds: int) -> tuple[int, dict]:
        self.last_json = body
        output = {
            "headline": "Theo dõi BTC", "what_changed": "Dữ liệu đã đổi.",
            "why_it_matters": "Cần kiểm tra rủi ro.", "supporting_evidence_ids": [],
            "contradicting_evidence_ids": [], "affected_assets": ["BTC"],
            "time_horizon": "WEEKS_1_4", "risk_scenarios": [],
            "suggested_check_template": "MONITOR", "confidence": 60,
        }
        return 200, {
            "choices": [
                {"finish_reason": "stop", "message": {"content": json.dumps(output)}}
            ]
        }


def test_general_insight_uses_deepseek_json_output_without_tools() -> None:
    transport = FakeTransport()
    result = synthesize(bundle(), locale="vi", transport=transport, model="configured-model", api_key="test")
    assert isinstance(result, StructuredInsightOutput)
    body = transport.last_json
    assert body["model"] == "configured-model"
    assert body["response_format"] == {"type": "json_object"}
    assert body["thinking"] == {"type": "disabled"}
    assert body["stream"] is False
    assert "store" not in body
    assert "tools" not in body
    assert body["messages"][1]["content"] == bundle().to_json()


def test_missing_configuration_returns_typed_unavailable() -> None:
    assert synthesize(bundle(), locale="vi", model=None, api_key=None) == AiUnavailable("AI_NOT_CONFIGURED")
