# VN-Only Intelligence Data Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the missing Macro, Gold, weekly fund-flow, and qualified BTC large-address inputs while permanently removing unsupported foreign equities and ETFs.

**Architecture:** Keep the existing collector, artifact, publication, derived-metric, and asset-opinion boundaries. Add a keyless official FRED fallback, enable each source only after live-smoke, keep scheduler scope curated, and enforce VN-only equity support at both database and application boundaries. Perform permanent data removal through one idempotent, set-based transaction after a read-only dry-run.

**Tech Stack:** Python 3.11, psycopg 3, Scrapling/RapidOCR, Next.js 16, TypeScript, Prisma, PowerShell Task Scheduler, pytest, Vitest.

## Global Constraints

- Supported markets are `vn_equity`, `crypto_spot`, and `metal_spot`; the only supported equity market is Vietnam.
- `VNINDEX` and `VN30` remain supported Vietnamese indices.
- XMR and every foreign equity or ETF are removed from product scope.
- No unavailable upstream value may become zero, seed data, or synthetic decision evidence.
- A source is enabled only after its real production collector passes bounded live-smoke.
- Opinion loading stays bounded to 25 assets, 260 bars per symbol, and the decision-metric allow-list.
- Database purge defaults to dry-run and mutates only with `--apply` in one transaction.

---

### Task 1: Official FRED collection without a mandatory API key

**Files:**
- Modify: `quant-worker/smart_insights/collectors/fred.py`
- Modify: `quant-worker/smart_insights/sources.py`
- Modify: `quant-worker/collect_smart_insights.py`
- Test: `quant-worker/tests/test_smart_insights_macro_collectors.py`
- Test: `quant-worker/tests/test_smart_insights_foundation.py`

**Interfaces:**
- Consumes: `FredSeriesDefinition`, `CollectionBatch`, `UrllibTransport`.
- Produces: `FredCollector(api_key: str | None, ...)` whose `collect()` selects JSON API when keyed and official `fredgraph.csv` otherwise.

- [ ] Write a failing collector test that passes `api_key=None`, returns bounded FRED CSV with `DATE,<series_id>` columns, and expects validated observations with the same metric contract as JSON.
- [ ] Run `pytest tests/test_smart_insights_macro_collectors.py -k fred -q` and verify failure because the current constructor requires a key.
- [ ] Implement strict CSV parsing: allow-listed series only, exact header, unique in-range ISO dates, `.` rows skipped, finite decimals only, maximum source row count, and official source URL attribution.
- [ ] Add the official CSV URL to the FRED source allow-list and make `collect_smart_insights.py` pass an optional key.
- [ ] Run the focused tests and commit `feat: add keyless official FRED collection`.

### Task 2: Enable FRED, CFTC Gold, and CoinShares only after live-smoke

**Files:**
- Modify: `quant-worker/smart_insights/sources.py`
- Modify: `quant-worker/tests/test_smart_insights_foundation.py`
- Modify: `docs/operations/smart-insights-runbook.md`

**Interfaces:**
- Consumes: `select_sources(schedule, source_code=..., include_disabled=True)` and existing `--live-smoke` CLI.
- Produces: enabled source definitions for `fred`, `cftc-disaggregated`, and `coinshares-weekly` only when current-turn live evidence succeeds.

- [ ] Update the enabled-source expectation test first and run it to verify RED while the three codes remain disabled.
- [ ] Run bounded live-smoke for `fred`, `cftc-disaggregated`, and `coinshares-weekly` separately while disabled.
- [ ] For any failed smoke, fix its production parser using a new failing fixture/contract test, rerun focused tests, then rerun live-smoke; never enable a failed source.
- [ ] Add only successful codes to `ENABLED_SOURCE_CODES`, document cadence and failure behavior, run foundation plus collector tests, and commit `feat: enable validated macro and fund flow sources`.

### Task 3: Qualified BTC large-address pressure in the quant ledger

**Files:**
- Modify: `quant-worker/smart_insights/asset_opinion_rules.py`
- Modify: `quant-worker/smart_insights/asset_opinion_repository.py`
- Modify: `quant-worker/smart_insights/large_address_metrics.py`
- Test: `quant-worker/tests/test_asset_opinion_quant.py`
- Test: `quant-worker/tests/test_asset_opinion_repository.py`
- Test: `quant-worker/tests/test_smart_insights_large_address_metrics.py`

**Interfaces:**
- Consumes: `crypto.large_address.exchange_flow_pressure_btc` and existing address/transaction/label coverage metrics.
- Produces: one BTC-only `DecisionInput` in `sentiment_onchain` with weight `0.10`; positive pressure normalizes bearish and negative pressure bullish.

- [ ] Write failing tests proving eligible pressure changes BTC score, never appears for altcoins, and insufficient coverage leaves the metric unavailable.
- [ ] Run the focused tests and confirm RED because the metric currently has no `InputRule`.
- [ ] Add the BTC-only rule and rebalance sentiment/on-chain subweights from `0.60/0.15/0.15/0.10` to `0.55/0.10/0.15/0.10/0.10` including whale pressure, leaving the pillar weight unchanged.
- [ ] Ensure the derived observation is emitted only when all existing coverage gates pass; run tests and commit `feat: score qualified BTC large address pressure`.

### Task 4: Curated scheduler and retired-scope backlog handling

**Files:**
- Modify: `scripts/refresh-asset-opinions.ps1`
- Modify: `deploy/windows/install-quant-ingestion-tasks.ps1`
- Modify: `deploy/windows/quant-ingestion-tasks.xml`
- Modify: `quant-worker/verify_market_ingestion.py`
- Modify: `quant-worker/tests/test_market_ingestion_operations.py`
- Modify: `quant-worker/backtest/catalog.py`

**Interfaces:**
- Consumes: curated symbols, Smart Insights `daily`, `four-hourly`, `weekly`, `calendar-current`, and `briefing` schedules.
- Produces: bounded daily/four-hourly/weekly task commands and `retire_out_of_scope_requests(connection, allowed_symbols)` audit-preserving backlog cleanup.

- [ ] Write failing tests asserting XMR is absent, VN30 is present, no full-catalog command exists, daily includes calendar and briefing, and scheduled four-hourly/weekly collectors are reachable.
- [ ] Add a failing repository test that active requests outside the supported symbol/market scope become `failed` with `SCOPE_RETIRED`, while allowed requests are untouched.
- [ ] Implement the minimum PowerShell/task changes and one set-based SQL update for retired requests.
- [ ] Parse both PowerShell files, run operations/catalog tests, and commit `fix: bound intelligence refresh to supported markets`.

### Task 5: VN-only equity boundaries and permanent purge command

**Files:**
- Create: `quant-worker/purge_unsupported_equities.py`
- Create: `quant-worker/tests/test_purge_unsupported_equities.py`
- Modify: `src/lib/backend/db.ts`
- Modify: `src/lib/backend/portfolio.ts`
- Modify: `src/lib/backend/quant-assets.ts`
- Modify: `src/app/api/portfolio/transactions/route.test.ts`
- Modify: `src/lib/backend/portfolio.test.ts`
- Modify: `src/lib/backend/quant-assets.test.ts`
- Modify: `prisma/seed.ts`
- Modify: `scripts/seed-quant-e2e.ts`

**Interfaces:**
- Consumes: assets classified as equity/ETF outside `vn_equity` and their database dependencies.
- Produces: `discover_unsupported_assets(connection)`, `purge_unsupported_equities(connection, apply=False)`, API filters/rejections, and Vietnamese-only seeds.

- [ ] Write failing Python tests for dry-run counts, apply deletion order, idempotency, and rollback on an unexpected dependency.
- [ ] Write failing TypeScript tests proving portfolio transactions reject foreign equities and asset/quant selectors omit them while retaining VNINDEX/VN30/Vietnamese equities, Crypto, and XAU.
- [ ] Implement set-based dependency deletion and final asset deletion in one transaction; default CLI output is JSON dry-run and `--apply` is required to commit.
- [ ] Remove SPY, QQQ, NVDA, and TSLA from seeds/fixtures and replace any required scenario with FPT, VCB, HPG, or VN30.
- [ ] Run focused Python and frontend tests and commit `feat: enforce vn-only equity support`.

### Task 6: Live apply, refresh, performance, and release verification

**Files:**
- Modify only if live-smoke exposes a tested parser defect.
- Update: `docs/operations/smart-insights-runbook.md` with observed live results.

**Interfaces:**
- Consumes: purge CLI, scheduler wrappers, collection CLI, briefing pipeline.
- Produces: cleaned database and refreshed evidence-backed briefings.

- [ ] Run purge dry-run and verify every selected asset is a foreign equity/ETF; then run `--apply` and query every dependent table plus assets to prove zero unsupported rows remain.
- [ ] Retire remaining out-of-scope backlog without processing it, run curated market refresh, daily/calendar/four-hourly/weekly Smart Insights schedules, derived pipelines, and all-membership briefing regeneration.
- [ ] Verify current opinions: BTC includes whale pressure only when eligible; XAU includes FRED/CFTC inputs; ETH/SOL include ETF plus Macro when fresh; Vietnamese equities remain; US symbols and XMR are absent.
- [ ] Measure source/runtime counts and confirm queries remain bounded; compare build output and API payload size with the pre-change baseline.
- [ ] Run full Python tests, full Vitest, lint, production build, `git diff --check`, and repository status.
- [ ] Merge the verified branch into local `main`, restart local service, and verify the listener plus HTTP response before reporting completion.
