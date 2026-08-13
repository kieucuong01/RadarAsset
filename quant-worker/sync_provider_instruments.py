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
            selected_catalog = json.dumps(
                [
                    {
                        "provider_code": provider_code(row),
                        "provider_symbol": row.provider_symbol,
                        "canonical_symbol": row.canonical_symbol,
                    }
                    for row in rows
                ],
                separators=(",", ":"),
            )
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
            cursor.execute(
                """
                WITH selected AS (
                  SELECT *
                  FROM jsonb_to_recordset(%s::jsonb) AS row(
                    provider_code text,
                    provider_symbol text,
                    canonical_symbol text
                  )
                ),
                stale AS (
                  SELECT pi.id
                  FROM provider_instruments pi
                  JOIN data_providers provider ON provider.id = pi.provider_id
                  JOIN assets asset ON asset.id = pi.asset_id
                  LEFT JOIN selected
                    ON selected.provider_code = provider.code
                   AND selected.provider_symbol = pi.provider_symbol
                   AND selected.canonical_symbol = asset.symbol
                  WHERE provider.code IN ('binance-public', 'vnstock-vci-free', 'msn-via-vnstock')
                    AND selected.provider_code IS NULL
                )
                DELETE FROM market_ingestion_requests request
                USING stale
                WHERE request.provider_instrument_id = stale.id
                  AND request.status IN ('queued', 'running')
                """,
                (selected_catalog,),
            )
            cursor.execute(
                """
                WITH selected AS (
                  SELECT *
                  FROM jsonb_to_recordset(%s::jsonb) AS row(
                    provider_code text,
                    provider_symbol text,
                    canonical_symbol text
                  )
                )
                DELETE FROM provider_instruments pi
                USING data_providers provider, assets asset
                WHERE pi.provider_id = provider.id
                  AND pi.asset_id = asset.id
                  AND provider.code IN ('binance-public', 'vnstock-vci-free', 'msn-via-vnstock')
                  AND NOT EXISTS (
                    SELECT 1
                    FROM selected
                    WHERE selected.provider_code = provider.code
                      AND selected.provider_symbol = pi.provider_symbol
                      AND selected.canonical_symbol = asset.symbol
                  )
                  AND NOT EXISTS (
                    SELECT 1
                    FROM datasets dataset
                    JOIN dataset_versions version ON version.dataset_id = dataset.id
                    WHERE dataset.asset_id = asset.id
                      AND version.is_active = true
                  )
                """,
                (selected_catalog,),
            )
    return synchronized


def queue_market_ingestion_requests(
    connection: psycopg.Connection[Any],
    *,
    command: str,
    organization_slug: str = "demo-workspace",
    user_email: str = "demo@radarasset.local",
) -> int:
    if command not in {"all", "daily", "hourly"}:
        raise ValueError("Unsupported bulk ingestion command.")
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                WITH requester AS (
                  SELECT org.id AS organization_id, app_user.id AS user_id
                  FROM organizations AS org
                  JOIN app_users AS app_user ON app_user.email = %s
                  WHERE org.slug = %s
                  LIMIT 1
                ),
                candidates AS (
                  SELECT pi.id AS provider_instrument_id, timeframe.timeframe
                  FROM provider_instruments AS pi
                  JOIN data_providers AS provider ON provider.id = pi.provider_id
                  JOIN assets AS asset ON asset.id = pi.asset_id
                  CROSS JOIN LATERAL (
                    VALUES ('1d'), ('1h')
                  ) AS timeframe(timeframe)
                  WHERE provider.status = 'active'
                    AND provider.code IN ('binance-public', 'vnstock-vci-free', 'msn-via-vnstock')
                    AND asset.market IN ('crypto_spot', 'vn_equity', 'metal_spot')
                    AND (%s = 'all' OR %s = timeframe.timeframe)
                    AND NOT (provider.code = 'msn-via-vnstock' AND timeframe.timeframe = '1h')
                )
                INSERT INTO market_ingestion_requests (
                  id, organization_id, user_id, provider_instrument_id, timeframe,
                  status, attempt_count, available_at, created_at, updated_at
                )
                SELECT
                  gen_random_uuid(), requester.organization_id, requester.user_id,
                  candidates.provider_instrument_id, candidates.timeframe,
                  'queued', 0, NOW(), NOW(), NOW()
                FROM requester
                CROSS JOIN candidates
                WHERE NOT EXISTS (
                  SELECT 1
                  FROM market_ingestion_requests AS existing
                  WHERE existing.organization_id = requester.organization_id
                    AND existing.user_id = requester.user_id
                    AND existing.provider_instrument_id = candidates.provider_instrument_id
                    AND existing.timeframe = candidates.timeframe
                    AND existing.status IN ('queued', 'running')
                )
                """,
                (user_email, organization_slug, command, command),
            )
            return cursor.rowcount


def main(argv: Sequence[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Sync approved market-data provider catalogs.")
    parser.add_argument("--queue-ingestion", choices=("all", "daily", "hourly"))
    args = parser.parse_args(argv)
    try:
        descriptors = [
            *BinanceSpotAdapter().list_instruments(),
            *VnstockAdapter().list_instruments(),
        ]
        url = psycopg_connection_url(load_database_url(Path(".env.local")))
        with psycopg.connect(url, autocommit=False) as connection:
            count = sync_provider_instruments(connection, descriptors)
            queued = (
                queue_market_ingestion_requests(connection, command=args.queue_ingestion)
                if args.queue_ingestion
                else 0
            )
        print(
            json.dumps(
                {"status": "succeeded", "synchronized": count, "queued": queued},
                separators=(",", ":"),
            )
        )
        return 0
    except Exception:
        print(json.dumps({"status": "failed", "errorCode": "catalog_sync_failed"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
