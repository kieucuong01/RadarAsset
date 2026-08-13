from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import json
import os
from typing import Any
from collections.abc import Callable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row
import pytest

from smart_insights.crypto_pipeline import (
    calculate_crypto_snapshot,
    run_crypto_pipeline,
)
from smart_insights.metrics.crypto import MarketClose, ObservationPoint
from smart_insights.repository import PostgresInsightRepository
from smart_insights.sources import source_for_code


AS_OF = datetime(2026, 8, 13, 12, tzinfo=timezone.utc)


class FakeCryptoRepository:
    def __init__(
        self,
        observations: list[ObservationPoint],
        closes: dict[str, list[MarketClose]],
    ) -> None:
        self.observations = observations
        self.closes = closes
        self.definitions: tuple[object, ...] = ()
        self.snapshots: dict[str, object] = {}

    def upsert_metric_definitions(self, definitions: tuple[object, ...]) -> None:
        self.definitions = definitions

    def metric_observations(
        self, metric_code: str, *, as_of: datetime, limit: int = 5_000
    ) -> tuple[ObservationPoint, ...]:
        eligible = [
            row
            for row in self.observations
            if row.metric_code == metric_code
            and row.effective_at <= as_of
            and row.observed_at <= as_of
        ]
        latest: dict[str, ObservationPoint] = {}
        for row in eligible:
            current = latest.get(row.natural_key)
            if current is None or row.revision > current.revision:
                latest[row.natural_key] = row
        accepted = [
            row
            for row in latest.values()
            if row.quality_status in {"passed", "warning"}
        ]
        accepted.sort(key=lambda row: (row.effective_at, row.natural_key))
        return tuple(accepted[-limit:])

    def price_closes(
        self, asset_symbol: str, *, as_of: datetime, limit: int = 500
    ) -> tuple[MarketClose, ...]:
        rows = [
            row
            for row in self.closes.get(asset_symbol, [])
            if row.ts <= as_of and row.observed_at <= as_of
        ]
        return tuple(rows[-limit:])

    def latest_signal_snapshot(
        self, *, market: str, as_of: datetime
    ) -> dict[str, Any] | None:
        rows = [
            row
            for row in self.snapshots.values()
            if getattr(row, "market") == market
            and getattr(row, "effective_at") < as_of
            and getattr(row, "signal_type") == "regime"
        ]
        if not rows:
            return None
        latest = max(rows, key=lambda row: getattr(row, "effective_at"))
        return {
            "score": latest.score,
            "label": latest.label,
            "effective_at": latest.effective_at,
            "status": latest.status,
        }

    def publish_signal_snapshot(self, snapshot: object) -> tuple[str, str]:
        key = getattr(snapshot, "idempotency_key")
        if key in self.snapshots:
            return key, "unchanged"
        self.snapshots[key] = snapshot
        return key, "succeeded"


def observation(
    code: str,
    index: int,
    value: Decimal,
    *,
    effective_at: datetime,
    asset: str | None = None,
    dimensions: dict[str, str] | None = None,
    revision: int = 1,
    observed_at: datetime | None = None,
) -> ObservationPoint:
    dimension_key = ",".join(
        f"{key}={item}" for key, item in sorted((dimensions or {}).items())
    )
    return ObservationPoint(
        id=f"{code}-{asset or 'GLOBAL'}-{index}-r{revision}",
        metric_code=code,
        value=value,
        effective_at=effective_at,
        observed_at=observed_at or AS_OF - timedelta(hours=1),
        provider_code=provider_for(code),
        quality_status="passed",
        natural_key=f"{code}|{asset or 'GLOBAL'}|{effective_at.isoformat()}|{dimension_key}",
        revision=revision,
        dimensions=dimensions or {},
        asset_symbol=asset,
    )


def provider_for(code: str) -> str:
    if code == "crypto.fear_greed.index":
        return "alternative-fng"
    if code == "crypto.etf.net_flow_usd":
        return "farside-btc-etf"
    if code.startswith("crypto.coinshares"):
        return "coinshares-weekly"
    if code.startswith("crypto.stablecoin"):
        return "defillama-stablecoins"
    if code.startswith("crypto.defi"):
        return "defillama-chains"
    if code.startswith("crypto.network"):
        return "mempool-space"
    if code.startswith("crypto.derivatives"):
        return "deribit-public"
    return "coinmetrics-community"


def daily_series(
    code: str,
    *,
    count: int = 100,
    assets: tuple[str | None, ...] = (None,),
    dimensions_for: Callable[[str | None], dict[str, str]] | None = None,
    exponential: bool = False,
) -> list[ObservationPoint]:
    start = AS_OF.replace(hour=0) - timedelta(days=count)
    rows: list[ObservationPoint] = []
    for index in range(count):
        effective_at = start + timedelta(days=index)
        value = Decimal(2) ** index if exponential else Decimal(index + 1)
        for asset in assets:
            dimensions = dimensions_for(asset) if dimensions_for else {}
            rows.append(
                observation(
                    code,
                    index,
                    value,
                    effective_at=effective_at,
                    asset=asset,
                    dimensions=dimensions,
                )
            )
    return rows


def complete_repository() -> FakeCryptoRepository:
    observations: list[ObservationPoint] = []
    observations += daily_series("crypto.fear_greed.index")
    observations += daily_series(
        "crypto.etf.net_flow_usd",
        assets=("BTC", "ETH", "SOL"),
        dimensions_for=lambda asset: {"asset": str(asset), "fund": "TOTAL"},
        exponential=True,
    )
    observations += daily_series("crypto.stablecoin.supply_usd", exponential=True)
    observations += daily_series(
        "crypto.defi.chain_tvl_usd",
        dimensions_for=lambda _asset: {"chain": "TOTAL"},
        exponential=True,
    )
    observations += daily_series(
        "crypto.onchain.adjusted_transfer_usd", assets=("BTC",), exponential=True
    )
    observations += daily_series(
        "crypto.onchain.active_addresses", assets=("BTC",), exponential=True
    )
    observations += daily_series("crypto.onchain.nvt", assets=("BTC",))
    observations += daily_series(
        "crypto.network.hashrate_hs", assets=("BTC",), exponential=True
    )
    observations += daily_series("crypto.derivatives.btc_dvol", assets=("BTC",))
    observations += daily_series("crypto.derivatives.eth_dvol", assets=("ETH",))
    observations += daily_series(
        "crypto.derivatives.funding_rate",
        assets=("BTC", "ETH"),
        dimensions_for=lambda asset: {
            "instrument": f"{asset}-PERPETUAL",
            "frequency": "instant",
        },
    )

    weekly_end = AS_OF.replace(hour=0) - timedelta(days=5)
    for index in range(30):
        effective_at = weekly_end - timedelta(weeks=29 - index)
        observations.append(
            observation(
                "crypto.coinshares.net_flow_usd",
                index,
                Decimal(index + 1),
                effective_at=effective_at,
                dimensions={"asset": "Total", "source_unit": "US$m"},
            )
        )

    closes: dict[str, list[MarketClose]] = {}
    start = AS_OF.replace(hour=0) - timedelta(days=100)
    for symbol in ("BTC", "ETH", "SOL"):
        closes[symbol] = [
            MarketClose(
                id=f"{symbol}-{index}",
                asset_symbol=symbol,
                ts=start + timedelta(days=index),
                close=Decimal(2) ** index,
                observed_at=start + timedelta(days=index, hours=8),
            )
            for index in range(100)
        ]
    return FakeCryptoRepository(observations, closes)


def test_calculate_crypto_snapshot_is_complete_deterministic_and_point_in_time() -> None:
    repository = complete_repository()

    snapshot = calculate_crypto_snapshot(repository, as_of=AS_OF)

    assert snapshot.market == "crypto"
    assert snapshot.methodology_version == "crypto-regime-v1"
    assert snapshot.coverage == Decimal("1.0000")
    assert snapshot.score == Decimal("70.0000")
    assert snapshot.label == "risk_on"
    assert snapshot.status == "active"
    assert len(snapshot.inputs) == 15
    assert all(input_row.observed_at <= AS_OF for input_row in snapshot.inputs)
    assert repository.definitions


def test_later_revised_etf_row_does_not_change_prior_as_of_result() -> None:
    repository = complete_repository()
    before = calculate_crypto_snapshot(repository, as_of=AS_OF)
    original = next(
        row
        for row in repository.observations
        if row.metric_code == "crypto.etf.net_flow_usd"
        and row.asset_symbol == "BTC"
        and row.effective_at == AS_OF.replace(hour=0) - timedelta(days=1)
    )
    repository.observations.append(
        replace(
            original,
            id=f"{original.id}-corrected",
            value=Decimal("-999999999"),
            revision=2,
            observed_at=AS_OF + timedelta(hours=1),
        )
    )

    replay = calculate_crypto_snapshot(repository, as_of=AS_OF)

    assert replay.score == before.score
    assert replay.inputs == before.inputs


def test_snapshot_is_unavailable_below_sixty_percent_coverage() -> None:
    complete = complete_repository()
    observations = [
        row
        for row in complete.observations
        if row.metric_code == "crypto.fear_greed.index"
    ]
    repository = FakeCryptoRepository(observations, complete.closes)

    snapshot = calculate_crypto_snapshot(repository, as_of=AS_OF)

    assert snapshot.score is None
    assert snapshot.coverage == Decimal("0.3000")
    assert snapshot.label == "unavailable"
    assert snapshot.status == "unavailable"


def test_pipeline_publication_is_idempotent() -> None:
    repository = complete_repository()

    first = run_crypto_pipeline(repository, as_of=AS_OF)
    second = run_crypto_pipeline(repository, as_of=AS_OF)

    assert first.status == "succeeded"
    assert second.status == "unchanged"
    assert first.snapshot_id == second.snapshot_id


def _test_database_url() -> str:
    raw_url = os.getenv("TEST_DATABASE_URL")
    if not raw_url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL integration tests.")
    parts = urlsplit(raw_url)
    query = urlencode(
        [(key, value) for key, value in parse_qsl(parts.query) if key != "schema"]
    )
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


def _seed_postgres_repository(
    connection: psycopg.Connection[Any], repository: PostgresInsightRepository
) -> str:
    source = complete_repository()
    repository.upsert_metric_definitions(tuple(source.definitions) or ())
    if not source.definitions:
        calculate_crypto_snapshot(source, as_of=AS_OF)
        repository.upsert_metric_definitions(tuple(source.definitions))

    with connection.cursor(row_factory=dict_row) as cursor:
        asset_ids: dict[str, str] = {}
        for symbol in ("BTC", "ETH", "SOL"):
            cursor.execute(
                """
                INSERT INTO assets (
                  id, symbol, name, asset_class, market, created_at, updated_at
                ) VALUES (%s, %s, %s, 'crypto', 'crypto', NOW(), NOW())
                ON CONFLICT (symbol) DO UPDATE SET symbol = EXCLUDED.symbol
                RETURNING id
                """,
                (str(uuid4()), symbol, f"QA {symbol}"),
            )
            asset_ids[symbol] = str(cursor.fetchone()["id"])

        provider_codes = {row.provider_code for row in source.observations}
        provider_codes.add("qa-binance")
        provider_ids: dict[str, str] = {}
        snapshot_ids: dict[str, str] = {}
        for code in sorted(provider_codes):
            registered = None if code == "qa-binance" else source_for_code(code)
            cursor.execute(
                """
                INSERT INTO data_providers (
                  id, code, name, license_scope, status, created_at, updated_at
                ) VALUES (%s, %s, %s, 'research_only', 'active', NOW(), NOW())
                ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
                RETURNING id
                """,
                (str(uuid4()), code, registered.name if registered else "QA Binance"),
            )
            provider_id = str(cursor.fetchone()["id"])
            provider_ids[code] = provider_id
            snapshot_id = str(uuid4())
            source_url = (
                registered.urls[0]
                if registered is not None
                else "https://api.binance.com/api/v3/klines"
            )
            content_hash = hashlib.sha256(code.encode()).hexdigest()
            cursor.execute(
                """
                INSERT INTO insight_raw_snapshots (
                  id, provider_id, source_url, observed_at, content_hash,
                  content_type, storage_locator, parser_version, status, metadata
                ) VALUES (
                  %s, %s, %s, %s, %s,
                  'application/json', %s, 'qa-v1', 'validated', '{}'::jsonb
                )
                """,
                (
                    snapshot_id,
                    provider_id,
                    source_url,
                    AS_OF - timedelta(hours=1),
                    content_hash,
                    f"qa/{content_hash}.json.gz",
                ),
            )
            snapshot_ids[code] = snapshot_id

        cursor.execute(
            "SELECT id, code FROM metric_definitions WHERE market = 'crypto'"
        )
        metric_ids = {str(row["code"]): str(row["id"]) for row in cursor.fetchall()}
        grouped_observations: dict[
            tuple[str, str | None, tuple[tuple[str, str], ...]], list[ObservationPoint]
        ] = {}
        for row in source.observations:
            group = (
                row.metric_code,
                row.asset_symbol,
                tuple(sorted(row.dimensions.items())),
            )
            grouped_observations.setdefault(group, []).append(row)
        database_values: dict[str, Decimal] = {}
        for rows in grouped_observations.values():
            ordered = sorted(rows, key=lambda item: item.effective_at)
            if max(abs(row.value) for row in ordered) > Decimal("1000000000000000000"):
                for index, row in enumerate(ordered):
                    database_values[row.id] = Decimal("100") * Decimal("1.1") ** index
            else:
                for row in ordered:
                    database_values[row.id] = row.value
        revised_observation_id = ""
        for row in source.observations:
            observation_id = str(uuid4())
            if (
                row.metric_code == "crypto.etf.net_flow_usd"
                and row.asset_symbol == "BTC"
                and row.effective_at
                == AS_OF.replace(hour=0) - timedelta(days=1)
            ):
                revised_observation_id = observation_id
            cursor.execute(
                """
                INSERT INTO metric_observations (
                  id, metric_definition_id, provider_id, asset_id, raw_snapshot_id,
                  effective_at, observed_at, revision, value, natural_key,
                  dimension_key, dimensions, quality_status, quality_flags
                ) VALUES (
                  %s, %s, %s, %s, %s,
                  %s, %s, %s, %s, %s,
                  %s, %s::jsonb, %s, '[]'::jsonb
                )
                """,
                (
                    observation_id,
                    metric_ids[row.metric_code],
                    provider_ids[row.provider_code],
                    asset_ids.get(row.asset_symbol or ""),
                    snapshot_ids[row.provider_code],
                    row.effective_at,
                    row.observed_at,
                    row.revision,
                    database_values[row.id],
                    row.natural_key,
                    json.dumps(dict(sorted(row.dimensions.items())), separators=(",", ":")),
                    json.dumps(dict(row.dimensions), separators=(",", ":")),
                    row.quality_status,
                ),
            )

        for symbol, closes in source.closes.items():
            cursor.execute(
                """
                INSERT INTO datasets (id, asset_id, timeframe, adjustment_policy, created_at)
                VALUES (%s, %s, '1d', 'raw', NOW())
                ON CONFLICT (asset_id, timeframe, adjustment_policy)
                DO UPDATE SET asset_id = EXCLUDED.asset_id
                RETURNING id
                """,
                (str(uuid4()), asset_ids[symbol]),
            )
            dataset_id = str(cursor.fetchone()["id"])
            cursor.execute(
                "UPDATE dataset_versions SET is_active = false WHERE dataset_id = %s",
                (dataset_id,),
            )
            cursor.execute(
                "SELECT COALESCE(MAX(version), 0) + 1 AS version FROM dataset_versions WHERE dataset_id = %s",
                (dataset_id,),
            )
            version_number = int(cursor.fetchone()["version"])
            version_id = str(uuid4())
            cursor.execute(
                """
                INSERT INTO dataset_versions (
                  id, dataset_id, provider_id, version, checksum,
                  coverage_start, coverage_end, row_count, missing_bar_count,
                  quality_status, quality_summary, source_metadata,
                  is_active, published_at
                ) VALUES (
                  %s, %s, %s, %s, %s,
                  %s, %s, %s, 0,
                  'passed', '{}'::jsonb, '{}'::jsonb,
                  true, %s
                )
                """,
                (
                    version_id,
                    dataset_id,
                    provider_ids["qa-binance"],
                    version_number,
                    hashlib.sha256(symbol.encode()).hexdigest(),
                    closes[0].ts,
                    closes[-1].ts,
                    len(closes),
                    (AS_OF - timedelta(hours=1)).replace(tzinfo=None),
                ),
            )
            for index, row in enumerate(closes):
                close = Decimal("100") * Decimal("1.1") ** index
                cursor.execute(
                    """
                    INSERT INTO dataset_bars (
                      id, dataset_version_id, ts, open, high, low, close,
                      volume, source, quality_flags, ingested_at
                    ) VALUES (
                      %s, %s, %s, %s, %s, %s, %s,
                      NULL, 'qa-binance', '[]'::jsonb, %s
                    )
                    """,
                    (
                        str(uuid4()),
                        version_id,
                        row.ts,
                        close,
                        close,
                        close,
                        close,
                        (AS_OF - timedelta(hours=2)).replace(tzinfo=None),
                    ),
                )
    if not revised_observation_id:
        raise AssertionError("Expected ETF observation was not seeded.")
    return revised_observation_id


def test_postgres_pipeline_reads_active_data_and_excludes_future_revision() -> None:
    connection = psycopg.connect(
        _test_database_url(), autocommit=True, row_factory=dict_row
    )
    try:
        connection.execute("BEGIN")
        repository = PostgresInsightRepository(connection)
        revised_observation_id = _seed_postgres_repository(connection, repository)

        before = calculate_crypto_snapshot(repository, as_of=AS_OF)
        assert before.status == "active"
        assert before.coverage == Decimal("1.0000")
        assert all(row.observed_at <= AS_OF for row in before.inputs)

        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO metric_observations (
                  id, metric_definition_id, provider_id, asset_id, raw_snapshot_id,
                  effective_at, observed_at, revision, value, natural_key,
                  dimension_key, dimensions, quality_status, quality_flags
                )
                SELECT %s, metric_definition_id, provider_id, asset_id, raw_snapshot_id,
                       effective_at, %s, 2, %s, natural_key,
                       dimension_key, dimensions, quality_status, quality_flags
                FROM metric_observations WHERE id = %s
                """,
                (
                    str(uuid4()),
                    AS_OF + timedelta(hours=1),
                    Decimal("-999999999"),
                    revised_observation_id,
                ),
            )
        replay = calculate_crypto_snapshot(repository, as_of=AS_OF)
        assert replay.score == before.score
        assert replay.inputs == before.inputs

        first_id, first_status = repository.publish_signal_snapshot(before)
        second_id, second_status = repository.publish_signal_snapshot(before)
        assert first_id == second_id
        assert (first_status, second_status) == ("succeeded", "unchanged")
    finally:
        if connection.info.transaction_status.value != 0:
            connection.execute("ROLLBACK")
        connection.close()
