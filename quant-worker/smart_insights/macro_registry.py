from __future__ import annotations

from dataclasses import dataclass
import re
from types import MappingProxyType


@dataclass(frozen=True, slots=True)
class FredSeriesDefinition:
    series_id: str
    metric_code: str
    name: str
    unit: str
    frequency: str
    direction: int


def _series(
    series_id: str,
    metric_code: str,
    name: str,
    unit: str,
    frequency: str,
    direction: int,
) -> FredSeriesDefinition:
    return FredSeriesDefinition(
        series_id=series_id,
        metric_code=metric_code,
        name=name,
        unit=unit,
        frequency=frequency,
        direction=direction,
    )


FRED_SERIES = MappingProxyType(
    {
        "DGS2": _series("DGS2", "macro.yield.2y_pct", "US Treasury 2Y Yield", "%", "daily", -1),
        "DGS10": _series("DGS10", "macro.yield.10y_pct", "US Treasury 10Y Yield", "%", "daily", -1),
        "DFII10": _series("DFII10", "macro.real_yield.10y_pct", "US 10Y Real Yield", "%", "daily", -1),
        "DFF": _series("DFF", "macro.fed_funds_pct", "Effective Federal Funds Rate", "%", "daily", -1),
        "SOFR": _series("SOFR", "macro.sofr_pct", "Secured Overnight Financing Rate", "%", "daily", -1),
        "WALCL": _series("WALCL", "macro.fed_balance_sheet_musd", "Federal Reserve Total Assets", "USD million", "weekly", 1),
        "RRPONTSYD": _series("RRPONTSYD", "macro.reverse_repo_busd", "Overnight Reverse Repo", "USD billion", "daily", -1),
        "WTREGEN": _series("WTREGEN", "macro.tga_busd", "US Treasury General Account", "USD billion", "weekly", -1),
        "DTWEXBGS": _series("DTWEXBGS", "macro.usd_broad_index", "Trade Weighted US Dollar Index", "index", "daily", -1),
        "CPIAUCSL": _series("CPIAUCSL", "macro.cpi_index", "Consumer Price Index", "index", "monthly", 0),
        "CPILFESL": _series("CPILFESL", "macro.core_cpi_index", "Core Consumer Price Index", "index", "monthly", 0),
        "PCEPI": _series("PCEPI", "macro.pce_index", "PCE Price Index", "index", "monthly", 0),
        "PAYEMS": _series("PAYEMS", "macro.payroll_thousands", "Total Nonfarm Payrolls", "thousand", "monthly", 1),
        "UNRATE": _series("UNRATE", "macro.unemployment_pct", "Unemployment Rate", "%", "monthly", -1),
        "GDP": _series("GDP", "macro.gdp_busd", "US Gross Domestic Product", "USD billion", "quarterly", 1),
    }
)


@dataclass(frozen=True, slots=True)
class CftcMarketDefinition:
    market_code: str
    source_code: str
    dataset_id: str
    contract_market_code: str
    classification: str
    metric_prefix: str
    net_oi_metric: str


def _cftc_market(
    market_code: str,
    source_code: str,
    dataset_id: str,
    contract_market_code: str,
    classification: str,
    metric_prefix: str,
    net_oi_metric: str,
) -> CftcMarketDefinition:
    return CftcMarketDefinition(
        market_code=market_code,
        source_code=source_code,
        dataset_id=dataset_id,
        contract_market_code=contract_market_code,
        classification=classification,
        metric_prefix=metric_prefix,
        net_oi_metric=net_oi_metric,
    )


CFTC_MARKETS = MappingProxyType(
    {
        "BTC": _cftc_market("BTC", "cftc-legacy", "srt6-5q2f", "133741", "noncommercial", "macro.cftc.btc", "macro.cftc.btc_net_oi"),
        "USD_INDEX": _cftc_market("USD_INDEX", "cftc-legacy", "srt6-5q2f", "098662", "noncommercial", "macro.cftc.usd_index", "macro.cftc.usd_index_net_oi"),
        "SP500_EMINI": _cftc_market("SP500_EMINI", "cftc-legacy", "srt6-5q2f", "13874A", "noncommercial", "macro.cftc.sp500", "macro.cftc.sp500_net_oi"),
        "NASDAQ100_MINI": _cftc_market("NASDAQ100_MINI", "cftc-legacy", "srt6-5q2f", "209742", "noncommercial", "macro.cftc.nasdaq100", "macro.cftc.nasdaq100_net_oi"),
        "GOLD": _cftc_market("GOLD", "cftc-disaggregated", "72hh-3qpy", "088691", "managed_money", "gold.cftc.managed_money", "gold.cftc.managed_money_net_oi"),
    }
)


@dataclass(frozen=True, slots=True)
class SurpriseEventDefinition:
    category: str
    direction: int
    series_key: str


_EVENT_SLUG = re.compile(r"[^a-z0-9]+")


def classify_surprise_event(
    country: str, currency: str, event_name: str
) -> SurpriseEventDefinition | None:
    normalized = " ".join(event_name.casefold().split())
    inflation_terms = (
        "core cpi",
        "cpi",
        "core pce",
        "pce price",
        "core ppi",
        "ppi",
        "inflation expectations",
    )
    negative_growth_terms = (
        "unemployment",
        "jobless claims",
        "unemployment claims",
        "claimant count",
    )
    positive_growth_terms = (
        "gdp",
        "retail sales",
        "nonfarm payroll",
        "payroll",
        "employment change",
        "pmi",
    )
    if any(term in normalized for term in inflation_terms):
        category, direction = "inflation", -1
    elif any(term in normalized for term in negative_growth_terms):
        category, direction = "growth", -1
    elif any(term in normalized for term in positive_growth_terms):
        category, direction = "growth", 1
    else:
        return None
    slug = _EVENT_SLUG.sub("-", normalized).strip("-")
    series_key = (
        f"cryptocraft-surprise:{category}:{country.upper()}:{currency.upper()}:{slug}"
    )
    return SurpriseEventDefinition(category, direction, series_key)
