from __future__ import annotations

import json

from research_import import default_payload


def test_default_payload_does_not_advertise_removed_integrations() -> None:
    payload = default_payload("btc")

    serialized = json.dumps(payload).casefold()
    assert payload["source"] == "local-automation"
    assert payload["symbol"] == "BTC"
    assert "last30days" not in serialized
    assert "ai-berkshire" not in serialized
    assert "daily_stock_analysis" not in serialized
