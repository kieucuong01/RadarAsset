from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True, slots=True)
class InputRule:
    pillar_code: str
    input_weight: Decimal
    normalization_method: str = "source_signal"


PILLAR_WEIGHTS_BY_MARKET = {
    "crypto": {
        "trend": Decimal("0.40"),
        "fund_flow": Decimal("0.30"),
        "macro": Decimal("0.15"),
        "sentiment_onchain": Decimal("0.15"),
    },
    "gold": {
        "trend": Decimal("0.55"),
        "macro": Decimal("0.30"),
        "positioning": Decimal("0.15"),
    },
    "equity": {
        "trend": Decimal("0.50"),
        "relative_liquidity": Decimal("0.30"),
        "foreign_flow": Decimal("0.20"),
    },
    "stock_vn": {
        "trend": Decimal("0.50"),
        "relative_liquidity": Decimal("0.30"),
        "foreign_flow": Decimal("0.20"),
    },
}

TREND_RULES = {
    "market.return_20d": InputRule("trend", Decimal("0.25")),
    "market.return_60d": InputRule("trend", Decimal("0.25")),
    "market.ma_50_position": InputRule("trend", Decimal("0.20")),
    "market.ma_200_position": InputRule("trend", Decimal("0.20")),
    "market.current_drawdown": InputRule("trend", Decimal("0.10")),
}

CRYPTO_RULES = {
    "crypto.etf.net_flow_usd": InputRule("fund_flow", Decimal("0.75")),
    "crypto.coinshares.net_flow_usd": InputRule("fund_flow", Decimal("0.25")),
    "crypto.fear_greed.index": InputRule(
        "sentiment_onchain", Decimal("0.60"), "fear_greed_centered_v1"
    ),
    "crypto.onchain.adjusted_transfer_usd": InputRule(
        "sentiment_onchain", Decimal("0.15")
    ),
    "crypto.onchain.active_addresses": InputRule(
        "sentiment_onchain", Decimal("0.15")
    ),
    "crypto.onchain.nvt": InputRule("sentiment_onchain", Decimal("0.10")),
}

CRYPTO_MACRO_RULES = {
    "macro.real_yield.10y_pct": InputRule("macro", Decimal("0.25")),
    "macro.usd_broad_index": InputRule("macro", Decimal("0.25")),
    "macro.fed_balance_sheet_change_4w": InputRule("macro", Decimal("0.20")),
    "macro.reverse_repo_change_4w": InputRule("macro", Decimal("0.10")),
    "macro.tga_change_4w": InputRule("macro", Decimal("0.10")),
    "macro.growth_surprise": InputRule("macro", Decimal("0.05")),
    "macro.inflation_surprise": InputRule("macro", Decimal("0.05")),
    "macro.regime.score": InputRule("macro", Decimal("1.00")),
}

GOLD_RULES = {
    "macro.real_yield.10y_pct": InputRule("macro", Decimal("0.55")),
    "macro.usd_broad_index": InputRule("macro", Decimal("0.45")),
    "macro.regime.score": InputRule("macro", Decimal("1.00")),
    "gold.cftc.managed_money_net_oi": InputRule("positioning", Decimal("1.00")),
}


def pillar_weights(market: str) -> dict[str, Decimal]:
    return dict(PILLAR_WEIGHTS_BY_MARKET.get(market, {"trend": Decimal("1.00")}))


def input_rule(market: str, metric_code: str) -> InputRule | None:
    if metric_code in TREND_RULES:
        return TREND_RULES[metric_code]
    if metric_code == "market.relative_strength_20d" and market in {"equity", "stock_vn"}:
        return InputRule("relative_liquidity", Decimal("0.60"))
    if market == "crypto":
        return CRYPTO_RULES.get(metric_code) or CRYPTO_MACRO_RULES.get(metric_code)
    if market == "gold":
        return GOLD_RULES.get(metric_code)
    if market in {"equity", "stock_vn"}:
        if metric_code.startswith("equity.liquidity."):
            return InputRule("relative_liquidity", Decimal("0.40"))
        if metric_code.startswith("equity.foreign_flow."):
            return InputRule("foreign_flow", Decimal("1.00"))
    return None
