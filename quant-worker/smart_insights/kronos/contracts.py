from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Bar:
    ts: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True)
class ForecastRequest:
    asset: str
    timeframe: str
    as_of: datetime
    history: tuple[Bar, ...]
    horizons: tuple[int, ...]
    seed: int = 20260814
    sample_count: int = 20
    temperature: float = 1.0
    top_p: float = 0.9


@dataclass(frozen=True)
class ForecastPoint:
    days: int
    forecast_for: datetime
    lower: float
    median: float
    upper: float


@dataclass(frozen=True)
class ForecastDistribution:
    points: tuple[ForecastPoint, ...]
    seed: int
    sample_count: int
    temperature: float
    top_p: float


@dataclass(frozen=True)
class RuntimeLock:
    source_url: str
    source_revision: str
    source_license: str
    model_id: str
    model_revision: str
    tokenizer_id: str
    tokenizer_revision: str
    runtime_root: Path

    @classmethod
    def from_manifest(cls, value: dict[str, Any], runtime_root: Path) -> "RuntimeLock":
        return cls(
            source_url=value["source"]["url"],
            source_revision=value["source"]["revision"],
            source_license=value["source"]["license"],
            model_id=value["model"]["id"],
            model_revision=value["model"]["revision"],
            tokenizer_id=value["tokenizer"]["id"],
            tokenizer_revision=value["tokenizer"]["revision"],
            runtime_root=runtime_root,
        )
