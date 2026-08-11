import pytest
from pydantic import ValidationError

from service import OptimizePayload, health, optimize_endpoint


def payload() -> dict:
    return {
        "returnsBySymbol": {
            "BTC": [0.001 + (index % 5) * 0.0001 for index in range(40)],
            "FPT": [0.0005 + (index % 7) * 0.0001 for index in range(40)],
        },
        "marketBySymbol": {"BTC": "crypto_spot", "FPT": "vn_equity"},
        "timeframe": "1d",
        "method": "minimum_variance",
        "maxWeightBps": 7000,
        "totalWeightBps": 10000,
    }


def test_health_and_optimizer_contract() -> None:
    assert health() == {"status": "ok", "engine": "quant-engine-v1"}

    response = optimize_endpoint(OptimizePayload.model_validate(payload()))

    assert response["source"]["library"] == "skfolio"
    assert sum(response["weightsBps"].values()) == 10000


def test_optimizer_contract_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        OptimizePayload.model_validate({**payload(), "organizationId": "leak"})
