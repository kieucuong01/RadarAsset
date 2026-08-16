# Decision Cockpit 80/20 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a trustworthy daily price-to-opinion-to-portfolio-change loop without expanding the product surface.

**Architecture:** A shared demand-scoped daily universe controls ingestion and readiness. The existing fail-closed PowerShell runner is the single scheduled entrypoint. Immutable opinion evaluations and deterministic briefing deltas are exposed through bounded read models.

**Tech Stack:** Python 3.11/psycopg, PostgreSQL/Prisma, PowerShell Scheduled Tasks, Next.js 16, TypeScript, Zod, React/shadcn, Vitest, pytest, Playwright.

## Global Constraints

- Execute Tasks 1 through 4 in order; do not start a later task before the prior task's focused gate passes.
- No `1h` queueing or readiness requirement; retain historical rows.
- No full-HOSE pre-ingestion, U.S. equities, new sources/crawlers, WorldMonitor decision inputs, admin UI, Kronos decision use, chatbot, or additional AI prose.
- DeepSeek remains explanation-only and all deterministic calculations must work when it is unavailable.
- Preserve immutable provider artifacts, observations, datasets, briefings, and signals.

---

### Task 1: Demand-scoped daily market data

**Files:**

- Create: `quant-worker/backtest/daily_scope.py`
- Create: `quant-worker/tests/test_daily_scope.py`
- Modify: `quant-worker/sync_provider_instruments.py`
- Modify: `quant-worker/verify_market_ingestion.py`
- Modify: `quant-worker/tests/test_sync_provider_instruments.py`
- Modify: `quant-worker/tests/test_market_ingestion_operations.py`
- Modify: `scripts/refresh-asset-opinions.ps1`
- Modify: `docs/operations/smart-insights-runbook.md`

**Interfaces:**

- Produces: `load_daily_scope_symbols(connection) -> tuple[str, ...]`.
- Produces: `queue_market_ingestion_requests(..., allowed_symbols: Sequence[str] | None = None) -> int`.
- Produces: `load_health(connection, allowed_symbols: Sequence[str] | None = None) -> dict[str, Any]`.
- Consumes: existing `FEEDS`, `portfolio_positions`, `watchlist_items`, active provider instruments, raw/adjusted dataset publication.

- [ ] **Step 1: Write failing scope tests**

  Add literal fixtures proving the resolver includes curated, held, and watched supported assets; excludes inactive instruments, U.S. assets, and unrelated HOSE symbols; returns stable uppercase order.

- [ ] **Step 2: Verify RED**

  Run: `.\.venv\Scripts\python.exe -m pytest quant-worker/tests/test_daily_scope.py quant-worker/tests/test_sync_provider_instruments.py quant-worker/tests/test_market_ingestion_operations.py -q`

  Expected: failure because the daily scope resolver and scoped queue/readiness arguments do not exist.

- [ ] **Step 3: Implement the shared daily scope and scoped queue**

  Resolve curated `FEEDS` plus held/watched assets with active approved provider instruments. Queue only `1d` candidates inside that scope. Do not delete historical `1h` datasets.

- [ ] **Step 4: Make readiness use the identical scope**

  Change `HEALTH_SQL` to accept the resolved symbols and expect only raw `1d` datasets. Make out-of-scope retirement fail pending/running requests that are outside the resolved symbols or are not `1d`.

- [ ] **Step 5: Replace the hard-coded direct-ingestion loop**

  Make `refresh-asset-opinions.ps1` invoke `run-market-ingestion.ps1 -Command daily -DrainRequests`; retain corporate-action and adjusted-publication stages already owned by that wrapper.

- [ ] **Step 6: Verify GREEN and live convergence**

  Run the focused pytest files, dry-run the daily wrapper, run the scoped daily ingestion against `.env.local`, then execute `report_market_data_quality.py` and `verify_market_ingestion.py`. The readiness output must no longer count `1h` or unrelated HOSE datasets.

- [ ] **Step 7: Commit**

  Commit message: `feat: scope market readiness to daily decision assets`.

### Task 2: Automated fail-closed daily pipeline

**Files:**

- Create: `quant-worker/verify_daily_pipeline.py`
- Create: `quant-worker/tests/test_verify_daily_pipeline.py`
- Modify: `scripts/refresh-asset-opinions.ps1`
- Modify: `deploy/windows/install-quant-ingestion-tasks.ps1`
- Modify: `deploy/windows/quant-ingestion-tasks.xml`
- Modify: `docs/operations/smart-insights-runbook.md`

**Interfaces:**

- Produces: `load_daily_pipeline_health(connection, local_date, timezone_name) -> dict[str, Any]`.
- Produces: CLI JSON with `status`, market scheduler evidence, briefing evidence, and stable failure codes.
- Consumes: the scoped daily market-data gate from Task 1 and existing Smart Insights/calendar/briefing runners.

- [ ] **Step 1: Write failing orchestration and verifier tests**

  Prove failure stops later stages, successful stages run exactly once in order, verifier rejects stale/missing daily runs, and Scheduled Task verification checks action path plus last result rather than task-name presence only.

- [ ] **Step 2: Verify RED**

  Run: `.\.venv\Scripts\python.exe -m pytest quant-worker/tests/test_verify_daily_pipeline.py -q` and the focused PowerShell contract tests in the repository test command.

- [ ] **Step 3: Implement the daily verifier and harden the wrapper**

  Emit bounded machine-readable evidence. Preserve the one daily task at 08:15 Asia/Bangkok and the existing four-hourly/weekly jobs; do not create an intraday market-price job.

- [ ] **Step 4: Verify and install locally**

  Run installer `-Verify`; if absent, install with the configured service tenant and then verify task action, trigger, state, and last result. Run the daily pipeline once and verify HTTP/runtime health separately.

- [ ] **Step 5: Commit**

  Commit message: `feat: automate the daily decision pipeline`.

### Task 3: Historical asset-opinion evaluation

**Files:**

- Create: `prisma/migrations/202608160001_asset_opinion_evaluations/migration.sql`
- Modify: `prisma/schema.prisma`
- Create: `quant-worker/smart_insights/opinion_evaluation.py`
- Create: `quant-worker/evaluate_asset_opinions.py`
- Create: `quant-worker/tests/test_opinion_evaluation.py`
- Create: `quant-worker/tests/test_opinion_evaluation_integration.py`
- Modify: `scripts/refresh-asset-opinions.ps1`
- Modify: `src/lib/backend/smart-insights-types.ts`
- Modify: `src/lib/backend/smart-insights.ts`
- Modify: `src/lib/backend/smart-insights.test.ts`
- Modify: `src/lib/smart-insights-client.ts`
- Modify: `src/components/smart-insights/AssetOpinionModalContent.tsx`
- Modify: related component/client tests and Vietnamese/English dictionaries.

**Interfaces:**

- Produces: immutable evaluation rows keyed by `(signal_snapshot_id, horizon_sessions)` for horizons `1`, `5`, and `20`.
- Produces: `AssetOpinionPerformanceReadModel` with bounded `sampleSize`, `hitRate`, `averageReturn`, `averageExcessReturn`, and `status`.
- Consumes: eligible daily price versions, `asset_opinion` signal snapshots, and benchmark mapping `stock_vn/equity -> VNINDEX`, `crypto -> BTC`, `gold -> XAU`.

- [ ] **Step 1: Write failing pure evaluator tests**

  Cover next-session entry, 1/5/20-session targets, positive and negative correctness, neutral exclusion, insufficient-data exclusion, benchmark excess return, and no look-ahead when the target bar has not closed.

- [ ] **Step 2: Verify RED**

  Run: `.\.venv\Scripts\python.exe -m pytest quant-worker/tests/test_opinion_evaluation.py -q`.

- [ ] **Step 3: Add migration, repository, and CLI**

  Store immutable point-in-time fields and idempotently fill pending evaluations. Use adjusted `1d` for VN when eligible and raw `1d` for crypto/XAU. Never synthesize missing bars or returns.

- [ ] **Step 4: Add aggregate read model tests, then implementation**

  First make backend/client/component tests fail on the missing performance object. Add one bounded aggregate query for all current opinion assets and display the scorecard inside the existing asset detail modal; do not create an admin dashboard.

- [ ] **Step 5: Add evaluation to the daily runner**

  Run mature-opinion evaluation after daily market data and before publication of the new briefing. Evaluation failure must stop the briefing rather than publish misleading performance.

- [ ] **Step 6: Apply migration and verify GREEN**

  Apply Prisma migration, run focused Python/PostgreSQL/TypeScript/component tests, execute the evaluator twice to prove idempotency, and read back bounded aggregates.

- [ ] **Step 7: Commit**

  Commit message: `feat: measure realized asset opinion performance`.

### Task 4: Three-item portfolio change briefing

**Files:**

- Create: `src/lib/asset-opinion-changes.ts`
- Create: `src/lib/asset-opinion-changes.test.ts`
- Modify: `src/lib/backend/smart-insights-types.ts`
- Modify: `src/lib/backend/smart-insights.ts`
- Modify: `src/lib/backend/smart-insights.test.ts`
- Modify: `src/lib/smart-insights-client.ts`
- Create: `src/components/smart-insights/PortfolioChangeDigest.tsx`
- Create: `src/components/smart-insights/PortfolioChangeDigest.test.tsx`
- Modify: `src/components/SmartInsights.tsx`
- Modify: Vietnamese/English Smart Insights dictionaries and E2E fixtures/tests.

**Interfaces:**

- Produces: `derivePortfolioOpinionChanges(current, previous, limit = 3) -> PortfolioOpinionChange[]`.
- Produces: briefing field `portfolioChanges` with at most three deterministic records.
- Consumes: latest current briefing, latest earlier tenant/user briefing, current portfolio weights, stance/action/score, and bounded current evidence.

- [ ] **Step 1: Write failing ranking tests**

  Hand-check fixtures proving held assets outrank watchlist-only assets, stance/action changes outrank score-only changes, score deltas are absolute and numeric, unchanged assets are absent, defaults are bounded, and no previous briefing produces an accumulating state.

- [ ] **Step 2: Verify RED**

  Run: `npm test -- src/lib/asset-opinion-changes.test.ts src/lib/backend/smart-insights.test.ts src/components/smart-insights/PortfolioChangeDigest.test.tsx`.

- [ ] **Step 3: Implement deterministic backend comparison**

  Load one earlier briefing in the existing tenant-scoped backend query path, derive at most three changes, attach the strongest current decision input as evidence, and add strict Zod validation. Do not call DeepSeek.

- [ ] **Step 4: Implement the compact user card**

  Place the card before the asset-opinion workspace. Each item states what changed, portfolio impact, the strongest numeric reason, and links to the existing asset analysis modal. The empty state explains that comparison begins after another daily briefing.

- [ ] **Step 5: Verify GREEN and browser behavior**

  Run focused tests and Smart Insights desktop/mobile E2E. Confirm no horizontal overflow, row/card activation opens the existing analysis modal, and the section never displays more than three items.

- [ ] **Step 6: Commit**

  Commit message: `feat: add portfolio opinion change briefing`.

### Task 5: Release verification and local handoff

**Files:**

- Modify only verification documentation if observed evidence differs from the runbook.

- [ ] **Step 1: Run full gates**

  Run Prisma validation/status, formatting, lint, TypeScript, full Vitest, full pytest with writable temp base, production build, focused PostgreSQL integration, and Smart Insights/Portfolio/Quant E2E.

- [ ] **Step 2: Run live operational gates**

  Run the scoped daily pipeline, daily verifier, market quality/readiness reports, opinion evaluator, authenticated API smoke, and Scheduled Task verification. Record actual counts and failures without converting unavailable data into sample values.

- [ ] **Step 3: Restart local and QA**

  Verify listeners and HTTP responses, then inspect Smart Insights and Portfolio in a real browser at desktop and mobile widths with application console logs filtered separately from extension noise.

- [ ] **Step 4: Finish branch**

  Confirm clean Git state and present the verified local commits. Push/merge only when explicitly requested.
