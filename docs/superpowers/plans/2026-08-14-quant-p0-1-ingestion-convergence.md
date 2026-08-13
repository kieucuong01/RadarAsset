# Quant P0.1 Ingestion Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make scheduled ingestion enqueue quickly while a continuously leased PostgreSQL worker converges the configured market universe and exposes truthful operational health.

**Architecture:** Keep PowerShell as the scheduler boundary and PostgreSQL as the only queue. Split enqueue/stage orchestration from continuous request execution, add a database worker heartbeat, and make readiness depend on due backlog age, scheduler cadence, dataset freshness, and worker liveness.

**Tech Stack:** PowerShell 7-compatible scripts, Python 3.12, psycopg 3, PostgreSQL, Prisma 7, Next.js 16, TypeScript, Vitest, pytest.

## Global Constraints

- No Redis, Celery, Kafka, or new runtime dependency.
- Scheduler commands do not drain the full provider universe.
- Worker leases and retry attempts remain bounded and idempotent.
- Provider error messages stay private; only allow-listed error codes reach APIs.
- Tests use an isolated PostgreSQL URL for destructive/concurrency coverage.

---

### Task 1: Separate scheduler enqueue from request execution

**Files:**
- Modify: `scripts/run-market-ingestion.ps1`
- Modify: `deploy/windows/install-quant-ingestion-tasks.ps1`
- Modify: `README.md`
- Test: `quant-worker/tests/test_market_ingestion_operations.py`

**Interfaces:**
- Consumes: `sync_provider_instruments.py --queue-ingestion {hourly|daily|all}`.
- Produces: a bounded scheduler run whose `processed_count` is zero and whose `queued_count` is the enqueue result.

- [ ] **Step 1: Write a failing wrapper contract test**

  Assert the scheduled wrapper no longer invokes `--drain`, `--retry-failed`, or `--max-total`; assert it invokes the verifier in scheduler-cadence mode and daily stages remain explicit.

- [ ] **Step 2: Run the focused test and verify RED**

  Run: `$env:PYTHONPATH='quant-worker'; .\.venv\Scripts\python.exe -m pytest quant-worker/tests/test_market_ingestion_operations.py -q`

  Expected: FAIL because the wrapper still drains requests synchronously.

- [ ] **Step 3: Implement the minimal enqueue-only wrapper**

  Remove synchronous request draining from scheduled execution. Preserve catalog sync, daily corporate actions, adjusted publication, scheduler start/finally terminalization, and structured counts. Keep an explicit `-DrainRequests` operator-only switch for bounded manual recovery, defaulting off.

- [ ] **Step 4: Update Windows arguments and runbook**

  Ensure installed hourly/daily tasks use the default enqueue-only path. Document that `node scripts/dev-local.mjs` starts the continuous local ingestion worker and production must run the equivalent worker service.

- [ ] **Step 5: Run focused tests and commit**

  Run the test from Step 2 plus `git diff --check`.

  Commit: `feat: decouple quant scheduler from ingestion drain`

### Task 2: Add ingestion-worker heartbeat and lease renewal

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608140004_ingestion_worker_heartbeats/migration.sql`
- Modify: `quant-worker/backtest/ingestion_repository.py`
- Modify: `quant-worker/process_ingestion_requests.py`
- Test: `quant-worker/tests/test_ingestion_requests.py`
- Test: `quant-worker/tests/test_ingestion_repository_integration.py`

**Interfaces:**
- Produces: `ingestion_worker_heartbeats(worker_id, started_at, heartbeat_at, current_request_id, metadata)` and `PostgresRequestRepository.heartbeat(current_request_id: str | None)`.
- Consumes: existing `claim_next()`, `complete()`, and bounded lease fields.

- [ ] **Step 1: Write failing unit and PostgreSQL integration tests**

  Prove heartbeat upsert updates one worker row, current request is cleared after terminalization, active leases renew before expiry, and an expired worker request can be reclaimed exactly once.

- [ ] **Step 2: Verify RED**

  Run: `$env:PYTHONPATH='quant-worker'; .\.venv\Scripts\python.exe -m pytest quant-worker/tests/test_ingestion_requests.py quant-worker/tests/test_ingestion_repository_integration.py -q`

- [ ] **Step 3: Add schema/migration and repository methods**

  Add the heartbeat table without tenant-owned data. Upsert by `worker_id`; write only stable metadata. Add `renew_lease(request_id)` guarded by worker ID, running status, and unexpired lease.

- [ ] **Step 4: Heartbeat the watch loop and provider I/O**

  Update heartbeat when idle, before claim, during provider fetch through a bounded renewal callback, and after completion/failure. A lost lease must fail closed rather than publish from two workers.

- [ ] **Step 5: Verify, validate Prisma, and commit**

  Run focused pytest, `npx prisma validate`, and migration status against the isolated DB.

  Commit: `feat: observe quant ingestion worker leases`

### Task 3: Queue only due datasets and isolate provider failures

**Files:**
- Modify: `quant-worker/sync_provider_instruments.py`
- Modify: `quant-worker/backtest/ingestion_repository.py`
- Test: `quant-worker/tests/test_sync_provider_instruments.py`
- Test: `quant-worker/tests/test_ingestion_repository_integration.py`

**Interfaces:**
- Produces: `queue_market_ingestion_requests(..., now: datetime)` with market/timeframe freshness-aware due selection.
- Consumes: active raw dataset coverage and active queued/running request identity.

- [ ] **Step 1: Write failing due-selection tests**

  Cover fresh crypto hourly, stale crypto hourly, closed HOSE session, daily dataset due after session close, unsupported XAU hourly, and one provider failure not preventing other candidates.

- [ ] **Step 2: Verify RED**

  Run the two focused suites from Task 3.

- [ ] **Step 3: Implement SQL due selection**

  Join active raw versions and enqueue only absent or stale identities. Use market/timeframe thresholds consistent with the versioned calendar contract and exclude explicitly unsupported provider/timeframe pairs.

- [ ] **Step 4: Make concurrent scheduling idempotent**

  Use an advisory transaction lock around candidate insertion and `ON CONFLICT DO NOTHING` against the active-request partial unique index.

- [ ] **Step 5: Verify and commit**

  Commit: `fix: queue only due market datasets`

### Task 4: Complete health/readiness worker observability

**Files:**
- Modify: `quant-worker/verify_market_ingestion.py`
- Modify: `scripts/verify-market-ingestion.ps1`
- Modify: `src/lib/backend/types.ts`
- Modify: `src/lib/backend/quant-assets.ts`
- Modify: `src/lib/backtest/data-readiness-client.ts`
- Modify: `src/components/MarketDataHealthPanel.tsx`
- Modify: `src/lib/i18n/dictionary.ts`
- Test: `quant-worker/tests/test_market_ingestion_operations.py`
- Test: `src/lib/backend/quant-assets.test.ts`
- Test: `src/lib/backtest/data-readiness-client.test.ts`

**Interfaces:**
- Produces: `workerHeartbeatAt`, `workerStatus`, `dueBacklogCount`, `oldestDueBacklogAt`, and grouped retryability in `QuantDataReadinessResponse`.

- [ ] **Step 1: Write failing Python and TypeScript contract tests**

  Assert a fresh heartbeat with no over-age due work is healthy; stale heartbeat with due work is failed; recent provider failures with fresh datasets are degraded diagnostics rather than readiness failure.

- [ ] **Step 2: Verify RED**

  Run the focused Python and Vitest suites.

- [ ] **Step 3: Extend verifier and API aggregation**

  Query latest heartbeat and due backlog independently. Keep stable failure grouping and scheduler last-success semantics. Do not expose worker IDs or raw errors to the browser.

- [ ] **Step 4: Render bilingual operational evidence**

  Add worker heartbeat, due backlog, and degraded provider diagnostics to `MarketDataHealthPanel` through dictionary keys.

- [ ] **Step 5: Verify and commit**

  Run focused tests, `npx tsc --noEmit`, and `git diff --check`.

  Commit: `feat: expose quant ingestion worker health`

### Task 5: Operational convergence and P0.1 gate

**Files:**
- Create: `docs/verification/2026-08-14-quant-p0-1-ingestion.md`
- Modify only defects revealed by the smoke.

- [ ] **Step 1: Apply migration and start the canonical stack**

  Run Prisma deploy/status, then `node scripts/dev-local.mjs` and verify ports 3100/8100.

- [ ] **Step 2: Execute enqueue-only hourly and daily smokes**

  Record scheduler duration, queued count, terminal status, and verify no synchronous full-universe drain.

- [ ] **Step 3: Observe the watch worker convergence**

  Poll structured health until due backlog empties or an external provider reaches a terminal bounded failure. Record provider/error counts and do not claim healthy when stale data remains.

- [ ] **Step 4: Run the P0.1 verification suite**

  Run all ingestion Python tests, readiness Vitest, TypeScript, Prisma validation/status, installer `-Verify`, and the operational verifier.

- [ ] **Step 5: Document evidence and commit**

  Commit: `docs: verify quant ingestion convergence`

