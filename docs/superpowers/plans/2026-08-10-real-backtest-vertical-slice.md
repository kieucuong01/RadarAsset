# Real Backtest Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a tenant-scoped MA-crossover backtest that consumes immutable 1D/1H datasets for FPT, BTC/USDT, and XAU/USD and renders real worker-produced metrics and artifacts in Quant Lab.

**Architecture:** PostgreSQL stores immutable dataset bars/version metadata, queued runs, and small JSON artifacts for the MVP. Next.js validates and queues strict allow-listed requests; a deterministic Python worker executes next-bar long-only simulations and commits checksummed results that the React UI polls and renders.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zod, Prisma 7/PostgreSQL, Python 3.12, psycopg 3, pytest, Recharts.

## Global Constraints

- Timeframes are exactly `1d` and `1h`; timestamps are UTC.
- Canonical assets are `VN:HOSE:FPT`, `CRYPTO:BINANCE:BTCUSDT`, and `METAL:OTC:XAUUSD`.
- FPT is long-only with leverage from `1.0` through `2.0`; BTC and XAU are long-only with leverage exactly `1.0` maximum.
- Signals calculated on bar `t` can fill no earlier than bar `t+1` open.
- Fees and adverse slippage apply to both entry and exit.
- Provider/free datasets are `research_only`; no UI copy may call them commercially licensed or live trading data.
- HTTP tenant identity comes only from the authenticated server session.
- No user code, `eval`, dynamic user imports, user-controlled file paths, or shell execution.

---

### Task 1: Immutable Dataset and Run Artifact Schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608100002_real_backtest_vertical_slice/migration.sql`
- Modify: `src/lib/backend/types.ts`
- Test: `src/lib/backend/tenant-isolation.integration.test.ts`

**Interfaces:**
- Produces Prisma models `DataProvider`, `ProviderInstrument`, `Dataset`, `DatasetVersion`, `DatasetBar`, `DataQualityIssue`, and `QuantRunArtifact`.
- Extends `Asset` with `canonicalKey`, `market`, `venue`, `timezone`, and `maxLeverage`.
- Extends `QuantRun` with `timeframe`, `progress`, `strategyHash`, `datasetVersionIds`, and `engineVersion`.

- [ ] Add an integration assertion proving organization A cannot retrieve organization B's run artifacts through tenant-scoped loaders.
- [ ] Run the integration test and confirm it fails because artifact models/loaders do not exist.
- [ ] Add the Prisma models, indexes, foreign keys, and forward-only SQL migration; existing rows receive compatibility defaults and no destructive rewrite.
- [ ] Generate Prisma Client and run `prisma validate`.
- [ ] Run the integration test and confirm the schema-backed setup passes once loaders land in Task 5.

### Task 2: Strict Backtest Submission Contract

**Files:**
- Create: `src/lib/backtest/contracts.ts`
- Test: `src/lib/backtest/contracts.test.ts`
- Modify: `src/app/api/quant/runs/route.ts`

**Interfaces:**
- Produces `backtestSubmissionSchema`, `BacktestSubmission`, `normalizeBacktestSubmission()`, `hashBacktestSubmission()`, and `effectiveLeverageForMarket()`.
- Normalized fields are `strategy`, `timeframe`, `fastPeriod`, `slowPeriod`, `initialCapital`, `feeBps`, `slippageBps`, `requestedLeverage`, `assets`, `from`, and `to`.

- [ ] Write failing table tests for unknown strategies/timeframes/assets, `fastPeriod >= slowPeriod`, excessive periods, invalid dates, non-positive capital, excessive costs, and leverage above market caps.
- [ ] Write a failing stability test with a hand-pinned SHA-256 for semantically identical payloads whose input key order differs.
- [ ] Run `vitest src/lib/backtest/contracts.test.ts` and confirm missing-module failures.
- [ ] Implement strict Zod parsing, canonical sorting, stable JSON serialization, hashing, and explicit market leverage validation.
- [ ] Run the contract tests until green, then refactor duplicate validation messages without changing behavior.

### Task 3: Dataset Normalization, Quality, and Publication

**Files:**
- Create: `quant-worker/backtest/__init__.py`
- Create: `quant-worker/backtest/models.py`
- Create: `quant-worker/backtest/quality.py`
- Create: `quant-worker/backtest/providers.py`
- Create: `quant-worker/ingest_market_data.py`
- Create: `quant-worker/tests/test_quality.py`
- Create: `quant-worker/tests/test_providers.py`
- Modify: `quant-worker/requirements.txt`
- Modify: `quant-worker/README.md`

**Interfaces:**
- Produces immutable `Bar`, `DatasetManifest`, `QualityIssue`, `normalize_rows()`, `validate_bars()`, `canonical_bar_checksum()`, and `publish_dataset()`.
- Provider contract is `fetch(symbol, timeframe, start, end) -> list[Bar]` with adapters `BinanceSpotAdapter` and `VnstockAdapter`.

- [ ] Write failing quality tests with literal expectations for UTC normalization, sorted output, duplicate rejection, OHLC rejection, non-negative volume, calendar-aware missing-bar counts, and stable checksums.
- [ ] Write failing provider-fixture tests that map complete Binance and Vnstock response shapes without calling the network.
- [ ] Run `pytest quant-worker/tests/test_quality.py quant-worker/tests/test_providers.py -q` and confirm import failures.
- [ ] Implement focused dataclasses, canonical decimal serialization, quality rules, provider response mapping, timeouts, bounded retries, and fixed allow-listed endpoints.
- [ ] Implement transactional publication that creates a new version/bars/issues, verifies the stored checksum, and activates it after insert.
- [ ] Run the quality/provider tests until green.

### Task 4: Event-Driven MA-Crossover Engine

**Files:**
- Create: `quant-worker/backtest/engine.py`
- Create: `quant-worker/tests/fixtures/ma_cross_golden.json`
- Create: `quant-worker/tests/test_engine_golden.py`

**Interfaces:**
- Produces `run_ma_cross(bars_by_asset, config) -> BacktestResult`.
- `BacktestResult` contains summary metrics plus equity, drawdown, trades, and manifest payloads.

- [ ] Add a hand-calculated fixture where a cross on bar `t` buys at `t+1` open and a later cross exits at the following open; pin fill prices, fees, slippage cost, quantity, realized PnL, final equity, and maximum drawdown.
- [ ] Add failing abuse tests proving no same-bar fill, no negative position, BTC/XAU leverage above `1x` is rejected, FPT above `2x` is rejected, and all emitted trades are long.
- [ ] Run `pytest quant-worker/tests/test_engine_golden.py -q` and confirm import failures.
- [ ] Implement SMA calculation, pending next-open orders, long-only cash/borrow accounting per capital sleeve, costs, union-timestamp equity alignment, drawdown, and deterministic metrics.
- [ ] Run the golden tests until green and verify repeated runs serialize to the same artifact checksums.

### Task 5: Queue Worker and Tenant-Scoped API Results

**Files:**
- Rewrite: `quant-worker/worker.py`
- Create: `quant-worker/tests/test_worker.py`
- Modify: `src/lib/backend/db.ts`
- Modify: `src/lib/backend/types.ts`
- Modify: `src/app/api/quant/runs/route.ts`
- Modify: `src/app/api/quant/runs/[id]/route.ts`
- Modify: `src/app/api/tenant-routes.test.ts`
- Modify: `src/lib/backend/tenant-isolation.integration.test.ts`

**Interfaces:**
- `createQuantRun(context, normalizedSubmission)` resolves active dataset versions and queues an immutable input fingerprint.
- `getQuantRun(context, id)` returns progress, lifecycle timestamps, metrics, and checksummed artifacts scoped to `organizationId`.
- Worker claims with `FOR UPDATE SKIP LOCKED`, verifies bar/version checksums, calls `run_ma_cross`, and commits terminal state plus artifacts in one transaction.

- [ ] Write failing route tests for malformed payloads, viewer submission denial, 202 queued response, and tenant-scoped artifact reads.
- [ ] Write failing Python worker tests for oldest-run claim, checksum mismatch failure, success artifact commit, and idempotent terminal-run handling using a fake repository boundary.
- [ ] Run targeted Vitest and pytest files and confirm behavior failures.
- [ ] Implement Prisma loaders/creation transaction, response mapping, HTTP 202 behavior, and generic error mapping.
- [ ] Refactor the Python worker behind a repository protocol; retain direct PostgreSQL implementation with parameterized SQL and stable failure codes.
- [ ] Run targeted tests until green.

### Task 6: Real Quant Lab Polling and Result Rendering

**Files:**
- Create: `src/lib/backtest/client.ts`
- Test: `src/lib/backtest/client.test.ts`
- Create: `src/components/BacktestWorkbench.tsx`
- Modify: `src/components/QuantLab.tsx`

**Interfaces:**
- Produces `submitBacktest()`, `getBacktestRun()`, `isActiveRun()`, and `BacktestWorkbench`.
- `BacktestWorkbench` owns form state, submission, two-second polling, progress/error presentation, and charts/tables from real artifacts.

- [ ] Write failing client tests for 202 parsing, active-state detection, terminal-state polling stop, and safe malformed-artifact rejection.
- [ ] Run the client tests and confirm missing-module failures.
- [ ] Implement typed client helpers with `AbortSignal`, generic user errors, and no client-supplied tenant identity.
- [ ] Implement the workbench with exactly three allow-listed assets, 1D/1H selector, MA periods, cost/leverage controls, queued/running progress, real equity/drawdown charts, and long-only trade table.
- [ ] Remove the backtest tab's generated equity/KPIs/trades and simulated badge; retain optimizer/prediction demos with their existing labels.
- [ ] Run client tests, TypeScript, ESLint, and production build.

### Task 7: Representative Dataset Bootstrap and End-to-End Verification

**Files:**
- Modify: `prisma/seed.ts`
- Create: `quant-worker/bootstrap_research_datasets.py`
- Create: `scripts/run-backtest-e2e.mjs`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Bootstrap publishes both `1d` and `1h` active versions for FPT, BTCUSDT, and XAUUSD with research-only provenance.
- E2E script creates an isolated local tenant/run, executes one worker cycle, verifies persisted artifacts, and cleans up only its exact test tenant.

- [ ] Add a failing database verification that expects six active dataset versions and zero high-severity quality issues.
- [ ] Implement provider-backed bootstrap with a checked-in deterministic fixture fallback that is explicitly labeled `research_fixture` and never labeled live.
- [ ] Run bootstrap against the local development database; record sources, coverage, row counts, checksums, and missing-bar counts.
- [ ] Implement and run the exact-tenant cleanup-safe E2E script.
- [ ] Run full Vitest, Python pytest, Prisma validation/migration status, TypeScript, ESLint, production build, `npm audit`, and `pip check`.
- [ ] Start `next start`, complete a browser submission-to-result flow on desktop, then verify mobile has no horizontal overflow and that all rendered trades are long.
- [ ] Audit every original requirement against schema rows, test output, worker output, API responses, and browser evidence before completion.

