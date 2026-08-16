from __future__ import annotations

import json
import os
from collections.abc import Iterable, Sequence
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

import psycopg

from backtest.providers import (
    BinanceSpotAdapter,
    ProviderInstrumentDescriptor,
    VnstockAdapter,
)
from backtest.market_calendar import HOSE_TIMEZONE, is_session_day
from backtest.catalog import FEEDS
from backtest.daily_scope import load_daily_scope_symbols
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


FRESHNESS_TOLERANCE = {
    "1d": timedelta(hours=36),
}


def _latest_closed_bar_open(market: str, timeframe: str, now: datetime) -> datetime:
    if now.tzinfo is None:
        raise ValueError("Queue timestamp must be timezone-aware.")
    now = now.astimezone(timezone.utc)
    if market == "crypto_spot":
        return now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)

    if market == "vn_equity":
        local_day = now.astimezone(HOSE_TIMEZONE).date()
        for day_offset in range(14):
            session_day = local_day - timedelta(days=day_offset)
            if not is_session_day(session_day, market):
                continue
            session_close = datetime.combine(
                session_day, time(15), tzinfo=HOSE_TIMEZONE
            ).astimezone(timezone.utc)
            if session_close <= now:
                return datetime.combine(session_day, time(0), tzinfo=HOSE_TIMEZONE).astimezone(
                    timezone.utc
                )
        raise ValueError("Unable to resolve the latest closed HOSE bar.")

    candidate = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)
    while not is_session_day(candidate.date(), market):
        candidate -= timedelta(days=1)
    return candidate


def market_timeframe_stale_cutoffs(now: datetime) -> dict[tuple[str, str], datetime]:
    return {
        (market, timeframe): _latest_closed_bar_open(market, timeframe, now)
        - FRESHNESS_TOLERANCE[timeframe]
        for market, timeframes in {
            "crypto_spot": ("1d",),
            "vn_equity": ("1d",),
            "metal_spot": ("1d",),
        }.items()
        for timeframe in timeframes
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


def collect_provider_descriptors(
    adapters: Iterable[tuple[str, Any]],
) -> tuple[list[ProviderInstrumentDescriptor], list[str]]:
    descriptors: list[ProviderInstrumentDescriptor] = []
    failures: list[str] = []
    for code, adapter in adapters:
        try:
            descriptors.extend(adapter.list_instruments())
        except Exception:
            failures.append(code)
    return descriptors, failures


def complete_catalog_provider_codes(
    descriptors: Iterable[ProviderInstrumentDescriptor],
) -> set[str]:
    counts: dict[str, int] = {}
    for descriptor in descriptors:
        code = provider_code(descriptor)
        counts[code] = counts.get(code, 0) + 1
    return {
        code
        for code, minimum in {
            "binance-public": 10,
            "vnstock-vci-free": 100,
            "dukascopy-public": 1,
        }.items()
        if counts.get(code, 0) >= minimum
    }


def sync_provider_instruments(
    connection: psycopg.Connection[Any],
    descriptors: Iterable[ProviderInstrumentDescriptor],
    *,
    observed_provider_codes: Iterable[str] | None = None,
) -> int:
    rows = sorted(
        select_provider_instruments(descriptors),
        key=lambda item: (provider_code(item), item.canonical_symbol),
    )
    observed_at = datetime.now(timezone.utc)
    provider_codes = sorted(
        set(observed_provider_codes or (provider_code(item) for item in rows))
    )
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
                SET metadata = jsonb_set(
                      instrument.metadata,
                      '{absenceObservationCount}',
                      to_jsonb(COALESCE((instrument.metadata->>'absenceObservationCount')::int, 0) + 1),
                      true
                    ),
                    is_active = CASE
                      WHEN COALESCE((instrument.metadata->>'absenceObservationCount')::int, 0) + 1 < 2
                        THEN instrument.is_active
                      ELSE false
                    END
                FROM data_providers AS provider
                WHERE instrument.provider_id = provider.id
                  AND provider.code = ANY(%s)
                  AND instrument.last_seen_at < %s
                """,
                (provider_codes, observed_at),
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
                    "absenceObservationCount": 0,
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
                INSERT INTO asset_listing_periods (
                  id, asset_id, provider_instrument_id, provider_code,
                  provider_symbol, venue, status, valid_from,
                  confirmation_count, metadata, created_at
                )
                SELECT
                  gen_random_uuid(), asset.id, instrument.id, provider.code,
                  instrument.provider_symbol, asset.venue, 'confirmed_active',
                  instrument.last_seen_at, 1, instrument.metadata, NOW()
                FROM provider_instruments instrument
                JOIN data_providers provider ON provider.id = instrument.provider_id
                JOIN assets asset ON asset.id = instrument.asset_id
                WHERE provider.code = ANY(%s)
                  AND instrument.is_active = true
                  AND NOT EXISTS (
                    SELECT 1 FROM asset_listing_periods open_period
                    WHERE open_period.provider_instrument_id = instrument.id
                      AND open_period.valid_to IS NULL
                  )
                """,
                (provider_codes,),
            )
            cursor.execute(
                """
                UPDATE asset_listing_periods period
                SET valid_to = %s,
                    status = 'confirmed_inactive',
                    confirmation_count = GREATEST(
                      period.confirmation_count,
                      COALESCE((instrument.metadata->>'absenceObservationCount')::int, 2)
                    )
                FROM provider_instruments instrument
                WHERE period.provider_instrument_id = instrument.id
                  AND period.valid_to IS NULL
                  AND instrument.is_active = false
                  AND COALESCE((instrument.metadata->>'absenceObservationCount')::int, 0) >= 2
                """,
                (observed_at,),
            )
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
                      'vnstock-kbs-free', 'vnstock-vci-free',
                      'msn-via-vnstock'
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
                  'vnstock-kbs-free', 'vnstock-vci-free',
                  'msn-via-vnstock'
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
    now: datetime | None = None,
    allowed_symbols: Sequence[str] | None = None,
) -> int:
    if command not in {"all", "daily"}:
        raise ValueError("Unsupported bulk ingestion command.")
    cutoffs = market_timeframe_stale_cutoffs(now or datetime.now(timezone.utc))
    scope = tuple(
        sorted(
            dict.fromkeys(
                symbol.strip().upper()
                for symbol in (
                    allowed_symbols
                    if allowed_symbols is not None
                    else load_daily_scope_symbols(connection)
                )
                if symbol.strip()
            )
        )
    )
    if not scope:
        raise ValueError("Daily market ingestion scope is empty.")
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                WITH queue_lock AS MATERIALIZED (
                  SELECT pg_advisory_xact_lock(hashtext('market-ingestion-due-queue'))
                ),
                requester AS (
                  SELECT org.id AS organization_id, app_user.id AS user_id
                  FROM organizations AS org
                  JOIN app_users AS app_user ON app_user.email = %s
                  WHERE org.slug = %s
                  LIMIT 1
                ),
                candidates AS (
                  SELECT pi.id AS provider_instrument_id, '1d'::text AS timeframe
                  FROM provider_instruments AS pi
                  JOIN data_providers AS provider ON provider.id = pi.provider_id
                  JOIN assets AS asset ON asset.id = pi.asset_id
                  LEFT JOIN LATERAL (
                    SELECT version.coverage_end
                    FROM datasets AS dataset
                    JOIN dataset_versions AS version ON version.dataset_id = dataset.id
                    WHERE dataset.asset_id = asset.id
                      AND dataset.timeframe = '1d'
                      AND dataset.adjustment_policy = 'raw'
                      AND version.is_active = true
                    ORDER BY version.published_at DESC
                    LIMIT 1
                  ) AS active_raw ON true
                  WHERE provider.status = 'active'
                    AND pi.is_active = true
                    AND provider.code IN (
                      'binance-public', 'dukascopy-public',
                      'vnstock-kbs-free', 'vnstock-vci-free',
                      'msn-via-vnstock'
                    )
                    AND asset.market IN ('crypto_spot', 'vn_equity', 'metal_spot')
                    AND UPPER(asset.symbol) = ANY(%s)
                    AND (
                      active_raw.coverage_end IS NULL
                      OR active_raw.coverage_end < CASE
                        WHEN asset.market = 'crypto_spot' THEN %s
                        WHEN asset.market = 'vn_equity' THEN %s
                        WHEN asset.market = 'metal_spot' THEN %s
                      END
                    )
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
                CROSS JOIN queue_lock
                WHERE NOT EXISTS (
                  SELECT 1
                  FROM market_ingestion_requests AS existing
                  WHERE existing.organization_id = requester.organization_id
                    AND existing.user_id = requester.user_id
                    AND existing.provider_instrument_id = candidates.provider_instrument_id
                    AND existing.timeframe = candidates.timeframe
                    AND existing.status IN ('queued', 'running')
                )
                ON CONFLICT DO NOTHING
                """,
                (
                    user_email,
                    organization_slug,
                    list(scope),
                    cutoffs[("crypto_spot", "1d")],
                    cutoffs[("vn_equity", "1d")],
                    cutoffs[("metal_spot", "1d")],
                ),
            )
            return cursor.rowcount


def main(argv: Sequence[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Sync approved market-data provider catalogs.")
    parser.add_argument("--queue-ingestion", choices=("all", "daily"))
    parser.add_argument("--env-file", default=".env.local")
    args = parser.parse_args(argv)
    try:
        env_file = Path(args.env_file)
        organization_slug, user_email = load_service_tenant(env_file)
        descriptors, provider_failures = collect_provider_descriptors(
            (
                ("binance-public", BinanceSpotAdapter()),
                ("vnstock-vci-free", VnstockAdapter()),
            )
        )
        descriptors.append(
            ProviderInstrumentDescriptor(
                provider_symbol="XAUUSD",
                canonical_symbol="XAU",
                name="Gold Spot / US Dollar",
                market="metal_spot",
                venue="OTC",
                currency="USD",
            )
        )
        observed_codes = complete_catalog_provider_codes(descriptors)
        url = psycopg_connection_url(load_database_url(env_file))
        with psycopg.connect(url, autocommit=False) as connection:
            count = sync_provider_instruments(
                connection, descriptors, observed_provider_codes=observed_codes
            )
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
                {
                    "status": "succeeded" if not provider_failures else "degraded",
                    "synchronized": count,
                    "queued": queued,
                    "providerFailures": provider_failures,
                },
                separators=(",", ":"),
            )
        )
        return 0
    except Exception:
        print(json.dumps({"status": "failed", "errorCode": "catalog_sync_failed"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
