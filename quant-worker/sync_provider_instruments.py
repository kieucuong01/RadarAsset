from __future__ import annotations

import json
from collections.abc import Iterable, Sequence
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

import psycopg

from backtest.providers import (
    BinanceSpotAdapter,
    ProviderInstrumentDescriptor,
    VnstockAdapter,
)
from backtest.catalog import FEEDS
from ingest_market_data import load_database_url, psycopg_connection_url


PROVIDERS = {
    "binance-public": (
        "Binance Public Spot",
        "https://developers.binance.com/en/docs/products/spot/rest-api",
    ),
    "vnstock-vci-free": ("Vnstock VCI Free", "https://vnstocks.com/docs/vnstock"),
    "msn-via-vnstock": (
        "MSN via Vnstock",
        "https://vnstocks.com/docs/vnstock-data/market-layer-v3",
    ),
}


def provider_code(descriptor: ProviderInstrumentDescriptor) -> str:
    if descriptor.market == "crypto_spot":
        return "binance-public"
    if descriptor.market == "metal_spot":
        return "msn-via-vnstock"
    if descriptor.market == "vn_equity":
        return "vnstock-vci-free"
    raise ValueError("Unsupported provider instrument market.")


def select_provider_instruments(
    descriptors: Iterable[ProviderInstrumentDescriptor],
) -> list[ProviderInstrumentDescriptor]:
    reserved_non_crypto_symbols = {
        feed.symbol for feed in FEEDS.values() if feed.market != "crypto_spot"
    }
    selected = [
        descriptor
        for descriptor in descriptors
        if not (
            descriptor.market == "crypto_spot"
            and descriptor.canonical_symbol in reserved_non_crypto_symbols
        )
    ]
    return sorted(selected, key=lambda item: (item.canonical_symbol, item.market))


def sync_provider_instruments(
    connection: psycopg.Connection[Any],
    descriptors: Iterable[ProviderInstrumentDescriptor],
) -> int:
    rows = sorted(
        select_provider_instruments(descriptors),
        key=lambda item: (provider_code(item), item.canonical_symbol),
    )
    reserved_non_crypto_symbols = sorted(
        feed.symbol for feed in FEEDS.values() if feed.market != "crypto_spot"
    )
    synchronized = 0
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                DELETE FROM provider_instruments pi
                USING data_providers p, assets a
                WHERE pi.provider_id = p.id
                  AND pi.asset_id = a.id
                  AND p.code = 'binance-public'
                  AND a.symbol = ANY(%s)
                """,
                (reserved_non_crypto_symbols,),
            )
            for descriptor in rows:
                code = provider_code(descriptor)
                name, terms_url = PROVIDERS[code]
                cursor.execute(
                    """
                    INSERT INTO data_providers (
                        id, code, name, terms_url, license_scope, status, created_at, updated_at
                    ) VALUES (
                        gen_random_uuid(), %s, %s, %s, 'research_only', 'active', NOW(), NOW()
                    )
                    ON CONFLICT (code) DO UPDATE SET
                        name = EXCLUDED.name,
                        terms_url = EXCLUDED.terms_url,
                        status = 'active',
                        updated_at = NOW()
                    RETURNING id
                    """,
                    (code, name, terms_url),
                )
                provider_id = cursor.fetchone()[0]
                asset_class = {
                    "crypto_spot": "crypto",
                    "vn_equity": "equity",
                    "metal_spot": "commodity",
                }[descriptor.market]
                canonical_key = f"{descriptor.market}:{descriptor.venue}:{descriptor.provider_symbol}"
                cursor.execute(
                    """
                    INSERT INTO assets (
                        id, symbol, canonical_key, name, asset_class, market, venue,
                        timezone, max_leverage, currency, provider, provider_symbol,
                        created_at, updated_at
                    ) VALUES (
                        gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, NOW(), NOW()
                    )
                    ON CONFLICT (symbol) DO UPDATE SET
                        name = EXCLUDED.name,
                        asset_class = EXCLUDED.asset_class,
                        market = EXCLUDED.market,
                        venue = EXCLUDED.venue,
                        currency = EXCLUDED.currency,
                        provider = EXCLUDED.provider,
                        provider_symbol = EXCLUDED.provider_symbol,
                        updated_at = NOW()
                    RETURNING id
                    """,
                    (
                        descriptor.canonical_symbol,
                        canonical_key,
                        descriptor.name,
                        asset_class,
                        descriptor.market,
                        descriptor.venue,
                        "Asia/Ho_Chi_Minh" if descriptor.market == "vn_equity" else "UTC",
                        Decimal("2") if descriptor.market == "vn_equity" else Decimal("1"),
                        descriptor.currency,
                        code,
                        descriptor.provider_symbol,
                    ),
                )
                asset_id = cursor.fetchone()[0]
                metadata = {
                    "catalogSynchronizedAt": datetime.now(timezone.utc).isoformat(),
                    "source": "approved-provider-catalog",
                }
                cursor.execute(
                    """
                    INSERT INTO provider_instruments (
                        id, provider_id, asset_id, provider_symbol, metadata, created_at
                    ) VALUES (gen_random_uuid(), %s, %s, %s, %s::jsonb, NOW())
                    ON CONFLICT (provider_id, asset_id) DO UPDATE SET
                        provider_symbol = EXCLUDED.provider_symbol,
                        metadata = EXCLUDED.metadata
                    """,
                    (
                        provider_id,
                        asset_id,
                        descriptor.provider_symbol,
                        json.dumps(metadata, separators=(",", ":")),
                    ),
                )
                synchronized += 1
    return synchronized


def main(argv: Sequence[str] | None = None) -> int:
    del argv
    try:
        descriptors = [
            *BinanceSpotAdapter().list_instruments(),
            *VnstockAdapter().list_instruments(),
        ]
        url = psycopg_connection_url(load_database_url(Path(".env.local")))
        with psycopg.connect(url, autocommit=False) as connection:
            count = sync_provider_instruments(connection, descriptors)
        print(json.dumps({"status": "succeeded", "synchronized": count}, separators=(",", ":")))
        return 0
    except Exception:
        print(json.dumps({"status": "failed", "errorCode": "catalog_sync_failed"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
