from __future__ import annotations

from decimal import Decimal
import re
from types import MappingProxyType
from urllib.parse import urlsplit

from .contracts import CollectionMode, LicenseScope, Market, SourceDefinition


QUALITY_TIERS = MappingProxyType(
    {
        "official_api": Decimal("1.00"),
        "direct_api": Decimal("1.00"),
        "community_api": Decimal("0.85"),
        "scrapling_table": Decimal("0.70"),
        "heuristic": Decimal("0.50"),
    }
)

# Each code is enabled only after its production parser passes a bounded live smoke.
ENABLED_SOURCE_CODES = frozenset(
    {
        "alternative-fng",
        "bitinfocharts-top-addresses",
        "coinmetrics-community",
        "cryptocraft",
        "defillama-chains",
        "defillama-stablecoins",
        "deribit-public",
        "farside-btc-etf",
        "farside-eth-etf",
        "farside-sol-etf",
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
        CollectionMode.SCRAPLING,
        ("https://farside.co.uk/btc/",),
        "daily",
        "farside-btc-v1",
        2_880,
        "scrapling_table",
        "https://farside.co.uk/btc/",
    ),
    (
        "farside-eth-etf",
        "Farside Ethereum ETF Flows",
        Market.CRYPTO,
        CollectionMode.SCRAPLING,
        ("https://farside.co.uk/eth/",),
        "daily",
        "farside-eth-v1",
        2_880,
        "scrapling_table",
        "https://farside.co.uk/eth/",
    ),
    (
        "farside-sol-etf",
        "Farside Solana ETF Flows",
        Market.CRYPTO,
        CollectionMode.SCRAPLING,
        ("https://farside.co.uk/sol/",),
        "daily",
        "farside-sol-v1",
        2_880,
        "scrapling_table",
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
        CollectionMode.SCRAPLING,
        ("https://coinshares.com/insights/research-data/",),
        "weekly",
        "coinshares-v1",
        10_080,
        "scrapling_table",
        "https://coinshares.com/insights/research-data/",
    ),
    (
        "bitinfocharts-top-addresses",
        "BitInfoCharts Richest Bitcoin Addresses",
        Market.CRYPTO,
        CollectionMode.SCRAPLING,
        ("https://bitinfocharts.com/top-100-richest-bitcoin-addresses.html",),
        "daily",
        "bitinfocharts-v1",
        2_880,
        "heuristic",
        "https://bitinfocharts.com/top-100-richest-bitcoin-addresses.html",
    ),
    (
        "coinglass-margin-borrow",
        "CoinGlass Binance USDT Margin Borrow Rates",
        Market.CRYPTO,
        CollectionMode.SCRAPLING,
        ("https://www.coinglass.com/pro/i/MarginFeeChart",),
        "four-hourly",
        "coinglass-margin-v1",
        480,
        "scrapling_table",
        "https://www.coinglass.com/pro/i/MarginFeeChart",
    ),
    (
        "coinglass-liquidation-maxpain",
        "CoinGlass Liquidation Max Pain",
        Market.CRYPTO,
        CollectionMode.SCRAPLING,
        ("https://www.coinglass.com/liquidation-maxpain",),
        "four-hourly",
        "coinglass-maxpain-v1",
        480,
        "scrapling_table",
        "https://www.coinglass.com/liquidation-maxpain",
    ),
    (
        "blockchaincenter-altcoin-season",
        "BlockchainCenter Altcoin Season Index",
        Market.CRYPTO,
        CollectionMode.SCRAPLING,
        ("https://www.blockchaincenter.net/altcoin-season-index/",),
        "daily",
        "blockchaincenter-altseason-v1",
        2_880,
        "scrapling_table",
        "https://www.blockchaincenter.net/altcoin-season-index/",
    ),
    (
        "cbbi-public",
        "Colin Talks Crypto Bitcoin Bull Run Index",
        Market.CRYPTO,
        CollectionMode.SCRAPLING,
        (
            "https://colintalkscrypto.com/cbbi/",
            "https://colintalkscrypto.com/cbbi/data/latest.json",
        ),
        "daily",
        "cbbi-v1",
        2_880,
        "scrapling_table",
        "https://colintalkscrypto.com/cbbi/",
    ),
    (
        "mempool-btc-large-addresses",
        "mempool.space BTC Large Addresses",
        Market.CRYPTO,
        CollectionMode.API,
        (
            "https://mempool.space/api/address/",
            "https://mempool.space/api/blocks/tip/height",
        ),
        "daily",
        "mempool-btc-large-addresses-v1",
        2_880,
        "community_api",
        "https://mempool.space/about",
    ),
    (
        "cryptocraft",
        "CryptoCraft Economic Calendar",
        Market.MACRO,
        CollectionMode.SCRAPLING,
        (
            "https://www.cryptocraft.com/calendar?week=this",
            "https://www.cryptocraft.com/calendar?week=next",
        ),
        "calendar",
        "cryptocraft-v1",
        120,
        "scrapling_table",
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
    if source.code == "cbbi-public":
        return (
            parsed.hostname == "colintalkscrypto.com"
            and parsed.path in {"/cbbi/", "/cbbi/data/latest.json"}
            and not parsed.query
        )
    if source.code == "coinshares-weekly":
        index_page = (
            parsed.hostname == "coinshares.com"
            and parsed.path == "/insights/research-data/"
            and parsed.query in {f"page={page}" for page in range(1, 6)}
        )
        article = parsed.hostname == "coinshares.com" and (
            parsed.path.startswith("/insights/research-data/fund-flows-")
            or parsed.path.startswith("/us/insights/research-data/fund-flows-")
        )
        image = (
            parsed.hostname == "a.storyblok.com"
            and parsed.path.startswith("/f/176807/")
            and re.search(r"\.(?:png|jpe?g|webp)/m/?$", parsed.path, re.IGNORECASE)
            is not None
        )
        return index_page or article or image
    return False
