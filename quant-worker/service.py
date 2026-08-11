from __future__ import annotations

import os
from hmac import compare_digest

import pandas as pd
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from backtest.market_calendar import annualization_factor
from backtest.optimizer import OptimizerRequest, optimize
from backtest.factors import rank_vietnam_factors


class OptimizePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    returnsBySymbol: dict[str, list[float]] = Field(min_length=1, max_length=10)
    marketBySymbol: dict[str, str]
    timeframe: str = Field(pattern="^(1d|1h)$")
    method: str
    maxWeightBps: int = Field(ge=1, le=10_000)
    totalWeightBps: int = Field(ge=1, le=10_000)
    targetReturnPct: float | None = Field(default=None, ge=-100, le=1_000)
    targetVolatilityPct: float | None = Field(default=None, gt=0, le=1_000)
    riskTolerance: float | None = Field(default=None, gt=0, le=1_000_000)

    @model_validator(mode="after")
    def aligned(self):
        symbols = set(self.returnsBySymbol)
        if symbols != set(self.marketBySymbol):
            raise ValueError("Market inputs must match return symbols.")
        lengths = {len(values) for values in self.returnsBySymbol.values()}
        if len(lengths) != 1 or next(iter(lengths), 0) > 50_000:
            raise ValueError("Return series must be aligned and bounded.")
        return self


class FactorPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pricesBySymbol: dict[str, list[float]] = Field(min_length=5, max_length=100)
    volumesBySymbol: dict[str, list[float]] = Field(min_length=5, max_length=100)
    asOf: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")

    @model_validator(mode="after")
    def aligned(self):
        if set(self.pricesBySymbol) != set(self.volumesBySymbol):
            raise ValueError("Factor symbols must align.")
        lengths = {
            *(len(value) for value in self.pricesBySymbol.values()),
            *(len(value) for value in self.volumesBySymbol.values()),
        }
        if len(lengths) != 1 or next(iter(lengths), 0) > 5_000:
            raise ValueError("Factor histories must be aligned and bounded.")
        return self


def require_token(authorization: str | None = Header(default=None)) -> None:
    expected = os.getenv("QUANT_ENGINE_API_TOKEN")
    if not expected:
        return
    supplied = authorization.removeprefix("Bearer ") if authorization else ""
    if not supplied or not compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


app = FastAPI(title="Quant Insight Engine", version="1.0.0", docs_url=None, redoc_url=None)


@app.get("/healthz")
def health() -> dict[str, str]:
    return {"status": "ok", "engine": "quant-engine-v1"}


@app.post("/v1/optimize", dependencies=[Depends(require_token)])
def optimize_endpoint(payload: OptimizePayload):
    try:
        frame = pd.DataFrame(payload.returnsBySymbol)
        return optimize(
            OptimizerRequest(
                returns=frame,
                method=payload.method,
                max_weight=payload.maxWeightBps / 10_000,
                total_weight=payload.totalWeightBps / 10_000,
                annualization_by_symbol={
                    symbol: annualization_factor(market, payload.timeframe)
                    for symbol, market in payload.marketBySymbol.items()
                },
                target_return_pct=payload.targetReturnPct,
                target_volatility_pct=payload.targetVolatilityPct,
                risk_tolerance=payload.riskTolerance,
            )
        )
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.post("/v1/factors/vietnam", dependencies=[Depends(require_token)])
def vietnam_factors_endpoint(payload: FactorPayload):
    try:
        return rank_vietnam_factors(
            pd.DataFrame(payload.pricesBySymbol),
            pd.DataFrame(payload.volumesBySymbol),
            as_of=payload.asOf,
        )
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
