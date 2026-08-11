# Strategy Alerts and Mock Portfolio Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user apply one successful strategy configuration to a Mock Portfolio holding, evaluate it after each eligible dataset publication, receive idempotent BUY/SELL alerts, and review one linked simulated transaction.

**Architecture:** PostgreSQL stores immutable assignments, evaluation jobs, signals, and notifications under tenant ownership. Market ingestion enqueues idempotent jobs, the durable Python worker from the multi-strategy plan uses the same strategy implementation incrementally, and Next.js exposes tenant-scoped assignment, signal, notification, and transaction actions. Alerts prepare reviewable transactions but never auto-execute.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zod 4, Prisma 7, PostgreSQL, Python 3.12-compatible code, psycopg 3, pytest, Vitest, Recharts.

## Global Constraints

- This plan starts only after `2026-08-11-multi-strategy-backtest.md` passes all gates.
- At most one active Strategy Assignment exists per portfolio and asset in the MVP.
- Replacing a strategy archives the prior assignment atomically; it never rewrites history.
- Initial evaluation creates an `INITIAL_SNAPSHOT`, not a historical BUY/SELL notification.
- Subsequent notification is created only when position state changes between flat and long.
- No alert automatically changes Mock Portfolio.
- The user reviews quantity, price, fee, and execution time before confirming a simulated transaction.
- A signal may create at most one portfolio transaction, and transaction side must match signal side.
- Stale, quarantined, unsupported, or insufficient data cannot create an actionable signal.
- All assignment, job, signal, notification, run, portfolio, and transaction relations are tenant-validated server-side.
- Use the same strategy version and implementation for backtest and incremental evaluation.
- In-app notifications are the only delivery channel in this plan.

---

### Task 1: Add tenant-scoped strategy assignment and signal storage

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608110002_strategy_assignments_signals/migration.sql`
- Modify: `src/lib/backend/tenant-isolation.integration.test.ts`

**Interfaces:**
- Consumes: `StrategyVersion`, `QuantRun`, `Portfolio`, `Asset`, `Organization`, `AppUser`, and `PortfolioTransaction`.
- Produces: Prisma models `StrategyAssignment`, `StrategyEvaluationJob`, `StrategySignal`, `Notification`, and `PortfolioTransaction.sourceSignalId`.

- [ ] **Step 1: Write failing cross-tenant relation tests**

Create two organizations, portfolios, and assets. Assert a source run from organization A cannot be connected to an assignment or transaction in organization B. Assert deleting organization A cascades only A’s assignments, jobs, signals, and notifications.

- [ ] **Step 2: Run the focused integration test and verify failure**

Run: `npm run test:integration -- src/lib/backend/tenant-isolation.integration.test.ts`

Expected: FAIL because the new models and relations do not exist.

- [ ] **Step 3: Add models and database invariants**

Implement fields from the approved spec. Add these database-enforced constraints:

```sql
CREATE UNIQUE INDEX strategy_assignments_one_active_per_asset
ON strategy_assignments (portfolio_id, asset_id)
WHERE status = 'active';

CREATE UNIQUE INDEX strategy_evaluation_jobs_idempotency
ON strategy_evaluation_jobs (assignment_id, dataset_version_id);

CREATE UNIQUE INDEX strategy_signals_idempotency
ON strategy_signals (assignment_id, dataset_version_id, signal_at);

CREATE UNIQUE INDEX portfolio_transactions_one_signal_action
ON portfolio_transactions (source_signal_id)
WHERE source_signal_id IS NOT NULL;
```

Use `ON DELETE CASCADE` from tenant-owned parents, `RESTRICT` for immutable strategy and dataset references, and `SET NULL` only where historical transactions must survive a non-material optional relation.

- [ ] **Step 4: Regenerate Prisma and run integration tests**

Run:

```powershell
npx prisma generate
npm run test:integration -- src/lib/backend/tenant-isolation.integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the persistence slice**

```powershell
git add prisma/schema.prisma prisma/migrations/202608110002_strategy_assignments_signals/migration.sql src/lib/backend/tenant-isolation.integration.test.ts
git commit -m "feat: persist strategy assignments and signals"
```

### Task 2: Implement the assignment domain and Apply Strategy API

**Files:**
- Create: `src/lib/strategy-assignments/contracts.ts`
- Create: `src/lib/strategy-assignments/contracts.test.ts`
- Create: `src/lib/strategy-assignments/errors.ts`
- Create: `src/lib/backend/strategy-assignments.ts`
- Create: `src/lib/backend/strategy-assignments.test.ts`
- Create: `src/app/api/strategy-assignments/route.ts`
- Create: `src/app/api/strategy-assignments/[id]/route.ts`
- Modify: `src/app/api/tenant-routes.test.ts`
- Modify: `src/lib/auth/permissions.ts`
- Modify: `src/lib/auth/permissions.test.ts`

**Interfaces:**
- Consumes: successful catalog-backed Quant Run with per-asset metrics from Plan 1.
- Produces: `createStrategyAssignment(context, input)`, `updateStrategyAssignment(context, id, action)`, POST collection route, and PATCH item route.

- [ ] **Step 1: Write domain tests for source-run matching and replacement**

Test exact rejection cases:

- Source run is not `succeeded`.
- Source run belongs to another tenant.
- Requested asset was not in the run.
- Strategy version, timeframe, or normalized parameters differ from the run.
- Portfolio does not contain or belong to the tenant.
- The source dataset is stale, quarantined, or no longer eligible for the requested timeframe.
- Replacement archives the existing active row and creates one active row atomically.

Use a strict contract:

```ts
const applyStrategySchema = z.object({
  portfolioId: z.string().uuid(),
  asset: z.enum(["FPT", "BTC", "XAU"]),
  sourceQuantRunId: z.string().uuid(),
}).strict();
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx vitest run src/lib/strategy-assignments/contracts.test.ts src/lib/backend/strategy-assignments.test.ts src/app/api/tenant-routes.test.ts`

Expected: FAIL because the assignment domain and routes do not exist.

- [ ] **Step 3: Implement atomic apply behavior**

Inside one Prisma transaction, lock the portfolio and any active assignment, validate the source run/artifact, archive the current assignment, create the new assignment with `lastEvaluatedDatasetVersionId = null`, and enqueue an initial evaluation job for the run’s active dataset version.

Define stable assignment error codes in `errors.ts`: `ASSIGNMENT_CONFLICT`, `SOURCE_RUN_MISMATCH`, `DATASET_UNAVAILABLE`, `DATASET_STALE`, `SIGNAL_ALREADY_ACTED`, `SIGNAL_SIDE_MISMATCH`, and `POSITION_UNAVAILABLE`. Routes expose only the code and sanitized message.

- [ ] **Step 4: Implement pause, resume, and archive**

PATCH accepts only `{ action: "pause" | "resume" | "archive" }`. Resume verifies an eligible active dataset exists and enqueues evaluation if the dataset advanced while paused. Parameter mutation is rejected; changing strategy requires replacement through POST.

- [ ] **Step 5: Apply capabilities**

Creating or changing an assignment requires both `portfolio/write` and `backtest/create`. Viewers retain read-only access to rendered assignment/signal state.

- [ ] **Step 6: Run domain and route tests**

Run: `npx vitest run src/lib/strategy-assignments src/lib/backend/strategy-assignments.test.ts src/app/api/tenant-routes.test.ts src/lib/auth/permissions.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit assignment APIs**

```powershell
git add src/lib/strategy-assignments src/lib/backend/strategy-assignments.ts src/lib/backend/strategy-assignments.test.ts src/app/api/strategy-assignments src/app/api/tenant-routes.test.ts src/lib/auth/permissions.ts src/lib/auth/permissions.test.ts
git commit -m "feat: apply strategies to portfolio holdings"
```

### Task 3: Enqueue evaluation jobs after immutable dataset publication

**Files:**
- Create: `quant-worker/backtest/signal_jobs.py`
- Create: `quant-worker/tests/test_signal_jobs.py`
- Modify: `quant-worker/backtest/publication.py`
- Modify: `quant-worker/backtest/ingestion_repository.py`
- Modify: `quant-worker/tests/test_publication.py`
- Modify: `quant-worker/tests/test_ingestion_repository_integration.py`

**Interfaces:**
- Consumes: newly active `DatasetVersion` and active `StrategyAssignment` rows.
- Produces: `enqueue_strategy_evaluations(connection, dataset_version_id)` with unique assignment/dataset jobs.

- [ ] **Step 1: Write publication and idempotency tests**

Assert publication of an eligible active dataset creates one queued job per matching active assignment. Publishing the same version again creates no duplicate. Paused/archived assignments, mismatched assets, mismatched timeframes, quarantined versions, and XAU 1h create no job.

- [ ] **Step 2: Run focused Python tests and verify failure**

Run: `python -m pytest quant-worker/tests/test_signal_jobs.py quant-worker/tests/test_publication.py -q`

Expected: FAIL because job enqueueing does not exist.

- [ ] **Step 3: Implement transactionally after activation**

Insert jobs with `ON CONFLICT (assignment_id, dataset_version_id) DO NOTHING` only after the version is marked active and prior versions are deactivated. Keep publication and job creation in the same database transaction.

- [ ] **Step 4: Run unit and isolated database integration tests**

Run:

```powershell
python -m pytest quant-worker/tests/test_signal_jobs.py quant-worker/tests/test_publication.py -q
python -m pytest quant-worker/tests/test_ingestion_repository_integration.py -q
```

Expected: PASS when the isolated test database is configured.

- [ ] **Step 5: Commit ingestion-driven jobs**

```powershell
git add quant-worker/backtest/signal_jobs.py quant-worker/backtest/publication.py quant-worker/backtest/ingestion_repository.py quant-worker/tests/test_signal_jobs.py quant-worker/tests/test_publication.py quant-worker/tests/test_ingestion_repository_integration.py
git commit -m "feat: enqueue strategy evaluation after ingestion"
```

### Task 4: Evaluate live signals with backtest parity

**Files:**
- Create: `quant-worker/backtest/signal_evaluator.py`
- Create: `quant-worker/tests/test_signal_evaluator.py`
- Create: `quant-worker/tests/test_backtest_live_parity.py`
- Modify: `quant-worker/worker.py`
- Modify: `quant-worker/tests/test_worker.py`

**Interfaces:**
- Consumes: `get_strategy`, shared strategy decisions, Strategy Evaluation Jobs, immutable bars, and assignment prior state.
- Produces: `process_next_signal_job(repository)` and durable worker dispatch across backtest and signal queues.

- [ ] **Step 1: Write initial-snapshot and transition tests**

Assert first evaluation writes `INITIAL_SNAPSHOT`, updates assignment state/version, and creates no notification. Assert later flat-to-long writes BUY plus one notification, long-to-flat writes SELL plus one notification, and HOLD writes an informational evaluation without notification.

- [ ] **Step 2: Write replay parity tests before implementation**

For each of the four strategies, evaluate one full immutable dataset as a backtest, then reveal bars incrementally to the signal evaluator. Compare exact state transitions, timestamps, reason codes, confirmation closes, and indicator snapshots.

- [ ] **Step 3: Run tests and verify failure**

Run: `python -m pytest quant-worker/tests/test_signal_evaluator.py quant-worker/tests/test_backtest_live_parity.py -q`

Expected: FAIL because the evaluator does not exist.

- [ ] **Step 4: Implement idempotent evaluation**

Claim a queued job with `FOR UPDATE SKIP LOCKED`, verify assignment is active, verify dataset checksum, load required warm-up, resolve the exact strategy version, evaluate through the shared strategy implementation, and commit signal, assignment progress, notification, and job completion atomically. Retry transient connection errors only; invalid strategy/data failures become sanitized terminal job errors.

- [ ] **Step 5: Extend the durable worker loop**

Alternate bounded claims between Quant Runs and Signal Evaluation Jobs so a busy backtest queue cannot starve live signals. One loop iteration handles at most one job from each queue before sleeping.

- [ ] **Step 6: Run parity and worker tests**

Run: `python -m pytest quant-worker/tests/test_signal_evaluator.py quant-worker/tests/test_backtest_live_parity.py quant-worker/tests/test_worker.py -q`

Expected: PASS for all four strategies.

- [ ] **Step 7: Commit signal evaluation**

```powershell
git add quant-worker/backtest/signal_evaluator.py quant-worker/worker.py quant-worker/tests/test_signal_evaluator.py quant-worker/tests/test_backtest_live_parity.py quant-worker/tests/test_worker.py
git commit -m "feat: evaluate portfolio strategy signals"
```

### Task 5: Expose portfolio strategy state and notifications

**Files:**
- Create: `src/lib/backend/portfolio-signals.ts`
- Create: `src/lib/backend/portfolio-signals.test.ts`
- Create: `src/app/api/portfolio/strategy-signals/route.ts`
- Create: `src/app/api/notifications/route.ts`
- Create: `src/app/api/notifications/[id]/route.ts`
- Create: `src/lib/strategy-signals/client.ts`
- Create: `src/lib/strategy-signals/client.test.ts`
- Modify: `src/lib/backend/types.ts`
- Modify: `src/app/api/tenant-routes.test.ts`

**Interfaces:**
- Consumes: Strategy Assignment, Strategy Signal, Notification, and existing portfolio holdings.
- Produces: `loadPortfolioStrategySignals(context)`, `loadNotifications(context)`, `markNotificationRead(context, id)`, and typed clients.

- [ ] **Step 1: Write tenant-scoped response tests**

Assert only the active assignment and latest tenant-owned signal are returned for each holding. Verify bounded indicator snapshots, stable states, unread count, newest-first ordering, and cross-tenant notification IDs returning not found.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx vitest run src/lib/backend/portfolio-signals.test.ts src/lib/strategy-signals/client.test.ts src/app/api/tenant-routes.test.ts`

Expected: FAIL because signal and notification loaders do not exist.

- [ ] **Step 3: Implement loaders and routes**

Map database statuses to the public union:

```ts
type PortfolioStrategyStatus =
  | "BUY"
  | "SELL"
  | "HOLD"
  | "INITIAL_SNAPSHOT"
  | "DATA_STALE"
  | "EVALUATION_FAILED";
```

Never return internal lock timestamps, attempt details, raw errors, or other-tenant identifiers.

- [ ] **Step 4: Run API, client, and tenant tests**

Run: `npx vitest run src/lib/backend/portfolio-signals.test.ts src/lib/strategy-signals/client.test.ts src/app/api/tenant-routes.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit read APIs**

```powershell
git add src/lib/backend/portfolio-signals.ts src/lib/backend/portfolio-signals.test.ts src/app/api/portfolio/strategy-signals src/app/api/notifications src/lib/strategy-signals src/lib/backend/types.ts src/app/api/tenant-routes.test.ts
git commit -m "feat: expose portfolio strategy alerts"
```

### Task 6: Link one reviewed signal to one Mock Portfolio transaction

**Files:**
- Modify: `src/lib/backend/types.ts`
- Modify: `src/lib/backend/db.ts`
- Modify: `src/lib/backend/portfolio.test.ts`
- Modify: `src/app/api/portfolio/transactions/route.ts`
- Modify: `src/app/api/tenant-routes.test.ts`
- Modify: `src/components/PortfolioTransactionDialog.tsx`
- Modify: `src/lib/portfolio-transaction-preview.ts`
- Modify: `src/lib/portfolio-transaction-preview.test.ts`

**Interfaces:**
- Consumes: pending BUY/SELL `StrategySignal` and existing portfolio transaction accounting.
- Produces: optional `sourceSignalId` on `PortfolioTransactionCreateInput`, server validation, and prefilled review dialog.

- [ ] **Step 1: Write failing signal-action validation tests**

Test:

- BUY signal can create one Buy for its portfolio/asset.
- SELL signal can create one Sell only when quantity is available.
- HOLD and INITIAL_SNAPSHOT cannot create a transaction.
- Side mismatch, tenant mismatch, portfolio mismatch, asset mismatch, acted/dismissed signal, and duplicate action are rejected.
- A successful transaction marks the signal `acted` in the same transaction.

- [ ] **Step 2: Run focused accounting and route tests**

Run: `npx vitest run src/lib/backend/portfolio.test.ts src/lib/portfolio-transaction-preview.test.ts src/app/api/tenant-routes.test.ts`

Expected: FAIL because `sourceSignalId` is not accepted or validated.

- [ ] **Step 3: Extend transaction creation atomically**

Lock the source signal and portfolio, validate all relations and side, call the existing transaction-ledger path, persist `sourceSignalId`, recompute positions, and mark signal acted before committing. Preserve manual transaction behavior when `sourceSignalId` is absent.

- [ ] **Step 4: Prefill but do not auto-submit the dialog**

The dialog receives `{ sourceSignalId, symbol, side, referencePrice, signalAt }`, displays the signal context, and requires the user to enter or confirm quantity, fee, price, and execution time. The primary button remains an explicit confirmation.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run src/lib/backend/portfolio.test.ts src/lib/portfolio-transaction-preview.test.ts src/app/api/tenant-routes.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit signal-linked transactions**

```powershell
git add src/lib/backend/types.ts src/lib/backend/db.ts src/lib/backend/portfolio.test.ts src/app/api/portfolio/transactions/route.ts src/app/api/tenant-routes.test.ts src/components/PortfolioTransactionDialog.tsx src/lib/portfolio-transaction-preview.ts src/lib/portfolio-transaction-preview.test.ts
git commit -m "feat: review strategy signals as mock trades"
```

### Task 7: Add Apply Strategy and signal controls to the UI

**Files:**
- Modify: `src/components/backtest/BacktestResults.tsx`
- Create: `src/components/backtest/ApplyStrategyDialog.tsx`
- Create: `src/components/portfolio/PortfolioStrategyPanel.tsx`
- Create: `src/components/portfolio/NotificationCenter.tsx`
- Create: `src/lib/strategy-signals/presentation.ts`
- Create: `src/lib/strategy-signals/presentation.test.ts`
- Modify: `src/components/MockPortfolio.tsx`
- Modify: `src/components/Header.tsx`

**Interfaces:**
- Consumes: assignment APIs, portfolio signal client, notification APIs, and prefilled transaction dialog.
- Produces: Apply Strategy confirmation, active strategy state, pause/replace controls, notification center, and Review Buy/Sell actions.

- [ ] **Step 1: Write failing UI-state tests**

Test that Apply Strategy appears only for a successful supported per-asset result, replacement shows the archived-strategy warning, mobile holding detail expands without widening the page, actionable BUY/SELL opens the review dialog, and HOLD/stale/failed states do not show a trade action.

- [ ] **Step 2: Run component tests and verify failure**

Run: `npx vitest run src/lib/strategy-signals/presentation.test.ts`

Expected: FAIL because the pure portfolio strategy presentation model does not exist.

- [ ] **Step 3: Implement Apply Strategy confirmation**

Show asset, strategy/version, timeframe, normalized parameters, data freshness, and reference per-asset metrics. The user must confirm replacement when an active assignment exists.

- [ ] **Step 4: Implement portfolio strategy surfaces**

Desktop adds compact Strategy and Signal cells. Mobile uses an expandable panel. Include Backtest, Replace, Pause/Resume, and Review actions with explicit unavailable reasons. Keep action visibility, status labels, and signal-to-dialog prefill mapping in pure `presentation.ts` functions so Vitest does not require a DOM testing dependency.

- [ ] **Step 5: Implement in-app notifications**

Add a header bell with unread count and a bounded recent list. Opening a notification routes to the relevant holding and does not mark it acted. Mark-read is separate from transaction confirmation.

- [ ] **Step 6: Run UI tests and TypeScript**

Run:

```powershell
npx vitest run src/lib/strategy-signals/presentation.test.ts src/lib/strategy-signals/client.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit portfolio UI integration**

```powershell
git add src/components/backtest/BacktestResults.tsx src/components/backtest/ApplyStrategyDialog.tsx src/components/portfolio src/components/MockPortfolio.tsx src/components/Header.tsx src/lib/strategy-signals/presentation.ts src/lib/strategy-signals/presentation.test.ts
git commit -m "feat: connect strategy alerts to mock portfolio"
```

### Task 8: Verify the end-to-end assignment and alert flow

**Files:**
- Modify only if verification exposes a defect in files already listed above.

**Interfaces:**
- Consumes: all prior tasks and the durable worker.
- Produces: evidence that the complete approved MVP flow works locally.

- [ ] **Step 1: Run all unit and integration suites**

Run:

```powershell
npm test
python -m pytest quant-worker/tests -q
npm run test:integration
```

Expected: all configured tests PASS against the isolated integration database.

- [ ] **Step 2: Run static and build gates**

Run:

```powershell
npx tsc --noEmit
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Run browser workflow on desktop**

Exercise this exact path:

`Mock Portfolio holding → Backtest → successful result → Apply Strategy → initial snapshot → publish next eligible dataset → BUY/SELL notification → Review transaction → confirm → updated quantity/cost/PnL/history`

Verify page identity, non-blank content, no framework overlay, no relevant console error/warning, and visible state after every action.

- [ ] **Step 4: Run mobile workflow at 390px**

Verify holding strategy details expand, notification content is readable, review dialog fits the viewport, and `document.documentElement.scrollWidth === document.documentElement.clientWidth` outside intentionally scrollable tables.

- [ ] **Step 5: Run idempotency and permission smoke**

Republish the same dataset version and verify no duplicate job, signal, or notification. Attempt Apply Strategy and transaction confirmation as a viewer and verify the UI is disabled and the API returns forbidden.

- [ ] **Step 6: Resolve verification defects through their owning task**

If a gate exposes a defect, return to the task that owns that file, add a failing regression test to that task's listed test file, implement the minimal correction, rerun the task's focused command and the failed gate, then commit only the files named by that task. If no defect is found, do not create an empty commit.
