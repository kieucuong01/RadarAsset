# Quant Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver trustworthy adjusted Vietnamese datasets and a production-ready queued Backtest → Mock Portfolio → signal workflow, with ingestion operations and robustness evidence.

**Architecture:** Extend the existing immutable dataset, QuantRun queue, artifact, StrategyAssignment, and ingestion contracts. Corporate actions produce separate `total_return` dataset versions; worker lifecycle additions remain cooperative and database-backed; existing result and forward-test UI consumes enriched manifests rather than a parallel API.

**Tech Stack:** Next.js 16, React 19, TypeScript, Prisma/PostgreSQL, Python 3.12+, psycopg, Vnstock, Vitest, pytest.

## Global Constraints

- Preserve raw immutable datasets and never infer corporate actions from price gaps.
- Store timestamps in UTC and construct HOSE sessions in `Asia/Ho_Chi_Minh`.
- Never synthesize missing bars for signals or fills.
- Cache and all mutations remain organization scoped.
- Free-provider data remains `research_only`.
- Use TDD for every behavior change and commit each independently testable task.

---

### Task 1: Corporate-action and catalog-history schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608140001_backtest_data_normalization/migration.sql`
- Test: `quant-worker/tests/test_corporate_actions_repository.py`

**Interfaces:**
- Produces `CorporateAction`, `InstrumentCatalogSnapshot`, and `MarketCalendarVersion` storage.
- Adds `Asset.listingStatus` and `ProviderInstrument.lastSeenAt/isActive` without deleting history.

- [ ] Write failing schema/repository tests for idempotent source-event upsert and inactive catalog retention.
- [ ] Run the targeted tests and confirm missing relations/columns cause failure.
- [ ] Add Prisma models, indexes, foreign keys, enums-as-validated strings, and migration SQL.
- [ ] Implement the minimal psycopg repository and make targeted tests pass.
- [ ] Apply the migration to the configured development database and regenerate Prisma Client.
- [ ] Commit the schema boundary.

### Task 2: VCI corporate-action ingestion and normalization

**Files:**
- Create: `quant-worker/backtest/corporate_actions.py`
- Create: `quant-worker/ingest_corporate_actions.py`
- Test: `quant-worker/tests/test_corporate_actions.py`
- Modify: `scripts/run-market-ingestion.ps1`
- Modify: `quant-worker/README.md`

**Interfaces:**
- `normalize_vci_events(symbol, records) -> list[CorporateActionRecord]`
- `ingest_corporate_actions(repository, symbols, provider) -> CorporateActionSummary`

- [ ] Write failing tests for cash dividend, stock dividend/split, rights issue, unknown event, missing ex-right date, duplicate provider ID, and sanitized provider failure.
- [ ] Verify failures are caused by the absent normalizer.
- [ ] Implement strict parsing of VCI event fields and deterministic checksums.
- [ ] Add bounded retries, per-symbol outcomes, and idempotent publication.
- [ ] Add corporate-action ingestion to the daily scheduler after raw bar ingestion.
- [ ] Run targeted and provider smoke tests, then commit.

### Task 3: Versioned HOSE calendar and data-quality rules

**Files:**
- Modify: `quant-worker/backtest/market_calendar.py`
- Modify: `quant-worker/backtest/quality.py`
- Test: `quant-worker/tests/test_market_calendar.py`
- Test: `quant-worker/tests/test_quality.py`

**Interfaces:**
- `expected_bar_timestamps(..., calendar: MarketCalendar) -> set[datetime]`
- Quality summaries expose calendar version and missing-bar policy.

- [ ] Write failing tests for local-time session conversion, lunch break anchors, closure dates, daily close timestamp, and non-synthetic gap handling.
- [ ] Replace UTC-hour assumptions with an explicit `HOSE_MVP_V1` local calendar.
- [ ] Persist/emit calendar version and gap warnings in publication metadata.
- [ ] Run calendar/quality tests and commit.

### Task 4: Derive immutable total-return datasets

**Files:**
- Create: `quant-worker/backtest/adjustments.py`
- Create: `quant-worker/derive_adjusted_datasets.py`
- Modify: `quant-worker/backtest/publication.py`
- Test: `quant-worker/tests/test_adjustments.py`
- Test: `quant-worker/tests/test_publication.py`

**Interfaces:**
- `build_adjustment_factors(raw_rows, actions, timezone_name) -> AdjustmentResult`
- Publisher accepts explicit `adjustment_policy: Literal['raw','total_return']`.

- [ ] Write failing golden tests for each supported action and combined chronological factors.
- [ ] Assert ambiguous/missing action inputs block publication without changing raw active versions.
- [ ] Implement backward-adjusted daily OHLC and local-date hourly factor application.
- [ ] Publish separate immutable `total_return` versions with action checksum and warnings.
- [ ] Derive and verify real FPT daily/hourly adjusted datasets in the development database.
- [ ] Commit derivation and publication.

### Task 5: Surface policy, quality, and survivorship in Backtest

**Files:**
- Modify: `src/lib/backend/types.ts`
- Modify: `src/lib/backend/quant-assets.ts`
- Modify: `src/lib/backend/quant-runs.ts`
- Modify: `src/lib/backtest/asset-client.ts`
- Modify: `src/lib/backtest/client.ts`
- Modify: `src/components/QuantAssetPickerDialog.tsx`
- Modify: `src/components/BacktestLegCard.tsx`
- Modify: `src/components/PortfolioBacktestBuilder.tsx`
- Modify: `src/components/backtest-results/ActiveBacktestPortfolio.tsx`
- Modify: `src/lib/i18n/dictionary.ts`
- Test: corresponding `*.test.ts` and `*.test.tsx` files.

**Interfaces:**
- Catalog items expose `adjustmentPolicies`, quality warnings, missing-bar count, and survivorship warning.
- Run/leg responses expose immutable manifest provenance.

- [ ] Write failing API/client/component tests for RAW/TOTAL RETURN labels and disabled adjusted selection.
- [ ] Enrich catalog and run response queries without weakening current eligibility gates.
- [ ] Render bilingual labels and warnings in builder and results.
- [ ] Run targeted tests and commit.

### Task 6: Run cancellation, timeout, cache, and concurrency

**Files:**
- Modify: `prisma/schema.prisma` and add a migration.
- Modify: `src/lib/backend/quant-runs.ts`
- Modify: `src/app/api/quant/runs/[id]/route.ts`
- Modify: `src/lib/backtest/client.ts`
- Modify: `src/components/BacktestWorkbench.tsx`
- Modify: `quant-worker/worker.py`
- Test: `src/lib/backend/quant-runs.test.ts`
- Test: `quant-worker/tests/test_worker.py`
- Create: `quant-worker/tests/test_worker_concurrency_integration.py`

**Interfaces:**
- `cancelPortfolioQuantRun(context, id)` is tenant scoped.
- Submission response includes `cacheHit` and `sourceRunId` when reused.
- Worker supports `cancel_requested/cancelled/timed_out` and lease renewal.

- [ ] Write failing lifecycle, cache isolation, progress monotonicity, and stale lease tests.
- [ ] Add schema/API/client/UI statuses and a Cancel button.
- [ ] Add cooperative worker cancellation, lease heartbeat, bounded recovery, and cache reuse.
- [ ] Run real PostgreSQL 20- and 50-claimer integration tests and retain summarized evidence.
- [ ] Commit lifecycle work.

### Task 7: Complete Backtest → Mock Portfolio workflow

**Files:**
- Modify: `src/components/backtest-results/BacktestAdvancedAnalysis.tsx`
- Modify: `src/lib/backend/strategy-forward-tests.ts`
- Modify: `src/components/PortfolioStrategyForwardTests.tsx`
- Modify: `src/components/StrategyAssignmentPanel.tsx`
- Test: corresponding frontend/backend tests.

**Interfaces:**
- Apply is enabled only for succeeded eligible legs.
- Forward response includes source backtest reference and comparison metrics.
- Suggested signals support review, dismiss, or transaction execution.

- [ ] Add failing tests for eligible apply, rejected stale source, comparison metrics, reviewed/dismissed status, and executed transaction provenance.
- [ ] Implement missing response fields and signal actions using existing tenant-scoped routes.
- [ ] Verify Equity/Drawdown/KPI/Trade List artifacts and apply a real completed run locally.
- [ ] Commit the end-to-end workflow.

### Task 8: Ingestion production operations and dashboard

**Files:**
- Modify: `scripts/run-market-ingestion.ps1`
- Create: `scripts/verify-market-ingestion.ps1`
- Create: `deploy/windows/quant-ingestion-tasks.xml`
- Modify: `src/lib/backend/types.ts`
- Modify: `src/lib/market-data/health.ts`
- Modify: `src/components/MarketDataHealthPanel.tsx`
- Test: ingestion CLI, repository, health, and component tests.

**Interfaces:**
- Health exposes stale/missing counts, backlog oldest age, provider failures, and scheduler success.
- Scheduler template invokes one hourly and one daily wrapper without duplicate services.

- [ ] Write failing health aggregation and retry-idempotency tests.
- [ ] Add scheduler-run persistence and health fields.
- [ ] Add guarded retry and post-run verification to the wrapper.
- [ ] Add bilingual health warnings/dashboard details.
- [ ] Import the task template only in an explicitly selected deployment environment; verify locally without registering duplicate tasks.
- [ ] Commit operational delivery.

### Task 9: Robustness and forward-testing completion audit

**Files:**
- Modify: `quant-worker/backtest/robustness.py`
- Modify: `quant-worker/worker.py`
- Modify: `src/lib/backtest/result-model.ts`
- Modify: `src/components/backtest-results/BacktestAdvancedAnalysis.tsx`
- Modify: signal evaluation/forward-test files where audit finds missing behavior.
- Test: robustness, worker, result-model, evaluator, and forward-test tests.

**Interfaces:**
- Robustness artifact distinguishes diagnostic holdout from fitted walk-forward and exposes warnings.
- Evaluation remains exactly once per assignment/dataset and signal deduplication is enforced.

- [ ] Audit each P1 requirement against runtime behavior, not names alone.
- [ ] Write failing tests for uncovered behavior, especially fold leakage, invalid neighbours, fragile warnings, evaluation retries, and duplicate signals.
- [ ] Implement only evidenced gaps and update bilingual explanations.
- [ ] Run targeted and full suites, then commit.

### Task 10: Final production-readiness evidence

**Files:**
- Modify: `README.md`
- Create: `docs/verification/2026-08-14-quant-production-readiness.md`

**Interfaces:**
- Verification document maps every requested requirement to source, test, DB, and runtime evidence.

- [ ] Run migrations against the isolated integration database and preservation/tenant tests.
- [ ] Run all Python tests, Vitest, TypeScript, lint on changed files, and production build.
- [ ] Run real DB coverage, adjusted-run, apply, signal, scheduler-health, and concurrency probes.
- [ ] Record exact evidence and unresolved provider/license limitations.
- [ ] Commit intended files, restart canonical local launcher, verify HTTP 200 on 3100 and health on 8100.
