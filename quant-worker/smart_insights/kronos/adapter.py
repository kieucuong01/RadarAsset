from __future__ import annotations

import hashlib
import json
import math
import subprocess
import sys
from datetime import timedelta, timezone
from pathlib import Path
from typing import Protocol

from .contracts import Bar, ForecastDistribution, ForecastPoint, ForecastRequest, RuntimeLock


ALLOWED_HORIZONS = (1, 3, 7)
MAX_CONTEXT = 512


class RuntimeUnavailableError(RuntimeError):
    """The optional, pinned Kronos runtime is absent or unverifiable."""


class ClosePathPredictor(Protocol):
    def predict_close_paths(self, request: ForecastRequest) -> list[list[float]]: ...


def _is_utc(value) -> bool:
    return value.tzinfo is not None and value.utcoffset() == timedelta(0)


def _validate_bar(bar: Bar) -> None:
    values = (bar.open, bar.high, bar.low, bar.close, bar.volume)
    if not all(math.isfinite(value) for value in values):
        raise ValueError("OHLCV values must be finite")
    if min(bar.open, bar.high, bar.low, bar.close) <= 0 or bar.volume < 0:
        raise ValueError("OHLC prices must be positive and volume non-negative")
    if bar.high < max(bar.open, bar.close, bar.low) or bar.low > min(bar.open, bar.close, bar.high):
        raise ValueError("OHLC bounds are inconsistent")
    if not _is_utc(bar.ts):
        raise ValueError("Bars must use UTC timestamps")


def build_request(
    bars: list[Bar],
    *,
    as_of,
    asset: str = "BTC",
    timeframe: str = "1d",
    horizons: tuple[int, ...] = ALLOWED_HORIZONS,
    max_context: int = MAX_CONTEXT,
    seed: int = 20260814,
    sample_count: int = 20,
    temperature: float = 1.0,
    top_p: float = 0.9,
) -> ForecastRequest:
    if asset != "BTC" or timeframe != "1d":
        raise ValueError("Kronos shadow evaluation accepts BTC daily bars only")
    if tuple(horizons) != ALLOWED_HORIZONS:
        raise ValueError("Supported horizons are exactly 1, 3, and 7 days")
    if not _is_utc(as_of):
        raise ValueError("as_of must be UTC")
    if max_context < 30 or max_context > MAX_CONTEXT:
        raise ValueError("max_context must be between 30 and 512")
    if sample_count < 3:
        raise ValueError("sample_count must be at least 3")

    ordered = sorted((bar for bar in bars if bar.ts <= as_of), key=lambda item: item.ts)
    if len(ordered) < 30:
        raise ValueError("At least 30 point-in-time bars are required")
    if len({bar.ts for bar in ordered}) != len(ordered):
        raise ValueError("Duplicate bar timestamps are not allowed")
    for index, bar in enumerate(ordered):
        _validate_bar(bar)
        if index and (bar.ts - ordered[index - 1].ts) != timedelta(days=1):
            raise ValueError("BTC daily history must be continuous")

    return ForecastRequest(
        asset=asset,
        timeframe=timeframe,
        as_of=as_of.astimezone(timezone.utc),
        history=tuple(ordered[-max_context:]),
        horizons=ALLOWED_HORIZONS,
        seed=seed,
        sample_count=sample_count,
        temperature=temperature,
        top_p=top_p,
    )


def _quantile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


class KronosShadowAdapter:
    def __init__(self, predictor: ClosePathPredictor):
        self._predictor = predictor

    def forecast(self, request: ForecastRequest) -> ForecastDistribution:
        paths = self._predictor.predict_close_paths(request)
        if len(paths) < 3 or any(len(path) < max(request.horizons) for path in paths):
            raise ValueError("Predictor returned insufficient forecast paths")
        points: list[ForecastPoint] = []
        for days in request.horizons:
            values = [path[days - 1] for path in paths]
            if not all(math.isfinite(value) and value > 0 for value in values):
                raise ValueError("Predictor returned invalid prices")
            lower = _quantile(values, 0.1)
            median = _quantile(values, 0.5)
            upper = _quantile(values, 0.9)
            if not lower <= median <= upper:
                raise ValueError("Predictor returned inverted forecast bounds")
            points.append(
                ForecastPoint(
                    days=days,
                    forecast_for=request.as_of + timedelta(days=days),
                    lower=lower,
                    median=median,
                    upper=upper,
                )
            )
        return ForecastDistribution(
            points=tuple(points),
            seed=request.seed,
            sample_count=request.sample_count,
            temperature=request.temperature,
            top_p=request.top_p,
        )


def _verify_runtime(lock: RuntimeLock) -> None:
    source = lock.runtime_root / "kronos-source"
    manifest_path = lock.runtime_root / "sha256-manifest.json"
    if not (source / ".git").exists() or not manifest_path.exists():
        raise RuntimeUnavailableError("Kronos runtime has not been installed")
    try:
        revision = subprocess.run(
            ["git", "-C", str(source), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as error:
        raise RuntimeUnavailableError("Unable to verify Kronos source revision") from error
    if revision != lock.source_revision:
        raise RuntimeUnavailableError("Kronos source revision mismatch")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    if manifest.get("sourceRevision") != lock.source_revision:
        raise RuntimeUnavailableError("Kronos checksum manifest revision mismatch")
    for item in manifest.get("files", []):
        path = lock.runtime_root / item["path"]
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
            raise RuntimeUnavailableError(f"Kronos runtime checksum mismatch: {item['path']}")


class _UpstreamPathPredictor:
    def __init__(self, predictor, device: str):
        self._predictor = predictor
        self._device = device

    def predict_close_paths(self, request: ForecastRequest) -> list[list[float]]:
        import pandas as pd
        import torch

        frame = pd.DataFrame(
            [
                {
                    "open": bar.open,
                    "high": bar.high,
                    "low": bar.low,
                    "close": bar.close,
                    "volume": bar.volume,
                }
                for bar in request.history
            ]
        )
        x_timestamp = pd.Series([bar.ts for bar in request.history])
        y_timestamp = pd.Series(
            [request.as_of + timedelta(days=day) for day in range(1, max(request.horizons) + 1)]
        )
        paths: list[list[float]] = []
        for sample in range(request.sample_count):
            torch.manual_seed(request.seed + sample)
            if self._device.startswith("cuda"):
                torch.cuda.manual_seed_all(request.seed + sample)
            prediction = self._predictor.predict(
                df=frame,
                x_timestamp=x_timestamp,
                y_timestamp=y_timestamp,
                pred_len=max(request.horizons),
                T=request.temperature,
                top_p=request.top_p,
                sample_count=1,
                verbose=False,
            )
            paths.append([float(value) for value in prediction["close"].tolist()])
        return paths


def load_upstream_predictor(lock: RuntimeLock, device: str) -> KronosShadowAdapter:
    if device not in {"cpu", "cuda"}:
        raise ValueError("device must be cpu or cuda")
    _verify_runtime(lock)
    source = lock.runtime_root / "kronos-source"
    sys.path.insert(0, str(source))
    try:
        from model import Kronos, KronosPredictor, KronosTokenizer

        model_root = lock.runtime_root / "models"
        tokenizer_path = model_root / "tokenizer"
        model_path = model_root / "model"
        tokenizer = KronosTokenizer.from_pretrained(
            tokenizer_path,
            revision=lock.tokenizer_revision,
            local_files_only=True,
        )
        model = Kronos.from_pretrained(
            model_path,
            revision=lock.model_revision,
            local_files_only=True,
        )
        predictor = KronosPredictor(model, tokenizer, device=device, max_context=MAX_CONTEXT)
    except Exception as error:
        raise RuntimeUnavailableError("Unable to load the pinned Kronos runtime") from error
    finally:
        if sys.path and sys.path[0] == str(source):
            sys.path.pop(0)
    return KronosShadowAdapter(_UpstreamPathPredictor(predictor, device))
