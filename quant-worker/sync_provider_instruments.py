from __future__ import annotations

import json
import os
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
    "dukascopy-public": (
        "Dukascopy Public Datafeed",
        "https://www.dukascopy.com/swiss/english/marketwatch/historical/",
    ),
}


def load_service_tenant(env_file: Path = Path(".env.local")) -> tuple[str, str]:
    configured = {
        "QUANT_WORKER_ORGANIZATION_SLUG": os.getenv("QUANT_WORKER_ORGANIZATION_SLUG", "").strip(),
        "QUANT_WORKER_USER_EMAIL": os.getenv("QUANT_WORKER_USER_EMAIL", "").strip(),
    }
    if not all(configured.values()) and env_file.exists():
        for raw_line in env_file.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if key not in configured or configured[key]:
                continue
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
                value = value[1:-1]
            configured[key] = value.strip()
    return (
        configured["QUANT_WORKER_ORGANIZATION_SLUG"] or "demo-workspace",
        configured["QUANT_WORKER_USER_EMAIL"] or "demo@radarasset.local",
    )


def provider_code(descriptor: ProviderInstrumentDescriptor) -> str:
    if descriptor.market == "crypto_spot":
        return "binance-public"
    if descriptor.market == "metal_spot":
        return "dukascopy-public"
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
    observed_at = datetime.now(timezone.utc)
    synchronized = 0
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE data_providers
                SET status = 'disabled', updated_at = NOW()
                WHERE code = 'msn-via-vnstock'
                """,
                (),
            )
            cursor.execute(
                """
                UPDATE provider_instruments AS instrument
                SET is_active = false
                FROM data_providers AS provider
                WHERE instrument.provider_id = provider.id
                  AND provider.code IN (
                    'binance-public', 'dukascopy-public',
                    'vnstock-vci-free', 'msn-via-vnstock'
                  )
                """,
                (),
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
                        listing_status,
                        created_at, updated_at
                    ) VALUES (
                        gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, 'active', NOW(), NOW()
                    )
                    ON CONFLICT (symbol) DO UPDATE SET
                        name = EXCLUDED.name,
                        asset_class = EXCLUDED.asset_class,
                        market = EXCLUDED.market,
                        venue = EXCLUDED.venue,
                        currency = EXCLUDED.currency,
                        provider = EXCLUDED.provider,
                        provider_symbol = EXCLUDED.provider_symbol,
                        listing_status = 'active',
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
                    "catalogSynchronizedAt": observed_at.isoformat(),
                    "source": "approved-provider-catalog",
                }
                cursor.execute(
                    """
                    INSERT INTO provider_instruments (
                        id, provider_id, asset_id, provider_symbol, metadata,
                        is_active, last_seen_at, created_at
                    ) VALUES (
                        gen_random_uuid(), %s, %s, %s, %s::jsonb,
                        true, %s, NOW()
                    )
                    ON CONFLICT (provider_id, asset_id) DO UPDATE SET
                        provider_symbol = EXCLUDED.provider_symbol,
                        metadata = EXCLUDED.metadata,
                        is_active = true,
                        last_seen_at = EXCLUDED.last_seen_at
                    """,
                    (
                        provider_id,
                        asset_id,
                        descriptor.provider_symbol,
                        json.dumps(metadata, separators=(",", ":")),
                        observed_at,
                    ),
                )
                synchronized += 1
            cursor.execute(
                """
                UPDATE assets AS asset
                SET listing_status = CASE
                  WHEN EXISTS (
                    SELECT 1
                    FROM provider_instruments AS active_instrument
                    WHERE active_instrument.asset_id = asset.id
                      AND active_instrument.is_active = true
                  ) THEN 'active'
                  ELSE 'inactive'
                END,
                updated_at = NOW()
                WHERE EXISTS (
                  SELECT 1
                  FROM provider_instruments AS managed_instrument
                  JOIN data_providers AS managed_provider
                    ON managed_provider.id = managed_instrument.provider_id
                  WHERE managed_instrument.asset_id = asset.id
                    AND managed_provider.code IN (
                      'binance-public', 'dukascopy-public',
                      'vnstock-vci-free', 'msn-via-vnstock'
                    )
                )
                """,
                (),
            )
            cursor.execute(
                """
                INSERT INTO instrument_catalog_snapshots (
                  id, provider_code, asset_id, provider_symbol, venue,
                  listing_status, observed_at, metadata
                )
                SELECT
                  gen_random_uuid(), provider.code, asset.id,
                  instrument.provider_symbol, asset.venue,
                  CASE WHEN instrument.is_active THEN 'active' ELSE 'inactive' END,
                  %s, instrument.metadata
                FROM provider_instruments AS instrument
                JOIN data_providers AS provider ON provider.id = instrument.provider_id
                JOIN assets AS asset ON asset.id = instrument.asset_id
                WHERE provider.code IN (
                  'binance-public', 'dukascopy-public',
                  'vnstock-vci-free', 'msn-via-vnstock'
                )
                ON CONFLICT (provider_code, asset_id, observed_at) DO UPDATE SET
                  provider_symbol = EXCLUDED.provider_symbol,
                  venue = EXCLUDED.venue,
                  listing_status = EXCLUDED.listing_status,
                  metadata = EXCLUDED.metadata
                """,
                (observed_at,),
            )
            cursor.execute(
                """
                UPDATE market_ingestion_requests AS request
                SET status = 'failed',
                    worker_id = NULL,
                    lease_expires_at = NULL,
                    error_code = 'instrument_inactive',
                    updated_at = NOW()
                FROM provider_instruments AS instrument
                WHERE request.provider_instrument_id = instrument.id
                  AND instrument.is_active = false
                  AND request.status IN ('queued', 'running')
                """,
                (),
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
    timeframe_filter = {"all": "all", "daily": "1d", "hourly": "1h"}[command]
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
                    AND pi.is_active = true
                    AND provider.code IN ('binance-public', 'dukascopy-public', 'vnstock-vci-free', 'msn-via-vnstock')
                    AND asset.market IN ('crypto_spot', 'vn_equity', 'metal_spot')
                    AND (%s = 'all' OR %s = timeframe.timeframe)
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
                (user_email, organization_slug, timeframe_filter, timeframe_filter),
            )
            return cursor.rowcount


def main(argv: Sequence[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Sync approved market-data provider catalogs.")
    parser.add_argument("--queue-ingestion", choices=("all", "daily", "hourly"))
    parser.add_argument("--env-file", default=".env.local")
    args = parser.parse_args(argv)
    try:
        env_file = Path(args.env_file)
        organization_slug, user_email = load_service_tenant(env_file)
        descriptors = [
            *BinanceSpotAdapter().list_instruments(),
            *VnstockAdapter().list_instruments(),
            ProviderInstrumentDescriptor(
                provider_symbol="XAUUSD",
                canonical_symbol="XAU",
                name="Gold Spot / US Dollar",
                market="metal_spot",
                venue="OTC",
                currency="USD",
            ),
        ]
        url = psycopg_connection_url(load_database_url(env_file))
        with psycopg.connect(url, autocommit=False) as connection:
            count = sync_provider_instruments(connection, descriptors)
            queued = (
                queue_market_ingestion_requests(
                    connection,
                    command=args.queue_ingestion,
                    organization_slug=organization_slug,
                    user_email=user_email,
                )
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
