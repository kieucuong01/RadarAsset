from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any

from psycopg.rows import dict_row


@dataclass(frozen=True)
class PricePoint:
    symbol: str
    timestamp: datetime
    close: Decimal
    dataset_version_id: str
    adjustment_policy: str


@dataclass(frozen=True)
class OpinionSignal:
    signal_snapshot_id: str
    organization_id: str
    user_id: str
    asset_symbol: str
    benchmark_symbol: str
    effective_at: datetime
    stance: str
    quant_score: Decimal | None


@dataclass(frozen=True)
class OpinionEvaluation:
    signal_snapshot_id: str
    organization_id: str
    user_id: str
    asset_symbol: str
    benchmark_symbol: str
    horizon_sessions: int
    direction: int
    entry_timestamp: datetime
    entry_close: Decimal
    target_timestamp: datetime
    target_close: Decimal
    benchmark_entry_close: Decimal
    benchmark_target_close: Decimal
    asset_return: Decimal
    benchmark_return: Decimal
    excess_return: Decimal
    correct: bool
    asset_dataset_version_id: str
    benchmark_dataset_version_id: str
    adjustment_policy: str


@dataclass(frozen=True)
class PendingEvaluation:
    signal: OpinionSignal
    asset_market: str
    horizon_sessions: int


def direction_from_stance(stance: str) -> int | None:
    if stance in {"POSITIVE", "CONSTRUCTIVE"}:
        return 1
    if stance in {"CAUTIOUS", "NEGATIVE"}:
        return -1
    return None


def benchmark_for_market(market: str, symbol: str) -> str:
    if market == "vn_equity":
        return "VNINDEX"
    if market == "crypto_spot":
        return "BTC"
    if market == "metal_spot" and symbol == "XAU":
        return "XAU"
    raise ValueError("Unsupported asset market for opinion evaluation.")


def load_pending_evaluations(connection: Any, *, limit: int = 500) -> list[PendingEvaluation]:
    if not 1 <= limit <= 5_000:
        raise ValueError("Opinion evaluation limit is invalid.")
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            SELECT signal.id AS signal_snapshot_id,
                   signal.inputs->>'organizationId' AS organization_id,
                   signal.inputs->>'userId' AS user_id,
                   asset.symbol AS asset_symbol,
                   asset.market AS asset_market,
                   signal.effective_at,
                   signal.label AS stance,
                   signal.score AS quant_score,
                   horizon.horizon_sessions
            FROM signal_snapshots AS signal
            JOIN assets AS asset ON asset.id = signal.asset_id
            JOIN organization_memberships AS membership
              ON membership.organization_id::text = signal.inputs->>'organizationId'
             AND membership.user_id::text = signal.inputs->>'userId'
            CROSS JOIN (VALUES (1), (5), (20)) AS horizon(horizon_sessions)
            WHERE signal.signal_type = 'asset_opinion'
              AND signal.status = 'active'
              AND signal.label IN ('POSITIVE', 'CONSTRUCTIVE', 'CAUTIOUS', 'NEGATIVE')
              AND NOT EXISTS (
                SELECT 1
                FROM asset_opinion_evaluations AS evaluation
                WHERE evaluation.signal_snapshot_id = signal.id
                  AND evaluation.horizon_sessions = horizon.horizon_sessions
              )
            ORDER BY signal.effective_at, signal.id, horizon.horizon_sessions
            LIMIT %s
            """,
            (limit,),
        )
        rows = cursor.fetchall()
    return [
        PendingEvaluation(
            signal=OpinionSignal(
                signal_snapshot_id=str(row["signal_snapshot_id"]),
                organization_id=str(row["organization_id"]),
                user_id=str(row["user_id"]),
                asset_symbol=str(row["asset_symbol"]),
                benchmark_symbol=benchmark_for_market(
                    str(row["asset_market"]), str(row["asset_symbol"])
                ),
                effective_at=row["effective_at"],
                stance=str(row["stance"]),
                quant_score=(
                    None if row["quant_score"] is None else Decimal(str(row["quant_score"]))
                ),
            ),
            asset_market=str(row["asset_market"]),
            horizon_sessions=int(row["horizon_sessions"]),
        )
        for row in rows
    ]


def load_price_points(connection: Any, symbol: str, market: str) -> tuple[PricePoint, ...]:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            WITH selected AS (
              SELECT asset.symbol, version.id AS dataset_version_id, dataset.adjustment_policy
              FROM assets AS asset
              JOIN datasets AS dataset ON dataset.asset_id = asset.id
              JOIN dataset_versions AS version
                ON version.dataset_id = dataset.id AND version.is_active = true
              WHERE asset.symbol = %s
                AND asset.market = %s
                AND dataset.timeframe = '1d'
                AND version.quality_status IN ('passed', 'warning')
                AND dataset.adjustment_policy IN ('total_return', 'raw')
                AND (asset.market = 'vn_equity' OR dataset.adjustment_policy = 'raw')
              ORDER BY CASE dataset.adjustment_policy WHEN 'total_return' THEN 0 ELSE 1 END,
                       version.published_at DESC
              LIMIT 1
            )
            SELECT selected.symbol, bar.ts, bar.close,
                   selected.dataset_version_id, selected.adjustment_policy
            FROM selected
            JOIN dataset_bars AS bar
              ON bar.dataset_version_id = selected.dataset_version_id
            ORDER BY bar.ts
            """,
            (symbol, market),
        )
        rows = cursor.fetchall()
    return tuple(
        PricePoint(
            symbol=str(row["symbol"]),
            timestamp=row["ts"],
            close=Decimal(str(row["close"])),
            dataset_version_id=str(row["dataset_version_id"]),
            adjustment_policy=str(row["adjustment_policy"]),
        )
        for row in rows
    )


def persist_evaluation(
    connection: Any, evaluation: OpinionEvaluation, *, evaluated_at: datetime
) -> int:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO asset_opinion_evaluations (
              signal_snapshot_id, organization_id, user_id, asset_id,
              benchmark_asset_id, asset_dataset_version_id,
              benchmark_dataset_version_id, horizon_sessions, direction,
              entry_at, entry_close, target_at, target_close,
              benchmark_entry_close, benchmark_target_close,
              asset_return, benchmark_return, excess_return, correct,
              adjustment_policy, evaluated_at
            )
            SELECT %s::uuid, %s::uuid, %s::uuid, asset.id,
                   benchmark.id, %s::uuid, %s::uuid, %s, %s,
                   %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            FROM assets AS asset
            JOIN assets AS benchmark ON benchmark.symbol = %s
            WHERE asset.symbol = %s
            ON CONFLICT (signal_snapshot_id, horizon_sessions) DO NOTHING
            """,
            (
                evaluation.signal_snapshot_id,
                evaluation.organization_id,
                evaluation.user_id,
                evaluation.asset_dataset_version_id,
                evaluation.benchmark_dataset_version_id,
                evaluation.horizon_sessions,
                evaluation.direction,
                evaluation.entry_timestamp,
                evaluation.entry_close,
                evaluation.target_timestamp,
                evaluation.target_close,
                evaluation.benchmark_entry_close,
                evaluation.benchmark_target_close,
                evaluation.asset_return,
                evaluation.benchmark_return,
                evaluation.excess_return,
                evaluation.correct,
                evaluation.adjustment_policy,
                evaluated_at,
                evaluation.benchmark_symbol,
                evaluation.asset_symbol,
            ),
        )
        return cursor.rowcount


def evaluate_pending(
    connection: Any, *, evaluated_at: datetime, limit: int = 500
) -> dict[str, int]:
    pending = load_pending_evaluations(connection, limit=limit)
    price_cache: dict[tuple[str, str], tuple[PricePoint, ...]] = {}

    def cached_prices(symbol: str, market: str) -> tuple[PricePoint, ...]:
        key = (symbol, market)
        if key not in price_cache:
            price_cache[key] = load_price_points(connection, symbol, market)
        return price_cache[key]

    evaluated = 0
    immature = 0
    benchmark_markets = {
        "vn_equity": "vn_equity",
        "crypto_spot": "crypto_spot",
        "metal_spot": "metal_spot",
    }
    for candidate in pending:
        asset_prices = cached_prices(candidate.signal.asset_symbol, candidate.asset_market)
        benchmark_prices = cached_prices(
            candidate.signal.benchmark_symbol, benchmark_markets[candidate.asset_market]
        )
        result = evaluate_signal(
            candidate.signal,
            asset_prices=asset_prices,
            benchmark_prices=benchmark_prices,
            horizon_sessions=candidate.horizon_sessions,
            evaluated_at=evaluated_at,
        )
        if result is None:
            immature += 1
            continue
        evaluated += persist_evaluation(connection, result, evaluated_at=evaluated_at)
    return {"selected": len(pending), "evaluated": evaluated, "immature": immature}


def _return(entry: Decimal, target: Decimal) -> Decimal:
    if entry <= 0:
        raise ValueError("Evaluation entry price must be positive.")
    return target / entry - Decimal("1")


def evaluate_signal(
    signal: OpinionSignal,
    *,
    asset_prices: tuple[PricePoint, ...],
    benchmark_prices: tuple[PricePoint, ...],
    horizon_sessions: int,
    evaluated_at: datetime,
) -> OpinionEvaluation | None:
    if horizon_sessions not in {1, 5, 20}:
        raise ValueError("Unsupported opinion evaluation horizon.")
    direction = direction_from_stance(signal.stance)
    if direction is None:
        return None
    ordered_asset = tuple(sorted(asset_prices, key=lambda row: row.timestamp))
    entry_index = next(
        (index for index, row in enumerate(ordered_asset) if row.timestamp > signal.effective_at),
        None,
    )
    if entry_index is None or entry_index + horizon_sessions >= len(ordered_asset):
        return None
    entry = ordered_asset[entry_index]
    target = ordered_asset[entry_index + horizon_sessions]
    if target.timestamp > evaluated_at:
        return None
    benchmark_by_timestamp = {row.timestamp: row for row in benchmark_prices}
    benchmark_entry = benchmark_by_timestamp.get(entry.timestamp)
    benchmark_target = benchmark_by_timestamp.get(target.timestamp)
    if benchmark_entry is None or benchmark_target is None:
        return None
    asset_return = _return(entry.close, target.close)
    benchmark_return = _return(benchmark_entry.close, benchmark_target.close)
    return OpinionEvaluation(
        signal_snapshot_id=signal.signal_snapshot_id,
        organization_id=signal.organization_id,
        user_id=signal.user_id,
        asset_symbol=signal.asset_symbol,
        benchmark_symbol=signal.benchmark_symbol,
        horizon_sessions=horizon_sessions,
        direction=direction,
        entry_timestamp=entry.timestamp,
        entry_close=entry.close,
        target_timestamp=target.timestamp,
        target_close=target.close,
        benchmark_entry_close=benchmark_entry.close,
        benchmark_target_close=benchmark_target.close,
        asset_return=asset_return,
        benchmark_return=benchmark_return,
        excess_return=asset_return - benchmark_return,
        correct=asset_return * direction > 0,
        asset_dataset_version_id=entry.dataset_version_id,
        benchmark_dataset_version_id=benchmark_entry.dataset_version_id,
        adjustment_policy=entry.adjustment_policy,
    )
