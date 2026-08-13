from __future__ import annotations

from decimal import Decimal
from types import MappingProxyType
from urllib.parse import urlsplit

from .contracts import CollectionMode, LicenseScope, Market, SourceDefinition


QUALITY_TIERS = MappingProxyType(
    {
        "official_api": Decimal("1.00"),
        "direct_api": Decimal("1.00"),
        "community_api": Decimal("0.85"),
        "crawl4ai_table": Decimal("0.70"),
        "heuristic": Decimal("0.50"),
    }
)

# Each code is enabled only after its production parser passes a bounded live smoke.
ENABLED_SOURCE_CODES = frozenset(
    {
        "alternative-fng",
        "coinmetrics-community",
        "cryptocraft",
        "defillama-chains",
        "defillama-stablecoins",
        "deribit-public",
        "mempool-space",
    }
)

SOURCE_ROWS = (
    (
        "alternative-fng",
        "Alternative.me Crypto Fear and Greed",
        Market.CRYPTO,
        CollectionMode.API,
        ("https://api.alternative.me/fng/?limit=0&format=json",),
        "daily",
        "alternative-fng-v1",
        2_880,
        "community_api",
        "https://alternative.me/crypto/fear-and-greed-index/",
    ),
    (
        "farside-btc-etf",
        "Farside Bitcoin ETF Flows",
        Market.CRYPTO,
        CollectionMode.CRAWL4AI,
        ("https://farside.co.uk/btc/",),
        "daily",
        "farside-btc-v1",
        2_880,
        "crawl4ai_table",
        "https://farside.co.uk/btc/",
    ),
    (
        "farside-eth-etf",
        "Farside Ethereum ETF Flows",
        Market.CRYPTO,
        CollectionMode.CRAWL4AI,
        ("https://farside.co.uk/eth/",),
        "daily",
        "farside-eth-v1",
        2_880,
        "crawl4ai_table",
        "https://farside.co.uk/eth/",
    ),
    (
        "farside-sol-etf",
        "Farside Solana ETF Flows",
        Market.CRYPTO,
        CollectionMode.CRAWL4AI,
        ("https://farside.co.uk/sol/",),
        "daily",
        "farside-sol-v1",
        2_880,
        "crawl4ai_table",
        "https://farside.co.uk/sol/",
    ),
    (
        "coinmetrics-community",
        "Coin Metrics Community API",
        Market.CRYPTO,
        CollectionMode.API,
        ("https://community-api.coinmetrics.io/v4/timeseries/asset-metrics",),
        "daily",
        "coinmetrics-v1",
        2_880,
        "community_api",
        "https://coinmetrics.io/terms-of-use/",
    ),
    (
        "mempool-space",
        "mempool.space",
        Market.CRYPTO,
        CollectionMode.API,
        (
            "https://mempool.space/api/v1/fees/recommended",
            "https://mempool.space/api/mempool",
            "https://mempool.space/api/v1/mining/hashrate/3y",
        ),
        "daily",
        "mempool-v1",
        1_440,
        "community_api",
        "https://mempool.space/about",
    ),
    (
        "defillama-stablecoins",
        "DefiLlama Stablecoins",
        Market.CRYPTO,
        CollectionMode.API,
        ("https://stablecoins.llama.fi/stablecoincharts/all",),
        "daily",
        "defillama-stablecoins-v1",
        2_880,
        "community_api",
        "https://defillama.com/about",
    ),
    (
        "defillama-chains",
        "DefiLlama Chains",
        Market.CRYPTO,
        CollectionMode.API,
        ("https://api.llama.fi/v2/chains",),
        "daily",
        "defillama-chains-v1",
        1_440,
        "community_api",
        "https://defillama.com/about",
    ),
    (
        "deribit-public",
        "Deribit Public API",
        Market.CRYPTO,
        CollectionMode.API,
        (
            "https://www.deribit.com/api/v2/public/get_volatility_index_data",
            "https://www.deribit.com/api/v2/public/ticker",
        ),
        "daily",
        "deribit-v1",
        1_440,
        "direct_api",
        "https://www.deribit.com/pages/information/terms-of-service",
    ),
    (
        "coinshares-weekly",
        "CoinShares Digital Asset Fund Flows",
        Market.CRYPTO,
        CollectionMode.CRAWL4AI,
        ("https://coinshares.com/insights/research-data/",),
        "weekly",
        "coinshares-v1",
        10_080,
        "crawl4ai_table",
        "https://coinshares.com/insights/research-data/",
    ),
    (
        "bitinfocharts-top-addresses",
        "BitInfoCharts Richest Bitcoin Addresses",
        Market.CRYPTO,
        CollectionMode.CRAWL4AI,
        ("https://bitinfocharts.com/top-100-richest-bitcoin-addresses.html",),
        "daily",
        "bitinfocharts-v1",
        2_880,
        "heuristic",
        "https://bitinfocharts.com/top-100-richest-bitcoin-addresses.html",
    ),
    (
        "cryptocraft",
        "CryptoCraft Economic Calendar",
        Market.MACRO,
        CollectionMode.CRAWL4AI,
        (
            "https://www.cryptocraft.com/calendar?week=this",
            "https://www.cryptocraft.com/calendar?week=next",
        ),
        "calendar",
        "cryptocraft-v1",
        120,
        "crawl4ai_table",
        "https://www.cryptocraft.com/legal.php",
    ),
    (
        "fred",
        "Federal Reserve Economic Data",
        Market.MACRO,
        CollectionMode.API,
        ("https://api.stlouisfed.org/fred/series/observations",),
        "daily",
        "fred-v1",
        4_320,
        "official_api",
        "https://fred.stlouisfed.org/legal/",
    ),
    (
        "cftc-legacy",
        "CFTC Legacy Commitments of Traders",
        Market.GOLD,
        CollectionMode.API,
        ("https://publicreporting.cftc.gov/resource/srt6-5q2f.json",),
        "weekly",
        "cftc-legacy-v1",
        14_400,
        "official_api",
        "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm",
    ),
    (
        "cftc-disaggregated",
        "CFTC Disaggregated Commitments of Traders",
        Market.GOLD,
        CollectionMode.API,
        ("https://publicreporting.cftc.gov/resource/72hh-3qpy.json",),
        "weekly",
        "cftc-disaggregated-v1",
        14_400,
        "official_api",
        "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm",
    ),
    (
        "wgc-gold-etf",
        "World Gold Council ETF Holdings and Flows",
        Market.GOLD,
        CollectionMode.CRAWL4AI,
        ("https://www.gold.org/goldhub/data/gold-etfs-holdings-and-flows",),
        "source_period",
        "wgc-etf-v1",
        20_160,
        "crawl4ai_table",
        "https://www.gold.org/terms-and-conditions",
    ),
    (
        "wgc-central-bank",
        "World Gold Council Gold Reserves",
        Market.GOLD,
        CollectionMode.CRAWL4AI,
        ("https://www.gold.org/goldhub/data/gold-reserves-by-country",),
        "source_period",
        "wgc-central-bank-v1",
        172_800,
        "crawl4ai_table",
        "https://www.gold.org/terms-and-conditions",
    ),
)


def _definition(row: tuple[object, ...]) -> SourceDefinition:
    (
        code,
        name,
        market,
        collection_mode,
        urls,
        schedule,
        parser_version,
        freshness_sla_minutes,
        quality_label,
        terms_url,
    ) = row
    return SourceDefinition(
        code=str(code),
        name=str(name),
        market=Market(market),
        collection_mode=CollectionMode(collection_mode),
        license_scope=(
            LicenseScope.PUBLIC_OFFICIAL
            if str(code) in {"fred", "cftc-legacy", "cftc-disaggregated"}
            else LicenseScope.RESEARCH_ONLY
        ),
        urls=tuple(str(url) for url in urls),  # type: ignore[arg-type]
        schedule=str(schedule),
        freshness_sla_minutes=int(freshness_sla_minutes),
        parser_version=str(parser_version),
        quality_tier=QUALITY_TIERS[str(quality_label)],
        terms_url=str(terms_url),
        enabled=str(code) in ENABLED_SOURCE_CODES,
    )


_SOURCE_DEFINITIONS = tuple(_definition(row) for row in SOURCE_ROWS)
_SOURCES = MappingProxyType({source.code: source for source in _SOURCE_DEFINITIONS})
SOURCE_CODES = tuple(sorted(_SOURCES))


def source_for_code(code: str) -> SourceDefinition:
    return _SOURCES[code]


def sources_for_schedule(schedule: str) -> tuple[SourceDefinition, ...]:
    return tuple(
        sorted(
            (
                source
                for source in _SOURCES.values()
                if source.enabled and source.schedule == schedule
            ),
            key=lambda source: source.code,
        )
    )


def is_source_url_allowed(source: SourceDefinition, url: str) -> bool:
    if url in source.urls:
        return True
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.username or parsed.password:
        return False
    if source.code == "cryptocraft":
        return parsed.hostname == "www.cryptocraft.com" and parsed.path.startswith(
            "/calendar/"
        )
    if source.code == "coinshares-weekly":
        return parsed.hostname == "coinshares.com" and (
            parsed.path.startswith("/insights/research-data/fund-flows-")
            or parsed.path.startswith("/us/insights/research-data/fund-flows-")
        )
    if source.code.startswith("wgc-"):
        return (
            parsed.hostname == "www.gold.org"
            and parsed.path.startswith("/download/file/")
            and parsed.path.lower().endswith(".xlsx")
        )
    return False
