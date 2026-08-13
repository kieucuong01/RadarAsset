# Quant Data and Strategy Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Productionize Quant ingestion and adjusted VN data, finish Quant VI/EN encoding, and connect Strategy Lab to the existing tenant-scoped immutable strategy database.

**Architecture:** Extend the current PostgreSQL-backed scheduler/readiness contracts and Python corporate-action publication pipeline. Keep `dictionary.ts` as the only Quant copy source and replace Strategy Lab local persistence with a small typed API client over the existing CustomStrategy services and routes.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod, Prisma/PostgreSQL, Python 3.12, psycopg, Vitest, pytest, PowerShell Task Scheduler.

## Global Constraints

- Free providers remain the MVP source; provider gaps are disclosed and never fabricated.
- Raw dataset versions and historical strategy versions are immutable.
- Adjusted datasets require complete, range-containing, verified corporate-action coverage.
- Tenant strategy mutations require editor capability and remain organization-scoped.
- Quant UI copy is bilingual VI/EN and valid UTF-8.
- Use no new runtime dependency.
- Canonical local runtime is web `3100` plus engine `8100` via `scripts/dev-local.mjs`.

---

### Task 1: Make ingestion scheduler state and health production-grade

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608140003_ingestion_scheduler_observability/migration.sql`
- Modify: `quant-worker/verify_market_ingestion.py`
- Modify: `quant-worker/process_ingestion_requests.py`
- Modify: `scripts/run-market-ingestion.ps1`
- Modify: `deploy/windows/install-quant-ingestion-tasks.ps1`
- Modify: `src/lib/backend/types.ts`
- Modify: `src/lib/backend/quant-assets.ts`
- Modify: `src/lib/backtest/data-readiness-client.ts`
- Modify: `src/components/MarketDataHealthPanel.tsx`
- Test: `quant-worker/tests/test_market_ingestion_operations.py`
- Test: `quant-worker/tests/test_ingestion_requests.py`
- Test: `src/lib/backend/quant-assets.test.ts`
- Test: `src/lib/backtest/data-readiness-client.test.ts`

**Interfaces:**
- Produces: `SchedulerRunSummary`, latest scheduler terminal status, provider failures grouped by provider/error, and strict `readyForBacktest` operations health.
- Consumes: existing request lease/retry repository and `calculateFreshness()`.

- [ ] **Step 1: Write scheduler lifecycle tests**

  Add tests proving `start_scheduler_run()` recovers abandoned rows, rejects or reuses an active same-command run, and `finish_scheduler_run()` stores queued/retried/processed/failed counts plus an error code.

- [ ] **Step 2: Run the Python scheduler tests and verify RED**

  Run: `$env:PYTHONPATH='quant-worker'; .\.venv\Scripts\python.exe -m pytest quant-worker/tests/test_market_ingestion_operations.py -q`

  Expected: failures for missing duplicate-command protection and count persistence.

- [ ] **Step 3: Add scheduler observability migration and repository behavior**

  Add a partial unique index for one `running` row per command, preserve count columns, and implement start/finish functions returning structured JSON. A unique conflict loads the active row and exits with an explicit `already_running` result rather than scheduling duplicate work.

- [ ] **Step 4: Add wrapper outcome propagation**

  Make `run-market-ingestion.ps1` parse queue/worker JSON summaries, accumulate counts, store them during finish, skip adjusted publication when corporate-action sync fails, and retain top-level `finally` terminalization.

- [ ] **Step 5: Add stale lease recovery regression test**

  Prove requests at maximum attempts become terminal `failed`, active leases are not reclaimed early, and delayed retries are drained only within the configured maximum total.

- [ ] **Step 6: Extend readiness tests and verify RED**

  Assert `QuantDataReadinessResponse` contains `latestSchedulerRun` and `recentProviderFailures[].errorCode`, and that `readyForBacktest=false` for stale/missing/over-age/no-recent-scheduler conditions.

- [ ] **Step 7: Implement the readiness contract and bilingual health presentation**

  Aggregate scheduler state and provider/error counts in `loadQuantDataReadiness()`, update Zod/client types, and render healthy/degraded/failed states with exact counts in `MarketDataHealthPanel`.

- [ ] **Step 8: Verify Windows deployment artifacts**

  Extend installer tests to prove exactly two tasks, restart-on-failure settings, absolute repository path arguments, and a non-mutating verification mode.

- [ ] **Step 9: Run Task 1 verification**

  Run targeted Python and Vitest suites, Prisma validate, PowerShell parser check, and `scripts/verify-market-ingestion.ps1` against local DB.

- [ ] **Step 10: Commit Task 1**

  Commit message: `feat: harden quant ingestion operations`

### Task 2: Complete safe VN corporate-action adjustment

**Files:**
- Modify: `quant-worker/backtest/corporate_actions.py`
- Modify: `quant-worker/backtest/adjustments.py`
- Modify: `quant-worker/backtest/adjusted_publication.py`
- Modify: `quant-worker/sync_corporate_actions.py`
- Modify: `quant-worker/publish_adjusted_datasets.py`
- Test: `quant-worker/tests/test_corporate_action_adapter.py`
- Test: `quant-worker/tests/test_adjustments.py`
- Test: `quant-worker/tests/test_adjusted_publication.py`
- Test: `quant-worker/tests/test_publish_adjusted_datasets.py`

**Interfaces:**
- Produces: verified `CorporateActionRecord`, separate price/quantity factors, and eligible immutable `total_return` publication.
- Consumes: raw `ActiveSnapshot`, VCI event payloads, HOSE market-date conversion.

- [ ] **Step 1: Add real-payload normalization fixtures and RED tests**

  Cover Vietnamese/English cash dividend, stock dividend/bonus, split, rights issue, symbol change, missing ex-date, missing ratio/price, percent-style ratios, and unknown ISS labels.

- [ ] **Step 2: Run adapter tests and verify RED**

  Run: `$env:PYTHONPATH='quant-worker'; .\.venv\Scripts\python.exe -m pytest quant-worker/tests/test_corporate_action_adapter.py -q`

  Expected: failures for uncovered labels/ratio forms.

- [ ] **Step 3: Implement minimal canonical parsing**

  Normalize camel/snake keys, percentage ratios to decimal share ratios, price units to stored VND values, and leave ambiguous events unverified with their source payload.

- [ ] **Step 4: Add adjustment golden cases and verify RED**

  Add literal expected values for cash-only volume invariance, combined stock/rights quantity factor, same-date events, pre-first-bar action, and future action exclusion.

- [ ] **Step 5: Implement/refine Decimal factor application**

  Combine events per ex-date, select the last prior HOSE bar once, apply price and quantity cumulative factors separately, and avoid float conversion.

- [ ] **Step 6: Add publication eligibility and lineage tests**

  Prove incomplete or stale coverage deactivates adjusted versions, verified coverage publishes raw version/action checksums/range/calendar/value scale, and raw rows/checksum remain unchanged.

- [ ] **Step 7: Implement publisher summary and block reasons**

  Return counts for `published`, `unchanged`, and blocked categories (`coverage`, `unverified`, `quality`) so the scheduler and dashboard can disclose why adjusted data is absent.

- [ ] **Step 8: Run Task 2 verification and DB smoke**

  Run all corporate-action/adjustment tests, then execute the publisher for FPT. Query active raw/total-return versions and confirm unsafe versions are inactive without deleting history.

- [ ] **Step 9: Commit Task 2**

  Commit message: `feat: complete safe vn adjusted datasets`

### Task 4: Remove Quant mojibake and complete VI/EN coverage

**Files:**
- Modify: `src/lib/i18n/dictionary.ts`
- Modify: `src/lib/i18n/dictionary.test.ts`
- Create: `src/lib/i18n/quant-copy.test.ts`
- Modify: `src/components/QuantLab.tsx`
- Modify: `src/components/MarketDataHealthPanel.tsx`
- Modify: `src/components/PortfolioOptimizerWorkbench.tsx`
- Modify: `src/components/StrategyLab.tsx`
- Modify: `src/components/FactorLab.tsx`
- Modify: `src/components/BacktestWorkbench.tsx`
- Modify: `src/components/PortfolioBacktestBuilder.tsx`
- Modify: `src/components/backtest-results/*.tsx`
- Modify: `src/components/PortfolioStrategyForwardTests.tsx`
- Modify: `src/components/StrategyAssignmentPanel.tsx`
- Test: relevant component tests under `src/components/**/*.test.tsx`

**Interfaces:**
- Produces: dictionary-only Quant copy and `assertNoQuantMojibake(source)` test helper.
- Consumes: existing `useI18n()` and locale provider.

- [ ] **Step 1: Write dictionary parity and mojibake scan tests**

  Recursively scan Quant-owned TS/TSX source for `Ã`, `Â`, `áº`, `á»`, and `�`; assert VI/EN dictionary key parity and representative translated keys.

- [ ] **Step 2: Run i18n tests and verify RED**

  Run: `npm test -- --run src/lib/i18n/dictionary.test.ts src/lib/i18n/quant-copy.test.ts`

  Expected: failures on current malformed Strategy Lab/Optimizer/health text and missing dictionary keys.

- [ ] **Step 3: Replace malformed and hard-coded Quant copy**

  Move labels, empty/error/toast/status text, chart/table headings, aria labels, and separators into the two dictionaries. Preserve identifiers and provider names.

- [ ] **Step 4: Make formatting locale-aware**

  Pass the active locale to `Intl.DateTimeFormat`/`Intl.NumberFormat`; ensure already-mounted health, optimizer, strategy, backtest, factor, and forward components re-render on locale change.

- [ ] **Step 5: Add bilingual component render tests**

  Render representative components under `vi` and `en`; assert visible titles and state messages differ while strategy symbols/codes remain unchanged.

- [ ] **Step 6: Run Task 4 verification**

  Run all i18n/component tests, ESLint on touched files, TypeScript, and a browser toggle smoke at `/quant-lab`.

- [ ] **Step 7: Commit Task 4**

  Commit message: `fix: complete quant localization`

### Task 5: Connect Strategy Lab to immutable tenant DB versions

**Files:**
- Modify: `src/lib/custom-strategies/contracts.ts`
- Modify: `src/lib/backend/custom-strategies.ts`
- Create: `src/lib/strategy-lab/client.ts`
- Create: `src/lib/strategy-lab/client.test.ts`
- Create: `src/lib/strategy-lab/legacy-migration.ts`
- Create: `src/lib/strategy-lab/legacy-migration.test.ts`
- Modify: `src/components/StrategyLab.tsx`
- Modify: `src/components/StrategyLab.test.tsx`
- Modify: `src/app/api/quant/custom-strategies/route.ts`
- Modify: `src/app/api/quant/custom-strategies/[id]/versions/route.ts`
- Modify: `src/app/api/quant/custom-strategies/[id]/route.ts`
- Test: `src/lib/backend/custom-strategies.test.ts`
- Test: `src/app/api/tenant-routes.test.ts`

**Interfaces:**
- Produces: `listCustomStrategies()`, `createCustomStrategy()`, `createCustomStrategyVersion()`, `archiveCustomStrategy()` client functions and one-time `migrateLegacyStrategies()`.
- Consumes: existing tenant APIs, `CustomStrategySummary`, DCA and price-threshold executable rule schemas.

- [ ] **Step 1: Write typed client schema tests and verify RED**

  Assert list/create/version/archive request methods, response validation, cache-disabled reads, JSON headers, and sanitized API errors.

- [ ] **Step 2: Implement the minimal Strategy Lab API client**

  Define Zod response schemas matching `CustomStrategySummary`, expose typed operations, and keep fetch injection for tests.

- [ ] **Step 3: Add duplicate/idempotency service tests and verify RED**

  Submit identical tenant/name/rule input twice and expect one active version. Submit the same version payload twice and expect the existing latest version rather than a duplicate immutable row.

- [ ] **Step 4: Implement transactional fingerprint guards**

  Use tenant-scoped transaction advisory locks and latest-version hash comparison. Different rule hashes create the next patch version; identical hashes reuse the current version.

- [ ] **Step 5: Write legacy migration tests and verify RED**

  Partition parsed local strategies into executable DCA/price rules and unsupported catalog/fundamental records. Import executable records sequentially, remove storage only when every executable import succeeds, and return imported/skipped/failed counts.

- [ ] **Step 6: Implement one-time legacy migration**

  Keep local data on any failure; after success, remove `radarasset.strategy-lab.v1` and set a versioned migration marker. Never send fundamental rules to the executable API.

- [ ] **Step 7: Replace Strategy Lab local state with API state**

  Load tenant strategies on mount, save DCA/price rules through POST, create new immutable versions through the version route, archive through DELETE, render loading/error/empty/archive state, and send a selected execution code/version to Backtest.

- [ ] **Step 8: Keep catalog and fundamental behavior explicit**

  Catalog presets continue to go directly to Backtest without tenant persistence. Fundamental drafts display unavailable status and cannot call create/version APIs.

- [ ] **Step 9: Run service, route, client, migration, and component verification**

  Run targeted Vitest, then a PostgreSQL tenant integration test proving organization isolation and immutable versions.

- [ ] **Step 10: Commit Task 5**

  Commit message: `feat: persist strategy lab versions`

### Task 6: End-to-end verification and delivery

**Files:**
- Modify only defects revealed by verification.
- Update: `README.md`
- Update: `quant-worker/README.md`

**Interfaces:**
- Consumes all four completed workstreams.
- Produces delivery evidence for local `main` and `origin/main`.

- [ ] **Step 1: Run complete automated verification**

  Run `npm test -- --run`, full Python pytest with temp directory outside the repo, `npx tsc --noEmit`, Prisma validate/status, PowerShell parser, `npm run build`, and `git diff --check`.

- [ ] **Step 2: Run operational DB smokes**

  Execute ingestion verifier, adjusted publisher for an eligible VN symbol, and aggregate DB queries for scheduler status, raw/adjusted active versions, custom strategies, and strategy versions.

- [ ] **Step 3: Run authenticated browser smoke when credentials are safely available**

  Verify VI/EN toggle, create/version/archive a DCA or price rule, select the exact version in Backtest, and verify health state. If credentials are unavailable, report the authenticated browser evidence as unverified rather than fabricating it.

- [ ] **Step 4: Update operations documentation**

  Document scheduler install/verify, readiness meanings, adjusted block reasons, and legacy Strategy Lab migration.

- [ ] **Step 5: Final review, merge/push, and restart local**

  Commit verification fixes/docs, push `main`, restart `scripts/dev-local.mjs`, and verify HTTP 200 on ports 3100/8100.
