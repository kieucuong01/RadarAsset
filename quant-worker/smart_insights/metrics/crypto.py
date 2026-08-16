from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from types import MappingProxyType


METHODOLOGY_VERSION = "crypto-regime-v1"

CRYPTO_GROUP_WEIGHTS = {
    "momentum": Decimal("0.20"),
    "flow": Decimal("0.25"),
    "liquidity": Decimal("0.15"),
    "onchain": Decimal("0.20"),
    "derivatives": Decimal("0.10"),
    "sentiment": Decimal("0.10"),
}

CRYPTO_GROUP_COMPONENTS = {
    "momentum": (
        "price.btc.momentum_20d",
        "price.eth.momentum_20d",
        "price.sol.momentum_20d",
    ),
    "flow": (
        "crypto.etf.net_flow_usd_5d",
        "crypto.coinshares.net_flow_usd",
    ),
    "liquidity": (
        "crypto.stablecoin.supply_change_7d",
        "crypto.defi.tvl_change_7d",
    ),
    "onchain": (
        "crypto.onchain.adjusted_transfer_change_30d",
        "crypto.onchain.active_addresses_change_30d",
        "crypto.onchain.nvt",
        "crypto.network.hashrate_change_30d",
    ),
    "derivatives": (
        "crypto.derivatives.btc_dvol",
        "crypto.derivatives.eth_dvol",
        "crypto.derivatives.abs_funding_percentile",
    ),
    "sentiment": ("crypto.fear_greed.index",),
}

CBBI_COMPONENTS = MappingProxyType(
    {
        "PiCycle": "pi_cycle",
        "RUPL": "rupl_nupl",
        "RHODL": "rhodl",
        "Puell": "puell",
        "2YMA": "two_year_ma",
        "Trolololo": "trolololo",
        "MVRV": "mvrv",
        "ReserveRisk": "reserve_risk",
        "Woobull": "woobull",
    }
)


@dataclass(frozen=True, slots=True)
class MetricDefinitionInput:
    code: str
    name: str
    unit: str
    frequency: str
    direction: int
    freshness_sla_minutes: int
    market: str = "crypto"
    methodology_version: str = METHODOLOGY_VERSION
    metadata: Mapping[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ObservationPoint:
    id: str
    metric_code: str
    value: Decimal
    effective_at: datetime
    observed_at: datetime
    provider_code: str
    quality_status: str
    natural_key: str
    revision: int
    dimensions: Mapping[str, str] = field(default_factory=dict)
    asset_symbol: str | None = None


@dataclass(frozen=True, slots=True)
class MarketClose:
    id: str
    asset_symbol: str
    ts: datetime
    close: Decimal
    observed_at: datetime


@dataclass(frozen=True, slots=True)
class SnapshotMetricInput:
    metric_code: str
    value: Decimal
    score: Decimal | None
    percentile: Decimal | None
    configured_weight: Decimal
    effective_at: datetime
    observed_at: datetime
    source_observation_ids: tuple[str, ...]
    quality_tier: Decimal
    validation_status: str
    is_fresh: bool


@dataclass(frozen=True, slots=True)
class SignalSnapshotInput:
    market: str
    asset_symbol: str | None
    effective_at: datetime
    methodology_version: str
    signal_type: str
    score: Decimal | None
    label: str
    data_confidence: Decimal
    coverage: Decimal
    inputs: tuple[SnapshotMetricInput, ...]
    status: str
    idempotency_key: str


def _definition(
    code: str,
    name: str,
    unit: str,
    frequency: str,
    direction: int,
    sla: int,
    **metadata: object,
) -> MetricDefinitionInput:
    return MetricDefinitionInput(
        code=code,
        name=name,
        unit=unit,
        frequency=frequency,
        direction=direction,
        freshness_sla_minutes=sla,
        metadata=metadata,
    )


_RAW_DEFINITIONS = (
    _definition("crypto.fear_greed.index", "Crypto Fear and Greed", "index", "daily", 1, 2880, source="alternative-fng"),
    _definition("crypto.etf.net_flow_usd", "Crypto ETF net flow", "USD", "source_trading_day", 1, 2880, source="farside"),
    _definition("crypto.onchain.adjusted_transfer_usd", "Adjusted transfer value", "USD", "daily", 1, 2880, source="coinmetrics-community"),
    _definition("crypto.onchain.active_addresses", "Active addresses", "addresses", "daily", 1, 2880, source="coinmetrics-community"),
    _definition("crypto.onchain.mvrv", "MVRV", "ratio", "daily", 0, 2880, source="coinmetrics-community", evidence_only=True),
    _definition("crypto.onchain.nvt", "NVT", "ratio", "daily", -1, 2880, source="coinmetrics-community"),
    _definition("crypto.onchain.sopr", "SOPR", "ratio", "daily", 0, 2880, source="coinmetrics-community", evidence_only=True),
    _definition("crypto.onchain.nupl", "NUPL", "ratio", "daily", 0, 2880, source="coinmetrics-community", evidence_only=True),
    _definition("crypto.stablecoin.supply_usd", "Stablecoin supply", "USD", "daily", 1, 2880, source="defillama-stablecoins"),
    _definition("crypto.defi.chain_tvl_usd", "Chain TVL", "USD", "observed_daily", 1, 1440, source="defillama-chains"),
    _definition("crypto.network.hashrate_hs", "Bitcoin hashrate", "H/s", "daily", 1, 2880, source="mempool-space"),
    _definition("crypto.network.difficulty", "Bitcoin difficulty", "index", "daily", 0, 2880, source="mempool-space", evidence_only=True),
    _definition("crypto.derivatives.btc_dvol", "BTC DVOL close", "index", "daily", -1, 1440, source="deribit-public"),
    _definition("crypto.derivatives.eth_dvol", "ETH DVOL close", "index", "daily", -1, 1440, source="deribit-public"),
    _definition("crypto.derivatives.funding_rate", "Perpetual funding rate", "rate", "observed_daily", -1, 1440, source="deribit-public"),
    _definition("crypto.derivatives.open_interest", "Perpetual open interest", "native", "observed_daily", 0, 1440, source="deribit-public", evidence_only=True),
    _definition("crypto.coinshares.net_flow_usd", "Weekly digital asset fund flow", "USD", "weekly", 1, 10080, source="coinshares-weekly"),
    _definition("crypto.coinshares.aum_usd", "Digital asset fund AUM", "USD", "weekly", 0, 10080, source="coinshares-weekly", evidence_only=True),
    _definition("crypto.derivatives.margin_borrow.annualized_rate", "Margin borrow annualized rate", "percent", "observed_daily", 0, 2880, source="coinglass-margin-borrow", evidence_only=True),
    _definition("crypto.derivatives.margin_borrow.daily_rate", "Margin borrow daily rate", "percent", "observed_daily", 0, 2880, source="coinglass-margin-borrow", evidence_only=True),
    _definition("crypto.derivatives.margin_borrow.hourly_rate", "Margin borrow hourly rate", "percent", "observed_daily", 0, 2880, source="coinglass-margin-borrow", evidence_only=True),
    _definition("crypto.derivatives.liquidation.current_price_usd", "Liquidation max-pain current price", "USD", "observed_daily", 0, 2880, source="coinglass-liquidation-maxpain", evidence_only=True),
    _definition("crypto.derivatives.liquidation.long_max_pain_price_usd", "Long liquidation max-pain price", "USD", "observed_daily", 0, 2880, source="coinglass-liquidation-maxpain", evidence_only=True),
    _definition("crypto.derivatives.liquidation.short_max_pain_price_usd", "Short liquidation max-pain price", "USD", "observed_daily", 0, 2880, source="coinglass-liquidation-maxpain", evidence_only=True),
    _definition("crypto.derivatives.liquidation.long_max_pain_level_usd", "Long liquidation max-pain level", "USD", "observed_daily", 0, 2880, source="coinglass-liquidation-maxpain", evidence_only=True),
    _definition("crypto.derivatives.liquidation.short_max_pain_level_usd", "Short liquidation max-pain level", "USD", "observed_daily", 0, 2880, source="coinglass-liquidation-maxpain", evidence_only=True),
    _definition("crypto.derivatives.liquidation.long_distance_ratio", "Long liquidation max-pain distance", "ratio", "observed_daily", 0, 2880, source="coinglass-liquidation-maxpain", evidence_only=True),
    _definition("crypto.derivatives.liquidation.short_distance_ratio", "Short liquidation max-pain distance", "ratio", "observed_daily", 0, 2880, source="coinglass-liquidation-maxpain", evidence_only=True),
    _definition("crypto.cycle.altcoin_season.index", "Altcoin Season Index", "index", "daily", 0, 2880, source="blockchaincenter-altcoin-season", evidence_only=True),
    _definition("crypto.cycle.cbbi.confidence", "CBBI Confidence", "percent", "daily", 0, 2880, source="cbbi-public", evidence_only=True),
)

_CBBI_COMPONENT_DEFINITIONS = tuple(
    _definition(
        f"crypto.cycle.cbbi.component.{slug}",
        f"CBBI {provider_name}",
        "percent",
        "daily",
        0,
        2_880,
        source="cbbi-public",
        evidence_only=True,
    )
    for provider_name, slug in CBBI_COMPONENTS.items()
)

_MEMPOOL_DEFINITIONS = tuple(
    _definition(code, name, unit, "instant", 0, 1440, source="mempool-space", evidence_only=True)
    for code, name, unit in (
        ("crypto.network.fee.fastest_sat_vb", "Fastest fee", "sat/vB"),
        ("crypto.network.fee.half_hour_sat_vb", "Half-hour fee", "sat/vB"),
        ("crypto.network.fee.hour_sat_vb", "One-hour fee", "sat/vB"),
        ("crypto.network.fee.economy_sat_vb", "Economy fee", "sat/vB"),
        ("crypto.network.fee.minimum_sat_vb", "Minimum fee", "sat/vB"),
        ("crypto.network.mempool.transaction_count", "Mempool transactions", "transactions"),
        ("crypto.network.mempool.vsize_bytes", "Mempool virtual size", "bytes"),
        ("crypto.network.mempool.total_fee_sats", "Mempool total fees", "sats"),
    )
)

_DVOL_OHLC_DEFINITIONS = tuple(
    _definition(
        f"crypto.derivatives.{asset}_dvol.{field}",
        f"{asset.upper()} DVOL {field}",
        "index",
        "daily",
        0,
        1440,
        source="deribit-public",
        evidence_only=True,
    )
    for asset in ("btc", "eth")
    for field in ("open", "high", "low")
)

_LARGE_ADDRESS_DEFINITIONS = tuple(
    _definition(code, name, unit, "observed_daily", 0, 2880, source="bitinfocharts-top-addresses", quality_tier="heuristic", evidence_only=True)
    for code, name, unit in (
        ("crypto.large_address.tracked_balance_btc", "Top-address tracked balance", "BTC"),
        ("crypto.large_address.reviewed_non_exchange_balance_btc", "Reviewed non-exchange balance", "BTC"),
        ("crypto.large_address.excluded_balance_btc", "Excluded entity balance", "BTC"),
        ("crypto.large_address.labelled_balance_btc", "Labelled address balance", "BTC"),
        ("crypto.large_address.tracked_address_count", "Tracked address count", "addresses"),
        ("crypto.large_address.excluded_address_count", "Excluded address count", "addresses"),
        ("crypto.large_address.labelled_address_count", "Labelled address count", "addresses"),
        ("crypto.large_address.label_coverage", "Address label coverage", "ratio"),
        ("crypto.large_address.address_balance_btc", "Reviewed address balance", "BTC"),
        ("crypto.large_address.balance_change_btc", "Large-address balance change", "BTC"),
    )
)

_VERIFIED_LARGE_ADDRESS_DEFINITIONS = tuple(
    _definition(
        code,
        name,
        unit,
        "daily",
        0,
        2_880,
        source="mempool-btc-large-addresses",
        evidence_only=True,
    )
    for code, name, unit in (
        ("crypto.large_address.confirmed_balance_btc", "Confirmed large-address balance", "BTC"),
        ("crypto.large_address.confirmed_incoming_btc", "Confirmed large-address incoming value", "BTC"),
        ("crypto.large_address.confirmed_outgoing_btc", "Confirmed large-address outgoing value", "BTC"),
        ("crypto.large_address.net_accumulation_btc", "Common-cohort net accumulation", "BTC"),
        ("crypto.large_address.accumulation_breadth", "Large-address accumulation breadth", "ratio"),
        ("crypto.large_address.distribution_breadth", "Large-address distribution breadth", "ratio"),
        ("crypto.large_address.to_exchange_btc", "Large-address to exchange flow", "BTC"),
        ("crypto.large_address.from_exchange_btc", "Exchange to large-address flow", "BTC"),
        ("crypto.large_address.exchange_flow_pressure_btc", "Large-address exchange flow pressure", "BTC"),
        ("crypto.large_address.dormant_to_exchange_btc", "Dormant large-address to exchange flow", "BTC"),
        ("crypto.large_address.dormant_from_exchange_btc", "Exchange to dormant large-address flow", "BTC"),
        ("crypto.large_address.top10_concentration", "Top 10 tracked-address concentration", "ratio"),
        ("crypto.large_address.address_coverage", "Large-address balance coverage", "ratio"),
        ("crypto.large_address.transaction_coverage", "Large-address transaction coverage", "ratio"),
        ("crypto.large_address.flow_label_coverage", "Large-address flow label coverage", "ratio"),
    )
)

_DERIVED_DEFINITIONS = (
    _definition("price.btc.momentum_20d", "BTC 20-day momentum", "return", "daily", 1, 2880, lookback=20),
    _definition("price.eth.momentum_20d", "ETH 20-day momentum", "return", "daily", 1, 2880, lookback=20),
    _definition("price.sol.momentum_20d", "SOL 20-day momentum", "return", "daily", 1, 2880, lookback=20),
    _definition("crypto.etf.net_flow_usd_5d", "Five-trading-day crypto ETF flow", "USD", "source_trading_day", 1, 2880, lookback=5),
    _definition("crypto.stablecoin.supply_change_7d", "Stablecoin supply change", "return", "daily", 1, 2880, lookback=7),
    _definition("crypto.defi.tvl_change_7d", "DeFi TVL change", "return", "observed_daily", 1, 1440, lookback=7),
    _definition("crypto.onchain.adjusted_transfer_change_30d", "Adjusted transfer change", "return", "daily", 1, 2880, lookback=30),
    _definition("crypto.onchain.active_addresses_change_30d", "Active addresses change", "return", "daily", 1, 2880, lookback=30),
    _definition("crypto.network.hashrate_change_30d", "Hashrate change", "return", "daily", 1, 2880, lookback=30),
    _definition("crypto.derivatives.abs_funding_percentile", "Absolute perpetual funding crowding", "rate", "observed_daily", -1, 1440),
    _definition("crypto.regime.score", "Crypto Regime Score", "score", "daily", 1, 2880),
)

CRYPTO_METRIC_DEFINITIONS = (
    _RAW_DEFINITIONS
    + _CBBI_COMPONENT_DEFINITIONS
    + _MEMPOOL_DEFINITIONS
    + _DVOL_OHLC_DEFINITIONS
    + _LARGE_ADDRESS_DEFINITIONS
    + _VERIFIED_LARGE_ADDRESS_DEFINITIONS
    + _DERIVED_DEFINITIONS
)

METRIC_DEFINITIONS_BY_CODE = {
    definition.code: definition for definition in CRYPTO_METRIC_DEFINITIONS
}

COMPONENT_WEIGHTS = {
    component: CRYPTO_GROUP_WEIGHTS[group] / Decimal(len(components))
    for group, components in CRYPTO_GROUP_COMPONENTS.items()
    for component in components
}
