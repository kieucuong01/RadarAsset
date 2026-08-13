"""Durable incremental forward strategy evaluation."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
import json
from typing import Any, Protocol

from .custom_rules import PriceThresholdRule, ScheduledDcaRule, custom_rule_implementation_hash, parse_custom_rule
from .models import Bar
from .quality import canonical_bar_checksum
from .strategy_factory import strategy_from_catalog

ZERO = Decimal("0")
ONE = Decimal("1")
BPS = Decimal("10000")


@dataclass(frozen=True)
class EvaluationWork:
    job_id: str
    organization_id: str
    assignment_id: str
    portfolio_id: str
    owner_user_id: str
    asset_id: str
    symbol: str
    strategy_version_id: str
    strategy_code: str
    strategy_version: str
    implementation_hash: str
    parameters: dict[str, Any]
    dataset_version_id: str
    dataset_checksum: str
    last_evaluated_bar_at: datetime | None
    state: dict[str, Any]
    bars: list[Bar]
    fee_bps: Decimal
    sell_tax_bps: Decimal
    slippage_bps: Decimal

    @property
    def rule_hash(self) -> str:
        return custom_rule_implementation_hash(self.parameters)


@dataclass(frozen=True)
class ForwardSignal:
    signal_type: str
    event_type: str
    signal_at: datetime
    signal_price: Decimal
    reason: str
    metadata: dict[str, Any]


@dataclass(frozen=True)
class ForwardOutcome:
    state: dict[str, Any]
    signals: tuple[ForwardSignal, ...]
    snapshot_at: datetime | None
    equity: Decimal
    market_value: Decimal
    benchmark_equity: Decimal


class EvaluationRepository(Protocol):
    def claim_next_evaluation(self) -> EvaluationWork | None: ...
    def complete_evaluation(self, item: EvaluationWork, outcome: ForwardOutcome) -> None: ...
    def fail_evaluation(self, item: EvaluationWork, code: str) -> None: ...


def claim_next_evaluation(connection: Any, worker_id: str, lease_seconds: int = 300) -> EvaluationWork | None:
    """Claim one evaluation job with a bounded lease and load causal bar context."""
    from psycopg.rows import dict_row

    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            WITH next_job AS (
              SELECT id FROM strategy_evaluation_jobs
              WHERE (status = 'queued' OR (status = 'running' AND lease_expires_at <= NOW() AND attempt_count < 3))
              ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
            )
            UPDATE strategy_evaluation_jobs AS job
            SET status = 'running', worker_id = %s,
                lease_expires_at = NOW() + (%s * INTERVAL '1 second'),
                attempt_count = attempt_count + 1, error_code = NULL
            FROM next_job WHERE job.id = next_job.id
            RETURNING job.id, job.organization_id, job.assignment_id, job.dataset_version_id
            """,
            (worker_id, lease_seconds),
        )
        job = cursor.fetchone()
        if job is None:
            return None
        cursor.execute(
            """
            SELECT assignment.portfolio_id, assignment.asset_id, assignment.strategy_version_id,
                   assignment.parameters, assignment.last_evaluated_bar_at, assignment.state,
                   portfolio.user_id, asset.symbol, version.code, version.version,
                   version.implementation_hash,
                   published.checksum, run.parameters AS run_parameters
            FROM strategy_assignments assignment
            JOIN portfolios portfolio ON portfolio.id = assignment.portfolio_id
            JOIN assets asset ON asset.id = assignment.asset_id
            JOIN strategy_versions version ON version.id = assignment.strategy_version_id
            JOIN dataset_versions published ON published.id = %s
            LEFT JOIN quant_runs run ON run.id = assignment.source_quant_run_id
            WHERE assignment.id = %s AND assignment.organization_id = %s
              AND assignment.status = 'active' AND version.status = 'active'
              AND published.is_active = true AND published.quality_status IN ('passed', 'warning')
            """,
            (job["dataset_version_id"], job["assignment_id"], job["organization_id"]),
        )
        row = cursor.fetchone()
        if row is None:
            cursor.execute("UPDATE strategy_evaluation_jobs SET status = 'failed', error_code = 'DATASET_INVALID', finished_at = NOW(), lease_expires_at = NULL WHERE id = %s", (job["id"],))
            cursor.execute("UPDATE strategy_assignments SET status = 'evaluation_failed', updated_at = NOW() WHERE id = %s AND organization_id = %s", (job["assignment_id"], job["organization_id"]))
            return None
        cursor.execute(
            """
            SELECT bar.ts, bar.open, bar.high, bar.low, bar.close, bar.volume, bar.source, dataset.timeframe
            FROM dataset_bars bar
            JOIN dataset_versions dv ON dv.id = bar.dataset_version_id
            JOIN datasets dataset ON dataset.id = dv.dataset_id
            WHERE bar.dataset_version_id = %s
            ORDER BY bar.ts ASC
            """,
            (job["dataset_version_id"],),
        )
        bars = [Bar(asset=str(row["symbol"]), timestamp=bar["ts"], timeframe=str(bar["timeframe"]), open=Decimal(str(bar["open"])), high=Decimal(str(bar["high"])), low=Decimal(str(bar["low"])), close=Decimal(str(bar["close"])), volume=None if bar["volume"] is None else Decimal(str(bar["volume"])), source=str(bar["source"])) for bar in cursor.fetchall()]
    params = row["run_parameters"] if isinstance(row["run_parameters"], dict) else {}
    costs = params.get("assumptions", {}).get("marketCosts", {}) if isinstance(params, dict) else {}
    market_cost = next(iter(costs.values()), {}) if isinstance(costs, dict) else {}
    return EvaluationWork(str(job["id"]), str(job["organization_id"]), str(job["assignment_id"]), str(row["portfolio_id"]), str(row["user_id"]), str(row["asset_id"]), str(row["symbol"]), str(row["strategy_version_id"]), str(row["code"]), str(row["version"]), str(row["implementation_hash"]), dict(row["parameters"] or {}), str(job["dataset_version_id"]), str(row["checksum"]), row["last_evaluated_bar_at"], dict(row["state"] or {}), bars, Decimal(str(market_cost.get("commissionBps", 0))), Decimal(str(market_cost.get("sellTaxBps", 0))), Decimal(str(market_cost.get("slippageBps", 0))))


class PostgresEvaluationRepository:
    def __init__(self, connection: Any, *, worker_id: str, lease_seconds: int = 300) -> None:
        self.connection, self.worker_id, self.lease_seconds = connection, worker_id, lease_seconds

    def claim_next_evaluation(self) -> EvaluationWork | None:
        return claim_next_evaluation(self.connection, self.worker_id, self.lease_seconds)

    def complete_evaluation(self, item: EvaluationWork, outcome: ForwardOutcome) -> None:
        with self.connection.cursor() as cursor:
            signal_count = 0
            for signal in outcome.signals:
                cursor.execute(
                    """
                    INSERT INTO strategy_signals (
                      id, organization_id, assignment_id, asset_id, strategy_version_id,
                      dataset_version_id, signal_type, event_type, status, signal_at,
                      signal_price, reason, metadata, created_at
                    ) VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s,
                              'suggested', %s, %s, %s, %s::jsonb, NOW())
                    ON CONFLICT (assignment_id, dataset_version_id, signal_at, event_type)
                      WHERE dataset_version_id IS NOT NULL DO NOTHING
                    RETURNING id
                    """,
                    (item.organization_id, item.assignment_id, item.asset_id, item.strategy_version_id, item.dataset_version_id, signal.signal_type, signal.event_type, signal.signal_at, signal.signal_price, signal.reason, json.dumps(signal.metadata, separators=(",", ":"))),
                )
                inserted = cursor.fetchone()
                if inserted is None:
                    continue
                signal_count += 1
                signal_id = inserted[0]
                cursor.execute(
                    """
                    INSERT INTO notifications (
                      id, organization_id, user_id, assignment_id, signal_id,
                      type, title, body, created_at
                    ) VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (user_id, signal_id) DO NOTHING
                    """,
                    (item.organization_id, item.owner_user_id, item.assignment_id, signal_id, f"strategy_{signal.signal_type}", f"{signal.signal_type.upper()} {item.symbol}", signal.reason),
                )
            if outcome.snapshot_at is not None:
                contributions = _number(outcome.state, "cumulativeContributions")
                starting = _number(outcome.state, "startingEquity")
                cursor.execute(
                    """
                    INSERT INTO strategy_forward_snapshots (
                      id, organization_id, assignment_id, dataset_version_id, bar_at,
                      simulated_cash, simulated_quantity, market_value, equity,
                      cumulative_contributions, cumulative_fees,
                      pnl_excluding_contributions, benchmark_equity, created_at
                    ) VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s,
                              %s, %s, %s, %s, NOW())
                    ON CONFLICT (assignment_id, dataset_version_id, bar_at) DO NOTHING
                    """,
                    (item.organization_id, item.assignment_id, item.dataset_version_id, outcome.snapshot_at, _number(outcome.state, "simulatedCash"), _number(outcome.state, "simulatedQuantity"), outcome.market_value, outcome.equity, contributions, _number(outcome.state, "cumulativeFees"), outcome.equity - starting - contributions, outcome.benchmark_equity),
                )
            cursor.execute(
                """
                UPDATE strategy_assignments SET state = %s::jsonb, last_evaluated_at = NOW(),
                  last_evaluated_dataset_version_id = %s, last_evaluated_bar_at = %s,
                  status = 'active', updated_at = NOW()
                WHERE id = %s AND organization_id = %s
                """,
                (json.dumps(outcome.state, separators=(",", ":")), item.dataset_version_id, outcome.snapshot_at, item.assignment_id, item.organization_id),
            )
            cursor.execute(
                """UPDATE strategy_evaluation_jobs SET status = 'succeeded', finished_at = NOW(),
                   lease_expires_at = NULL, error_code = NULL
                   WHERE id = %s AND worker_id = %s AND status = 'running'""",
                (item.job_id, self.worker_id),
            )

    def fail_evaluation(self, item: EvaluationWork, code: str) -> None:
        safe = code if code in {"DATASET_INVALID", "STRATEGY_HASH_MISMATCH", "DSL_INVALID", "ENGINE_FAILED"} else "ENGINE_FAILED"
        with self.connection.cursor() as cursor:
            cursor.execute("UPDATE strategy_evaluation_jobs SET status = 'failed', error_code = %s, finished_at = NOW(), lease_expires_at = NULL WHERE id = %s AND worker_id = %s", (safe, item.job_id, self.worker_id))
            cursor.execute("UPDATE strategy_assignments SET status = 'evaluation_failed', updated_at = NOW() WHERE id = %s AND organization_id = %s", (item.assignment_id, item.organization_id))


def _number(state: dict[str, Any], key: str, default: str = "0") -> Decimal:
    return Decimal(str(state.get(key, default)))


def _new_bars(item: EvaluationWork) -> list[Bar]:
    return item.bars if item.last_evaluated_bar_at is None else [row for row in item.bars if row.timestamp > item.last_evaluated_bar_at]


def _fill_pending(
    item: EvaluationWork,
    state: dict[str, Any],
    current: Bar,
    cash: Decimal,
    quantity: Decimal,
    fees: Decimal,
    *,
    default_size_pct: Decimal = Decimal("100"),
) -> tuple[Decimal, Decimal, Decimal]:
    pending = state.pop("pendingAction", None)
    if not isinstance(pending, dict):
        return cash, quantity, fees
    size = Decimal(str(pending.get("sizePct", default_size_pct))) / Decimal("100")
    fee_rate, slip = item.fee_bps / BPS, item.slippage_bps / BPS
    if pending.get("action") == "buy" and cash > ZERO:
        fill, budget = current.open * (ONE + slip), cash * size
        bought = budget / (fill * (ONE + fee_rate))
        commission = bought * fill * fee_rate
        return cash - bought * fill - commission, quantity + bought, fees + commission
    if pending.get("action") == "sell" and quantity > ZERO:
        fill, sold = current.open * (ONE - slip), quantity * size
        commission = sold * fill * (fee_rate + item.sell_tax_bps / BPS)
        return cash + sold * fill - commission, quantity - sold, fees + commission
    return cash, quantity, fees


def _price_outcome(item: EvaluationWork, rule: PriceThresholdRule) -> ForwardOutcome:
    state = dict(item.state)
    cash, quantity = _number(state, "simulatedCash"), _number(state, "simulatedQuantity")
    fees, rows = _number(state, "cumulativeFees"), _new_bars(item)
    signals: list[ForwardSignal] = []
    for previous, current in zip(item.bars, item.bars[1:], strict=False):
        if item.last_evaluated_bar_at is not None and current.timestamp <= item.last_evaluated_bar_at:
            continue
        cash, quantity, fees = _fill_pending(
            item, state, current, cash, quantity, fees, default_size_pct=rule.size_pct
        )
        crossed = previous.close <= rule.threshold < current.close if rule.operator == "crosses_above" else previous.close >= rule.threshold > current.close
        if crossed:
            metadata = {"referenceClose": float(current.close), "threshold": float(rule.threshold), "sizePct": float(rule.size_pct), "executionStatus": "pending_next_bar_open"}
            signals.append(ForwardSignal(rule.action, "PRICE_CROSS", current.timestamp, current.close, f"price_{rule.operator}", metadata))
            state["pendingAction"] = {"action": rule.action, "sizePct": float(rule.size_pct), "signalAt": current.timestamp.isoformat().replace("+00:00", "Z")}
    latest = rows[-1] if rows else (item.bars[-1] if item.bars else None)
    market_value = quantity * latest.close if latest else ZERO
    state.update({"simulatedCash": float(cash), "simulatedQuantity": float(quantity), "cumulativeFees": float(fees)})
    benchmark = _number(state, "benchmarkQuantity") * latest.close if latest else ZERO
    return ForwardOutcome(state, tuple(signals), latest.timestamp if latest else None, cash + market_value, market_value, benchmark)


def _catalog_outcome(item: EvaluationWork) -> ForwardOutcome:
    strategy = strategy_from_catalog(item.strategy_code, item.strategy_version, item.parameters)
    prepare = getattr(strategy, "prepare", None)
    if callable(prepare):
        prepare(item.bars)
    state = dict(item.state)
    cash, quantity = _number(state, "simulatedCash"), _number(state, "simulatedQuantity")
    fees = _number(state, "cumulativeFees")
    signals: list[ForwardSignal] = []
    for index, current in enumerate(item.bars):
        if item.last_evaluated_bar_at is not None and current.timestamp <= item.last_evaluated_bar_at:
            continue
        cash, quantity, fees = _fill_pending(item, state, current, cash, quantity, fees)
        signal = strategy.signal(item.bars, index, in_position=quantity > ZERO)
        if signal is None:
            continue
        signals.append(
            ForwardSignal(
                signal.action,
                "TECHNICAL_SIGNAL",
                current.timestamp,
                current.close,
                signal.reason,
                {**signal.metadata, "executionStatus": "pending_next_bar_open"},
            )
        )
        state["pendingAction"] = {
            "action": signal.action,
            "sizePct": 100,
            "signalAt": current.timestamp.isoformat().replace("+00:00", "Z"),
        }
    latest = item.bars[-1] if item.bars else None
    market_value = quantity * latest.close if latest else ZERO
    state.update({"simulatedCash": float(cash), "simulatedQuantity": float(quantity), "cumulativeFees": float(fees)})
    benchmark = _number(state, "benchmarkQuantity") * latest.close if latest else ZERO
    return ForwardOutcome(state, tuple(signals), latest.timestamp if latest else None, cash + market_value, market_value, benchmark)


def _dca_outcome(item: EvaluationWork, rule: ScheduledDcaRule) -> ForwardOutcome:
    state = dict(item.state)
    cash, quantity = _number(state, "simulatedCash"), _number(state, "simulatedQuantity")
    contributions, fees = _number(state, "cumulativeContributions"), _number(state, "cumulativeFees")
    paid = {str(value) for value in state.get("paidMonths", [])}
    signals: list[ForwardSignal] = []
    for current in _new_bars(item):
        month = current.timestamp.strftime("%Y-%m")
        if month in paid or current.timestamp.day < rule.day_of_month:
            continue
        cash, contributions = cash + rule.contribution_amount, contributions + rule.contribution_amount
        fill = current.open * (ONE + item.slippage_bps / BPS)
        bought = rule.contribution_amount / (fill * (ONE + item.fee_bps / BPS))
        commission = bought * fill * item.fee_bps / BPS
        cash, quantity, fees = cash - bought * fill - commission, quantity + bought, fees + commission
        paid.add(month)
        metadata = {"contributionAmount": float(rule.contribution_amount), "currency": rule.currency, "executionStatus": "simulated_at_bar_open"}
        signals.append(ForwardSignal("buy", "SCHEDULED_DCA", current.timestamp, current.open, "scheduled_dca", metadata))
    rows = _new_bars(item)
    latest = rows[-1] if rows else (item.bars[-1] if item.bars else None)
    market_value = quantity * latest.close if latest else ZERO
    state.update({"simulatedCash": float(cash), "simulatedQuantity": float(quantity), "cumulativeContributions": float(contributions), "cumulativeFees": float(fees), "paidMonths": sorted(paid)})
    benchmark = _number(state, "benchmarkQuantity") * latest.close if latest else ZERO
    return ForwardOutcome(state, tuple(signals), latest.timestamp if latest else None, cash + market_value, market_value, benchmark)


def process_next_evaluation(repository: EvaluationRepository) -> dict[str, Any]:
    item = repository.claim_next_evaluation()
    if item is None:
        return {"status": "idle", "message": "No queued strategy evaluations."}
    try:
        if not item.bars or canonical_bar_checksum(item.bars) != item.dataset_checksum:
            repository.fail_evaluation(item, "DATASET_INVALID")
            return {"status": "failed", "id": item.job_id, "code": "DATASET_INVALID"}
        if item.strategy_code.startswith("custom:"):
            rule = parse_custom_rule(item.parameters)
            if item.rule_hash != item.implementation_hash:
                repository.fail_evaluation(item, "STRATEGY_HASH_MISMATCH")
                return {"status": "failed", "id": item.job_id, "code": "STRATEGY_HASH_MISMATCH"}
            outcome = _price_outcome(item, rule) if isinstance(rule, PriceThresholdRule) else _dca_outcome(item, rule)
        else:
            outcome = _catalog_outcome(item)
        repository.complete_evaluation(item, outcome)
        return {"status": "succeeded", "id": item.job_id, "signalCount": len(outcome.signals)}
    except ValueError:
        repository.fail_evaluation(item, "DSL_INVALID")
        return {"status": "failed", "id": item.job_id, "code": "DSL_INVALID"}
    except Exception:
        repository.fail_evaluation(item, "ENGINE_FAILED")
        return {"status": "failed", "id": item.job_id, "code": "ENGINE_FAILED"}
