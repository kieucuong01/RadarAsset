# Python Worker Modularization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `quant-worker/worker.py` from a 1,127-line catch-all to a small process/CLI entrypoint while preserving backtest results, leasing, cancellation, retry, timeout, and public imports used by existing scripts and tests.

**Architecture:** Move immutable run contracts to `backtest/run_contracts.py`, PostgreSQL persistence to `backtest/run_repository.py`, and deterministic run orchestration to `backtest/run_execution.py`. Keep `worker.py` as the composition root and temporarily re-export its existing public names so operational scripts are not broken. This is a move-only refactor: no strategy math, SQL, schema, dependency, or queue-policy changes.

**Tech Stack:** Python 3.11+, psycopg 3, pytest, existing deterministic backtest engine.

## Global constraints

- Preserve all public response dictionaries, error codes, progress checkpoints, SQL predicates, transaction boundaries, artifact checksums, and exception handling.
- Preserve imports currently used by `bootstrap_research_datasets.py`, `run_backtest_capacity.py`, `test_worker.py`, and `test_worker_concurrency_integration.py` through compatibility re-exports in `worker.py`.
- Do not modify Prisma schema, migrations, strategy calculations, ingestion, forward evaluation, or TypeScript application code.
- Do not add dependencies or introduce service containers/factories.
- Move code before simplifying it. Each extraction must pass focused tests before the next one begins.

## Target file map

**Create:**

- `quant-worker/backtest/run_contracts.py`: `QueuedRunLeg`, `QueuedRun`, `DatasetInput`, `WorkerRepository`.
- `quant-worker/backtest/run_repository.py`: DB URL loading, lease constants, `PostgresWorkerRepository` and its SQL lifecycle.
- `quant-worker/backtest/run_execution.py`: validation, engine configuration, portfolio execution, artifacts, checkpoints, and `process_next_run`.
- `quant-worker/tests/test_worker_boundaries.py`: source-level dependency and entrypoint-size guard.

**Modify:**

- `quant-worker/worker.py`: CLI, process loop, connection composition, and compatibility re-exports only.
- `quant-worker/tests/test_worker.py`: import owner modules for unit behavior where monkeypatch compatibility is not required.
- `quant-worker/tests/test_worker_concurrency_integration.py`: import persistence contracts from their owning modules.
- `quant-worker/run_backtest_capacity.py`: import repository/execution owners directly.
- `quant-worker/bootstrap_research_datasets.py`: import `database_url` from repository owner.

---

### Task 1: Establish contracts and dependency guards

**Files:** Create `backtest/run_contracts.py`, `tests/test_worker_boundaries.py`; modify `worker.py`.

- [ ] Add a failing boundary test asserting `worker.py` contains no SQL statement, `run_execution.py` does not import psycopg, `run_repository.py` does not import strategy/analytics modules, and the final `worker.py` is at most 180 lines.
- [ ] Move the three frozen dataclasses and `WorkerRepository` protocol unchanged into `run_contracts.py`.
- [ ] Re-export contracts from `worker.py` so existing imports remain valid.
- [ ] Run `pytest tests/test_worker.py tests/test_worker_boundaries.py`; the size/SQL guard remains red until Tasks 2-4, while contract behavior stays green.
- [ ] Commit as `refactor: extract worker run contracts`.

### Task 2: Extract PostgreSQL run persistence

**Files:** Create `backtest/run_repository.py`; modify `worker.py`, `tests/test_worker.py`, `tests/test_worker_concurrency_integration.py`.

- [ ] Move `DEFAULT_DATABASE_URL`, `DEFAULT_LEASE_SECONDS`, `MAX_ATTEMPTS`, `load_local_env`, `database_url`, and `PostgresWorkerRepository` unchanged.
- [ ] Import contracts from `run_contracts.py`; keep all claim/lease/recovery/checkpoint/load/complete/fail SQL byte-for-byte equivalent.
- [ ] Re-export `database_url` and `PostgresWorkerRepository` from `worker.py` for compatibility.
- [ ] Point repository-focused tests to `backtest.run_repository`; run unit tests and the PostgreSQL concurrency suite when `TEST_DATABASE_URL` is configured.
- [ ] Commit as `refactor: extract worker run repository`.

### Task 3: Extract deterministic run execution

**Files:** Create `backtest/run_execution.py`; modify `worker.py`, `tests/test_worker.py`.

- [ ] Move `RunControlStop`, checkpoint handling, validation/config helpers, date filtering, portfolio assumptions, artifact/performance builders, portfolio orchestration, and `process_next_run` unchanged.
- [ ] Import only contracts plus deterministic backtest modules; do not import psycopg, socket, environment variables, or CLI code.
- [ ] Re-export `bars_in_run_range` and `process_next_run` from `worker.py`.
- [ ] Point execution tests to `backtest.run_execution`, retaining the one `worker` import needed to test CLI composition/monkeypatching.
- [ ] Run `pytest tests/test_worker.py tests/test_robustness.py tests/test_portfolio.py`; verify result payloads and checksums remain unchanged.
- [ ] Commit as `refactor: extract worker run execution`.

### Task 4: Make worker.py a composition root

**Files:** Modify `worker.py`, `run_backtest_capacity.py`, `bootstrap_research_datasets.py`, `tests/test_worker.py`, `tests/test_worker_concurrency_integration.py`, `tests/test_worker_boundaries.py`.

- [ ] Keep only compatibility imports/re-exports, `run_once`, `run_forever`, `main`, and the `__main__` guard in `worker.py`.
- [ ] Preserve fairness: every `run_once` attempts one backtest job and one forward-evaluation job before returning.
- [ ] Migrate operational scripts and integration tests to direct owner imports; compatibility re-exports remain for external callers.
- [ ] Make all dependency guards green and assert `worker.py` stays at or below 180 lines.
- [ ] Run focused worker, forward evaluator, and CLI tests.
- [ ] Commit as `refactor: slim python worker entrypoint`.

### Task 5: Verify the refactor and integrate

- [ ] Run Python formatting/lint/type checks used by the repository, full Python tests with a writable `--basetemp`, and the root `npm run check` gate.
- [ ] If `TEST_DATABASE_URL` exists, run `tests/test_worker_concurrency_integration.py`; otherwise report it explicitly as not run.
- [ ] Run `npm run build` with local placeholder auth/ingestion values only if required by build-time validation.
- [ ] Confirm `git diff --check`, inspect file ownership, and ensure no unrelated work is staged.
- [ ] Update the simplification design with completion status, commit documentation, merge the branch back to local `main`, and remove only this task's worktree/branch.
