# Quant P0.4 E2E and Capacity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the authenticated multi-market Quant workflow and correctness under 20–50 concurrent backtests.

**Architecture:** Add browser E2E through the existing local Next.js/worker stack and a PostgreSQL-backed Python capacity harness. Test data is isolated and labeled; provider-backed operational evidence remains a separate gate.

**Tech Stack:** Next.js 16, Better Auth, Playwright CLI/runtime, PostgreSQL/Prisma, Python ThreadPoolExecutor/psycopg, Vitest/pytest.

## Global Constraints

- E2E uses an isolated migrated test database and organization.
- Provider-backed readiness is never inferred from deterministic test datasets.
- Transaction execution remains atomic with `sourceSignalId`.
- Capacity tests assert tenant isolation and terminal correctness before latency.

---

### Task 1: Create isolated authenticated Quant fixtures

**Files:**
- Create: `scripts/seed-quant-e2e.ts`
- Create: `src/lib/backend/quant-e2e.integration.test.ts`
- Modify: `scripts/run-integration-tests.mjs`

- [ ] Write a failing integration test that signs up/signs in through Better Auth, creates/selects an organization, and accesses Quant routes with real cookies.
- [ ] Verify RED using `npm run test:integration` with an isolated `TEST_DATABASE_URL`.
- [ ] Add deterministic immutable VN/crypto/XAU test datasets marked `test_fixture`, plus editor membership and empty portfolio.
- [ ] Verify tenant cleanup preserves unrelated organizations and commit `test: add authenticated quant e2e fixtures`.

### Task 2: Automate the complete browser workflow

**Files:**
- Create: `e2e/quant-workflow.spec.ts`
- Create: `playwright.config.ts`
- Modify: `package.json`
- Modify only UI defects exposed by the test.

- [ ] Write the failing desktop workflow for sign-in, three-leg selection, per-leg strategies, run result, Active Portfolio, Equity Curve & Drawdown, KPI, Trade List, and provenance.
- [ ] Verify RED against the canonical local stack.
- [ ] Add only stable test IDs/accessibility labels needed for resilient selection.
- [ ] Extend the workflow through Apply to Mock Portfolio, new dataset publication, signal review/execution, notification, and forward snapshot.
- [ ] Add a 390×844 mobile run and assert no horizontal overflow or console errors.
- [ ] Verify and commit `test: cover authenticated quant workflow`.

### Task 3: Add the 20/50-run capacity harness

**Files:**
- Create: `quant-worker/backtest/capacity.py`
- Create: `quant-worker/run_backtest_capacity.py`
- Create: `quant-worker/tests/test_backtest_capacity.py`
- Modify: `quant-worker/tests/test_worker_concurrency_integration.py`

- [ ] Write failing tests for 20/50 distinct submissions, multiple organizations, queue delay/duration percentiles, cancellation race, deadlines, and artifact ownership.
- [ ] Verify RED.
- [ ] Implement bounded concurrent submission/observation using standard-library `ThreadPoolExecutor`; do not bypass the production claim path.
- [ ] Emit one sanitized JSON report with terminal counts, p50/p95 timings, retries, deadline recovery, and resource observations.
- [ ] Verify and commit `test: measure quant backtest capacity`.

### Task 4: Run the release gate and deliver

**Files:**
- Create: `docs/verification/2026-08-14-quant-p0-4-e2e-capacity.md`
- Update: `README.md`
- Update: `quant-worker/README.md`
- Modify only verified defects.

- [ ] Run complete Vitest, Python pytest, TypeScript, Prisma validate/status, lint for changed files, and production build.
- [ ] Run authenticated desktop/mobile E2E and record browser/console/HTTP evidence.
- [ ] Run 20 and 50 backtests, record correctness and measured p95 values, and document machine/worker/DB limits.
- [ ] Run ingestion/data-quality/historical verifiers; require observed hourly and daily scheduler success before claiming production-ready.
- [ ] Request final code review, resolve Critical/Important findings with TDD, commit `docs: verify quant p0 production readiness`.
- [ ] Merge to local `main`, push `origin/main`, restart `node scripts/dev-local.mjs`, and verify HTTP 200 at `/quant-lab` and `/healthz`.
