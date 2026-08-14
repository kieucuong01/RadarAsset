from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
import math
import statistics


METHODOLOGY_VERSION = "energy-oil-shock-v1"
MINIMUM_FRESH_WEIGHT = 0.60
OIL_SHOCK_V1 = {
    "oil_return_7d_z": 0.35,
    "oil_volatility_z": 0.25,
    "inventory_surprise_or_change_z": 0.25,
    "brent_wti_spread_z": 0.15,
}


def _aware(value: datetime) -> bool:
    return value.tzinfo is not None and value.utcoffset() is not None


@dataclass(frozen=True, slots=True)
class OilShockComponent:
    name: str
    value: float | None
    as_of: datetime
    fresh: bool
    source_evidence: tuple[str, ...]

    def __post_init__(self) -> None:
        if self.name not in OIL_SHOCK_V1:
            raise ValueError(f"Unknown Oil Shock component: {self.name}")
        if not _aware(self.as_of):
            raise ValueError("Oil Shock component as_of must be timezone-aware.")
        if self.value is not None and (not math.isfinite(self.value) or not 0 <= self.value <= 100):
            raise ValueError("Oil Shock component must be between zero and 100.")


@dataclass(frozen=True, slots=True)
class OilShockInputs:
    as_of: datetime
    components: Mapping[str, OilShockComponent]
    inventory_branch: str


@dataclass(frozen=True, slots=True)
class OilShockResult:
    value: float | None
    status: str
    coverage: float
    methodology: str
    reason: str | None
    as_of: datetime
    inventory_branch: str
    evidence: tuple[str, ...]


def calculate_oil_shock(inputs: OilShockInputs) -> OilShockResult:
    if not _aware(inputs.as_of):
        raise ValueError("Oil Shock as_of must be timezone-aware.")
    if inputs.inventory_branch not in {"forecast_surprise", "change_anomaly"}:
        raise ValueError("Oil Shock inventory branch is invalid.")
    usable = {
        name: component
        for name, component in inputs.components.items()
        if component.fresh and component.value is not None
    }
    if any(name != component.name for name, component in inputs.components.items()):
        raise ValueError("Component map key must match component name.")
    coverage = round(sum(OIL_SHOCK_V1[name] for name in usable), 10)
    evidence = tuple(dict.fromkeys(
        item for name in OIL_SHOCK_V1 if name in usable for item in usable[name].source_evidence
    ))
    if coverage < MINIMUM_FRESH_WEIGHT:
        return OilShockResult(None, "UNAVAILABLE", coverage, METHODOLOGY_VERSION, "INSUFFICIENT_FRESH_WEIGHT", inputs.as_of, inputs.inventory_branch, evidence)
    value = sum(OIL_SHOCK_V1[name] * float(component.value) for name, component in usable.items())
    return OilShockResult(round(value, 4), "AVAILABLE" if coverage == 1 else "LIMITED_DATA", coverage, METHODOLOGY_VERSION, None, inputs.as_of, inputs.inventory_branch, evidence)


def realized_volatility(prices: Sequence[float], *, window: int = 20) -> float:
    if window < 2 or len(prices) < window + 1:
        raise ValueError(f"Realized volatility requires {window + 1} prices.")
    sample = [float(value) for value in prices[-(window + 1):]]
    if any(not math.isfinite(value) or value <= 0 for value in sample):
        raise ValueError("Prices must be finite and positive.")
    returns = [math.log(sample[index] / sample[index - 1]) for index in range(1, len(sample))]
    return statistics.stdev(returns) * math.sqrt(252)


def z_score_against_history(value: float, history: Sequence[float], *, required_history: int = 90) -> float:
    if len(history) < required_history:
        raise ValueError(f"Z-score requires {required_history} historical values.")
    sample = [float(item) for item in history[-required_history:]]
    if any(not math.isfinite(item) for item in (*sample, value)):
        raise ValueError("Z-score inputs must be finite.")
    deviation = statistics.stdev(sample)
    if deviation == 0:
        return 0.0
    return (float(value) - statistics.mean(sample)) / deviation
