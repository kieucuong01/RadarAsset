from __future__ import annotations

import json
import time
from argparse import ArgumentParser
from datetime import datetime, timezone
from typing import Any, Callable, Sequence

import psycopg

from backtest.forward_evaluator import PostgresEvaluationRepository, process_next_evaluation
from backtest.run_contracts import DatasetInput, QueuedRun, QueuedRunLeg, WorkerRepository
from backtest.run_execution import bars_in_run_range, process_next_run
from backtest.run_repository import PostgresWorkerRepository, database_url, load_local_env


def run_once() -> dict[str, Any]:
    with psycopg.connect(database_url(), autocommit=False) as connection:
        repository = PostgresWorkerRepository(connection)
        repository.recover_stale_runs()
        run_result = process_next_run(repository)
        evaluation_result = process_next_evaluation(
            PostgresEvaluationRepository(connection, worker_id=repository.worker_id)
        )
        connection.commit()
        if run_result.get("status") == "idle" and evaluation_result.get("status") == "idle":
            return {"status": "idle", "message": "No queued backtests or strategy evaluations."}
        return {"status": "processed", "backtest": run_result, "evaluation": evaluation_result}


def run_forever(
    *,
    poll_seconds: float = 2.0,
    run_once_fn: Callable[[], dict[str, Any]] = run_once,
    sleep_fn: Callable[[float], None] = time.sleep,
    output_fn: Callable[[dict[str, Any]], None] | None = None,
) -> None:
    if poll_seconds <= 0:
        raise ValueError("Worker poll seconds must be positive.")
    emit = output_fn or (lambda result: print(json.dumps(result, indent=2), flush=True))
    while True:
        result = run_once_fn()
        if result.get("status") == "idle":
            sleep_fn(poll_seconds)
        else:
            emit(result)


def main(argv: Sequence[str] | None = None) -> int:
    parser = ArgumentParser(description="Process queued portfolio backtests.")
    parser.add_argument("--once", action="store_true", help="Process at most one queued run.")
    parser.add_argument("--poll-seconds", type=float, default=2.0)
    args = parser.parse_args(argv)
    if args.poll_seconds <= 0:
        parser.error("--poll-seconds must be positive")
    print(f"[{datetime.now(timezone.utc).isoformat()}] Quant worker booting", flush=True)
    if args.once:
        print(json.dumps(run_once(), indent=2), flush=True)
        return 0
    try:
        run_forever(poll_seconds=args.poll_seconds)
    except KeyboardInterrupt:
        print("Quant worker stopped.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
