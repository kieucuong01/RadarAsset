# Portfolio Cash-Flow Assumptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit cash, contributions, scheduled rebalancing, dividend/FX policy, and market-specific costs to reproducible portfolio backtests.

**Architecture:** Normalize every assumption in the TypeScript boundary and persist it in `QuantRun.parameters` and the canonical hash. Keep strategy execution per sleeve, then apply deterministic normalized-capital cash flows and rebalancing in a Python portfolio aggregation layer. Reject unavailable adjusted-price data before the transaction and expose contribution and rebalance artifacts through strict client schemas.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.8, Zod 4, Prisma 7/PostgreSQL, Vitest 4, Python 3.12, pytest, Recharts.

## Global Constraints

- Asset plus cash allocation is exactly `10_000` basis points.
- Never fabricate dividends, FX rates, prices, or fills.
- Preserve long-only, signal-at-close, next-bar-open strategy semantics.
- Store normalized assumptions in the run hash and manifest.
- Resolve dataset adjustment policy and tenant ownership server-side.
- Keep normalized simulation capital clearly separated from broker accounting.

---

### Task 1: Assumption contracts and hashing

**Files:**
- Modify: `src/lib/backtest/contracts.ts`
- Modify: `src/lib/backtest/contracts.test.ts`
- Modify: `src/lib/backtest/hash.ts`

**Interfaces:**
- Produces: `portfolioAssumptionsSchema`, `PortfolioAssumptions`, and canonical defaults on `PortfolioBacktestSubmission`.
- Consumes: `TOTAL_ALLOCATION_BPS` and the existing canonical/legacy submission schemas.

- [ ] **Step 1: Write failing tests**

Add literal tests that accept `cashAllocationBps: 2_000` with asset legs totaling
`8_000`, reject a 9,999 combined total, reject contribution with invalid cost
bounds, and prove legacy normalization receives deterministic defaults.

- [ ] **Step 2: Verify RED**

Run: `node node_modules/vitest/vitest.mjs run src/lib/backtest/contracts.test.ts`
Expected: FAIL because canonical submissions do not expose the assumptions.

- [ ] **Step 3: Implement strict schemas and defaults**

Add strict market cost schemas, enum policies, cross-field allocation validation,
and legacy normalization. Include the normalized assumption object in the hash
payload without accepting storage IDs from the client.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node node_modules/vitest/vitest.mjs run src/lib/backtest/contracts.test.ts src/lib/backtest/allocation.test.ts`
Commit: `feat: define portfolio cash flow assumptions`

---

### Task 2: Server eligibility and transactional persistence

**Files:**
- Create: `src/lib/backend/quant-runs.ts`
- Create: `src/lib/backend/quant-runs.test.ts`
- Modify: `src/app/api/quant/runs/route.ts`
- Modify: `src/app/api/quant/runs/[id]/route.ts`
- Modify: `src/lib/backtest/client.ts`
- Modify: `src/lib/backtest/client.test.ts`

**Interfaces:**
- Produces: `createPortfolioQuantRun`, `listPortfolioQuantRuns`, and `loadPortfolioQuantRun`.
- Consumes: normalized assumptions, tenant context, assets, immutable strategy versions, and active dataset versions.

- [ ] **Step 1: Write failing tests**

Test one transaction creates the aggregate run and all legs, `adjusted_prices`
rejects raw datasets before writes, per-market leverage and cost bounds are
server checked, and tenant-scoped reads return legs plus scoped artifacts.

- [ ] **Step 2: Verify RED**

Run: `node node_modules/vitest/vitest.mjs run src/lib/backend/quant-runs.test.ts src/app/api/tenant-routes.test.ts src/lib/backtest/client.test.ts`
Expected: FAIL because the portfolio persistence module and response contract are absent.

- [ ] **Step 3: Implement the bounded transaction**

Resolve all immutable records before opening a short transaction. Create one
`QuantRun`, batch-create `QuantRunLeg` rows, and load the tenant-owned response.
Map deterministic eligibility errors to HTTP 409 and Zod errors to 400.

- [ ] **Step 4: Verify GREEN and commit**

Run the RED command again and `node node_modules/typescript/bin/tsc --noEmit`.
Commit: `feat: create cash aware portfolio runs`

---

### Task 3: Builder state and UI assumptions

**Files:**
- Create: `src/lib/backtest/builder-state.ts`
- Create: `src/lib/backtest/builder-state.test.ts`
- Create: `src/components/PortfolioBacktestBuilder.tsx`
- Create: `src/components/BacktestLegCard.tsx`
- Create: `src/components/QuantAssetPickerDialog.tsx`
- Modify: `src/components/BacktestWorkbench.tsx`

**Interfaces:**
- Produces: empty/add/remove builder flow, cash target, equal/custom/optimized weights, and assumption controls.
- Consumes: strategy catalog, asset catalog, optimizer proposal, and portfolio run client.

- [ ] **Step 1: Write failing reducer tests**

Test equal allocation with reserved cash, custom edits, remove behavior, optimizer
application preserving cash, independent per-leg strategies, and invalid totals.

- [ ] **Step 2: Verify RED**

Run: `node node_modules/vitest/vitest.mjs run src/lib/backtest/builder-state.test.ts`
Expected: FAIL because builder state does not exist.

- [ ] **Step 3: Implement reducer and accessible UI**

Use one reducer for all state transitions. Render searchable asset picker,
per-leg allocation/notional/strategy inputs, cash card, rebalance/contribution
controls, explicit dividend/FX disclosures, market cost controls, validation
reasons, and one submit action. Remove fixed FPT/BTC/XAU submission code.

- [ ] **Step 4: Verify GREEN and commit**

Run reducer tests, client tests, and TypeScript. Commit:
`feat: build cash aware portfolio backtest UI`.

---

### Task 4: Python portfolio accounting

**Files:**
- Create: `quant-worker/backtest/portfolio.py`
- Create: `quant-worker/tests/test_portfolio.py`
- Modify: `quant-worker/worker.py`
- Modify: `quant-worker/tests/test_worker.py`

**Interfaces:**
- Produces: `PortfolioAssumptions`, `PortfolioLegInput`, `run_portfolio`, contribution/cash-flow/rebalance artifacts.
- Consumes: completed per-leg strategy results and immutable run parameters.

- [ ] **Step 1: Write failing Python tests**

Test cash stays flat, monthly contribution timing, yearly/quarterly rebalance
timing, turnover cost, no future-timestamp influence, and missing adjusted data
failure.

- [ ] **Step 2: Verify RED**

Run from `quant-worker`: `python -m pytest tests/test_portfolio.py -q`
Expected: FAIL because `backtest.portfolio` does not exist.

- [ ] **Step 3: Implement normalized-capital aggregation**

Aggregate only completed sleeve values, apply contribution before scheduled
rebalance, charge market costs against transferred asset notional, calculate
per-series contribution, and emit deterministic manifests and events. Extend
the repository to load legs and persist aggregate/per-leg scoped artifacts in
one active-lease transaction while preserving legacy runs.

- [ ] **Step 4: Verify GREEN and commit**

Run from `quant-worker`: `python -m pytest tests/test_portfolio.py tests/test_worker.py tests/test_engine_golden.py -q`.
Commit: `feat: account for portfolio cash flows`.

---

### Task 5: Results and contribution chart

**Files:**
- Create: `src/lib/backtest/result-model.ts`
- Create: `src/lib/backtest/result-model.test.ts`
- Create: `src/components/BacktestResults.tsx`
- Modify: `src/lib/backtest/client.ts`
- Modify: `src/components/BacktestWorkbench.tsx`

**Interfaces:**
- Produces: strict aggregate/per-leg result model and contribution chart including cash.
- Consumes: scoped artifacts from Task 4.

- [ ] **Step 1: Write failing parser tests**

Reject cross-leg scope mismatches and malformed contribution/cash-flow payloads;
accept a cash contribution series and deterministic assumption manifest.

- [ ] **Step 2: Verify RED**

Run: `node node_modules/vitest/vitest.mjs run src/lib/backtest/result-model.test.ts src/lib/backtest/client.test.ts`
Expected: FAIL because scoped contribution models are absent.

- [ ] **Step 3: Implement strict models and chart**

Render aggregate equity/drawdown, stacked asset-plus-cash contribution, event
table, assumptions/warnings, and per-leg trades/signals. Keep unchecked JSON
outside React components.

- [ ] **Step 4: Verify GREEN and commit**

Run focused tests and TypeScript. Commit:
`feat: show portfolio contribution and cash flows`.

---

### Task 6: End-to-end verification

**Files:** No planned source changes; failures return to their owning task with a regression test.

- [ ] **Step 1: Run all Vitest and pytest suites**
- [ ] **Step 2: Run Prisma validate and migrated database integration tests**
- [ ] **Step 3: Run TypeScript, lint, production build, and npm audit assessment**
- [ ] **Step 4: Browser-test desktop and 390px builder/result flows**
- [ ] **Step 5: Confirm `git diff --check`, scoped commits, and untouched main checkout**

