# Multi-Strategy Backtest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard-coded MA Crossover backtest with a versioned strategy catalog that runs MA Crossover, Turtle Breakout, Signal Rolling Reversal, and ABCD Causal against user-selected supported assets.

**Architecture:** Next.js owns tenant authentication, catalog presentation, request validation, immutable strategy-version lookup, and run queuing. A durable Python worker dispatches the selected allow-listed strategy through a shared event-driven engine, persists per-asset and normalized comparison artifacts, and never executes uploaded code. Backtest decisions use completed-bar data and fill only at the next eligible bar open.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zod 4, Prisma 7, PostgreSQL, Python 3.12-compatible code, NumPy, psycopg 3, pytest, Vitest, Recharts.

## Global Constraints

- Initial live universe is FPT 1d/1h, BTC/USDT 1d/1h, and XAU/USD 1d.
- XAU/USD 1h stays disabled until a real stable hourly provider exists.
- Use one shared strategy implementation for full backtests and later incremental signal evaluation.
- Indicators at bar `t` may use only data available at or before bar `t` close.
- A signal confirmed at bar `t` fills no earlier than bar `t+1` open.
- No uploaded notebooks, arbitrary Python, `eval`, shell execution, or user-controlled imports.
- FPT leverage is capped at 2x; BTC and XAU spot are capped at 1x.
- The MVP is long-only with `flat` and `long` position states.
- Strategy and dataset versions, checksums, normalized parameters, and engine version must be reproducible.
- Per-asset monetary results use the dataset quote currency; multi-asset comparison uses equal-weight normalized return curves indexed to 100.
- Preserve tenant scoping and do not weaken the current database-safety wrapper.

---

### Task 1: Persist immutable strategy versions

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608110001_strategy_versions/migration.sql`
- Test: `src/lib/backend/tenant-isolation.integration.test.ts`

**Interfaces:**
- Consumes: existing `QuantRun`, `Organization`, and PostgreSQL UUID conventions.
- Produces: Prisma `StrategyVersion` and nullable `QuantRun.strategyVersionId` relation; new runs require the relation at the application boundary while legacy rows remain readable.

- [ ] **Step 1: Add a failing migrated-database integration assertion**

Add a test that creates a Strategy Version and a tenant Quant Run referencing it, then verifies a second organization cannot load the run through `getQuantRun`:

```ts
const strategy = await prisma.strategyVersion.create({
  data: {
    code: "ma_crossover",
    version: "1.0.0",
    name: "MA Crossover",
    category: "rule_based",
    status: "active",
    parameterSchema: { type: "object" },
    defaultParameters: { fastPeriod: 5, slowPeriod: 20 },
    supportedMarkets: ["vn_equity", "crypto_spot", "metal_spot"],
    supportedTimeframes: ["1d", "1h"],
    implementationHash: "a".repeat(64),
  },
});
expect(strategy.code).toBe("ma_crossover");
```

- [ ] **Step 2: Run the focused integration test and verify schema failure**

Run: `npm run test:integration -- src/lib/backend/tenant-isolation.integration.test.ts`

Expected: FAIL because `strategyVersion` and `strategyVersionId` do not exist.

- [ ] **Step 3: Add schema and migration**

Add `StrategyVersion` with unique `(code, version)`, JSON parameter metadata, implementation hash, optional attribution fields, and reverse Quant Run relation. Add nullable `strategy_version_id` to `quant_runs`, its foreign key with `ON DELETE RESTRICT`, and an index. Add `worker_id`, `lease_expires_at`, and `attempt_count` to Quant Run so an interrupted durable worker can recover or terminate a stale run deterministically. Nullable strategy version is required only to preserve existing run rows; all new catalog-backed runs reject a missing version in TypeScript.

- [ ] **Step 4: Apply the migration to the isolated test database**

Run: `npm run test:integration -- src/lib/backend/tenant-isolation.integration.test.ts`

Expected: PASS with the existing database-safety checks active.

- [ ] **Step 5: Commit the schema slice**

```powershell
git add prisma/schema.prisma prisma/migrations/202608110001_strategy_versions/migration.sql src/lib/backend/tenant-isolation.integration.test.ts
git commit -m "feat: persist immutable strategy versions"
```

### Task 2: Define and synchronize the TypeScript strategy catalog

**Files:**
- Create: `src/lib/backtest/strategy-catalog.ts`
- Create: `src/lib/backtest/strategy-catalog.test.ts`
- Create: `scripts/sync-strategy-catalog.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Prisma `StrategyVersion` from Task 1.
- Produces: `STRATEGY_CATALOG`, `strategyDefinition(code, version)`, `normalizeStrategyParameters(code, input)`, and `syncStrategyCatalog(prisma)`.

- [ ] **Step 1: Write catalog contract tests**

Test exact catalog codes, versions, timeframes, parameter defaults, and rejection of unknown keys:

```ts
expect(STRATEGY_CATALOG.map((item) => item.code)).toEqual([
  "ma_crossover",
  "turtle_breakout",
  "signal_rolling_reversal",
  "abcd_causal",
]);
expect(normalizeStrategyParameters("turtle_breakout", {
  entryPeriod: 20,
  exitPeriod: 10,
})).toEqual({ entryPeriod: 20, exitPeriod: 10 });
expect(() => normalizeStrategyParameters("ma_crossover", {
  fastPeriod: 20,
  slowPeriod: 5,
})).toThrow("Fast period must be lower than slow period");
```

- [ ] **Step 2: Verify the catalog test fails**

Run: `npx vitest run src/lib/backtest/strategy-catalog.test.ts`

Expected: FAIL because the catalog module does not exist.

- [ ] **Step 3: Implement strict code-owned definitions**

Use a discriminated union for the four parameter shapes and Zod `.strict()` schemas. Compute `implementationHash` from a canonical JSON descriptor containing code, version, semantics, defaults, bounds, and warm-up rule. Do not hash source file paths or environment-specific values.

- [ ] **Step 4: Add an idempotent sync script**

`syncStrategyCatalog` inserts missing `(code, version)` rows, verifies immutable fields for existing rows, and fails if a stored version differs from code. Add:

```json
"strategy:sync": "node --import tsx scripts/sync-strategy-catalog.ts"
```

The script loads only `DATABASE_URL` through the existing local environment pattern and never prints it.

- [ ] **Step 5: Run catalog tests and synchronize the development catalog**

Run:

```powershell
npx vitest run src/lib/backtest/strategy-catalog.test.ts
npm run strategy:sync
```

Expected: tests PASS and four immutable rows are created or verified.

- [ ] **Step 6: Commit the catalog slice**

```powershell
git add src/lib/backtest/strategy-catalog.ts src/lib/backtest/strategy-catalog.test.ts scripts/sync-strategy-catalog.ts package.json package-lock.json
git commit -m "feat: add versioned strategy catalog"
```

### Task 3: Introduce the shared Python strategy interface and preserve MA behavior

**Files:**
- Create: `quant-worker/backtest/strategies/__init__.py`
- Create: `quant-worker/backtest/strategies/models.py`
- Create: `quant-worker/backtest/strategies/ma_crossover.py`
- Create: `quant-worker/backtest/strategy_catalog.py`
- Modify: `quant-worker/backtest/engine.py`
- Modify: `quant-worker/tests/test_engine_golden.py`
- Create: `quant-worker/tests/test_strategy_catalog.py`

**Interfaces:**
- Consumes: existing `Bar`, `EngineConfig`, and next-bar fill behavior.
- Produces: `PositionState`, `StrategyDecision`, `Strategy` protocol, `get_strategy(code, version)`, and `run_strategy_backtest(...)`.

- [ ] **Step 1: Write failing interface and parity tests**

Add tests asserting:

```python
strategy = get_strategy("ma_crossover", "1.0.0")
decisions = strategy.evaluate(bars, {"fastPeriod": 2, "slowPeriod": 3})
assert all(decision.signal_at == bars[decision.bar_index].timestamp for decision in decisions)

legacy = run_ma_cross(bars_by_asset, config)
generic = run_strategy_backtest(
    bars_by_asset,
    config,
    strategy_code="ma_crossover",
    strategy_version="1.0.0",
    strategy_parameters={"fastPeriod": 2, "slowPeriod": 3},
)
assert generic == legacy
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `python -m pytest quant-worker/tests/test_strategy_catalog.py quant-worker/tests/test_engine_golden.py -q`

Expected: FAIL because the shared strategy interface and generic runner do not exist.

- [ ] **Step 3: Implement the minimal strategy boundary**

Define immutable dataclasses for decisions and a Protocol that evaluates completed bars. Move SMA signal generation from `run_ma_cross` into `MaCrossoverStrategy`. Keep fill, fee, slippage, position sizing, equity, drawdown, and trade construction in `engine.py`. Retain `run_ma_cross` temporarily as a compatibility wrapper around `run_strategy_backtest`.

- [ ] **Step 4: Run parity and golden tests**

Run: `python -m pytest quant-worker/tests/test_strategy_catalog.py quant-worker/tests/test_engine_golden.py -q`

Expected: PASS with byte-equivalent canonical artifact payloads for the existing golden fixture.

- [ ] **Step 5: Commit the shared boundary**

```powershell
git add quant-worker/backtest/strategies quant-worker/backtest/strategy_catalog.py quant-worker/backtest/engine.py quant-worker/tests/test_strategy_catalog.py quant-worker/tests/test_engine_golden.py
git commit -m "refactor: extract shared backtest strategy interface"
```

### Task 4: Add Turtle Breakout and Rolling Reversal

**Files:**
- Create: `quant-worker/backtest/strategies/turtle_breakout.py`
- Create: `quant-worker/backtest/strategies/signal_rolling_reversal.py`
- Create: `quant-worker/tests/test_rule_strategies.py`
- Modify: `quant-worker/backtest/strategy_catalog.py`

**Interfaces:**
- Consumes: `StrategyDecision` and `get_strategy` from Task 3.
- Produces: `TurtleBreakoutStrategy` and `SignalRollingReversalStrategy` registered at version `1.0.0`.

- [ ] **Step 1: Write causal signal tests**

Use short deterministic bars and assert exact signal indices. The Turtle test must append a large future bar and prove earlier decisions do not change. The Rolling test must prove a broken consecutive sequence resets the counter.

```python
before = strategy.evaluate(bars[:8], params)
after = strategy.evaluate(bars[:8] + [future_bar], params)
assert after[: len(before)] == before
```

- [ ] **Step 2: Run tests and verify failure**

Run: `python -m pytest quant-worker/tests/test_rule_strategies.py -q`

Expected: FAIL because both strategy modules are missing.

- [ ] **Step 3: Implement Turtle with prior-bar extrema only**

Compute entry high and exit low from slices ending before the current bar. Emit BUY only on flat-to-long transition and SELL only on long-to-flat transition.

- [ ] **Step 4: Implement Rolling Reversal with bounded counters**

While flat, count consecutive lower closes and BUY at the configured threshold. While long, count consecutive higher closes and SELL at the threshold. Reset the relevant counter on sequence break and after state transition.

- [ ] **Step 5: Run strategy tests**

Run: `python -m pytest quant-worker/tests/test_rule_strategies.py quant-worker/tests/test_strategy_catalog.py -q`

Expected: PASS.

- [ ] **Step 6: Commit both strategies**

```powershell
git add quant-worker/backtest/strategies quant-worker/backtest/strategy_catalog.py quant-worker/tests/test_rule_strategies.py
git commit -m "feat: add turtle and rolling reversal strategies"
```

### Task 5: Add causal ABCD pattern recognition

**Files:**
- Create: `quant-worker/backtest/strategies/abcd_causal.py`
- Create: `quant-worker/tests/test_abcd_causal.py`
- Modify: `quant-worker/backtest/strategy_catalog.py`

**Interfaces:**
- Consumes: shared strategy models from Task 3.
- Produces: `AbcdCausalStrategy` version `1.0.0` with confirmed-pivot indicator snapshots.

- [ ] **Step 1: Write delayed-confirmation and future-append tests**

Construct one bullish and one bearish sequence. Assert the decision timestamp equals the bar that confirms D after `pivotRightBars`, not the D pivot timestamp. Append future bars and assert all prior decisions remain unchanged.

- [ ] **Step 2: Verify tests fail**

Run: `python -m pytest quant-worker/tests/test_abcd_causal.py -q`

Expected: FAIL because `AbcdCausalStrategy` does not exist.

- [ ] **Step 3: Implement bounded pivot detection**

Scan once through bars, confirm a candidate pivot only after the configured right-side bars exist, retain only the latest bounded pivot window, evaluate alternating A/B/C/D pivots, and enforce ratio bounds. Never assign a signal to an earlier pivot index.

- [ ] **Step 4: Run ABCD and complete strategy tests**

Run: `python -m pytest quant-worker/tests/test_abcd_causal.py quant-worker/tests/test_rule_strategies.py quant-worker/tests/test_strategy_catalog.py -q`

Expected: PASS.

- [ ] **Step 5: Commit ABCD**

```powershell
git add quant-worker/backtest/strategies/abcd_causal.py quant-worker/backtest/strategy_catalog.py quant-worker/tests/test_abcd_causal.py
git commit -m "feat: add causal abcd strategy"
```

### Task 6: Generalize the web request contract and catalog API

**Files:**
- Rewrite: `src/lib/backtest/contracts.ts`
- Modify: `src/lib/backtest/contracts.test.ts`
- Create: `src/lib/backtest/errors.ts`
- Create: `src/app/api/quant/strategies/route.ts`
- Modify: `src/app/api/tenant-routes.test.ts`
- Modify: `src/lib/backtest/client.ts`
- Modify: `src/lib/backtest/client.test.ts`

**Interfaces:**
- Consumes: `normalizeStrategyParameters` and catalog definitions from Task 2.
- Produces: `BacktestSubmission` discriminated by strategy code, `GET /api/quant/strategies`, and client `loadStrategyCatalog()`.

- [ ] **Step 1: Replace MA-only contract fixtures with a strategy matrix**

Test one valid payload per strategy, unknown code/version rejection, strict unknown-parameter rejection, leverage bounds, duplicate asset rejection, and canonical asset ordering. Keep the existing attacker-controlled `user_python` rejection test.

- [ ] **Step 2: Run TypeScript contract and route tests**

Run: `npx vitest run src/lib/backtest/contracts.test.ts src/lib/backtest/client.test.ts src/app/api/tenant-routes.test.ts`

Expected: FAIL because the current schema accepts only `ma_cross` and no catalog route exists.

- [ ] **Step 3: Implement the discriminated request**

Use this stable outer shape:

```ts
type BacktestSubmission = {
  strategy: { code: StrategyCode; version: "1.0.0"; parameters: StrategyParameters };
  timeframe: "1d" | "1h";
  initialCapital: number;
  feeBps: number;
  slippageBps: number;
  from: string;
  to: string;
  legs: Array<{ symbol: "FPT" | "BTC" | "XAU"; leverage: number }>;
};
```

Canonical hashing includes strategy version and normalized parameters. Return a public error for XAU 1h before queuing.

Define stable `BacktestError` codes in `errors.ts`: `STRATEGY_NOT_FOUND`, `STRATEGY_NOT_RUNNABLE`, `STRATEGY_PARAMETERS_INVALID`, `STRATEGY_VERSION_MISMATCH`, `DATASET_UNAVAILABLE`, `DATASET_STALE`, `DATASET_CHECKSUM_MISMATCH`, `INSUFFICIENT_WARMUP`, `WORKER_LOST`, `ENGINE_TIMEOUT`, and `ENGINE_FAILED`. Route responses expose the code and a sanitized message, never a stack trace or provider body.

- [ ] **Step 4: Implement and test the catalog endpoint/client**

Return public metadata only. Do not return internal file paths or executable content. Research-only entries may be returned with `runnable: false`.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run src/lib/backtest/contracts.test.ts src/lib/backtest/client.test.ts src/app/api/tenant-routes.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the contract slice**

```powershell
git add src/lib/backtest src/app/api/quant/strategies src/app/api/tenant-routes.test.ts
git commit -m "feat: expose multi-strategy backtest contracts"
```

### Task 7: Queue and execute generic versioned runs

**Files:**
- Modify: `src/lib/backend/db.ts`
- Modify: `src/lib/backend/types.ts`
- Modify: `src/lib/backend/tenant-scoping.test.ts`
- Modify: `src/lib/backend/tenant-isolation.integration.test.ts`
- Modify: `quant-worker/worker.py`
- Modify: `quant-worker/tests/test_worker.py`

**Interfaces:**
- Consumes: `BacktestSubmission`, `StrategyVersion`, `get_strategy`, and `run_strategy_backtest`.
- Produces: tenant-scoped catalog-backed Quant Runs and generic worker dispatch with `signals`, `assetMetrics`, and `comparison` artifacts.

- [ ] **Step 1: Write failing queue and worker dispatch tests**

Assert `createQuantRun` resolves the exact active Strategy Version and writes `strategyVersionId`, canonical hash, engine version `event-bar-v2`, and selected active dataset versions. Parameterize the worker test across all four strategy codes and assert no SQL claim predicate contains a strategy display name.

- [ ] **Step 2: Run focused TypeScript and Python tests**

Run:

```powershell
npx vitest run src/lib/backend/tenant-scoping.test.ts
python -m pytest quant-worker/tests/test_worker.py -q
```

Expected: FAIL on MA-only persistence and worker dispatch.

- [ ] **Step 3: Generalize run creation**

Resolve `(code, version)` in PostgreSQL, compare its implementation hash to the code-owned catalog, validate supported market/timeframe, and store the relation. Preserve legacy response compatibility while adding `strategyCode`, `strategyVersion`, and artifact kind `signals`.

- [ ] **Step 4: Generalize worker claim and dispatch**

Claim any queued run with a non-null Strategy Version. Load code/version in the claim query, validate the code-owned Python catalog, execute each selected dataset independently, and merge artifacts into deterministic asset-key order.

- [ ] **Step 5: Produce normalized comparison artifacts**

Persist:

- `equity`: asset-keyed quote-currency equity series.
- `drawdown`: asset-keyed drawdown series.
- `trades`: all trades with asset labels.
- `signals`: bounded BUY/SELL decisions with reasons.
- `asset_metrics`: metrics keyed by asset.
- `comparison`: equal-weight normalized strategy and Buy & Hold curves indexed to 100.
- `manifest`: strategy, engine, dataset, parameter, and checksum metadata.

Each asset metric set contains total return, Buy & Hold return, final equity, conditional CAGR, annualized volatility, conditional Sharpe and Sortino, maximum drawdown, trade count, win rate, conditional profit factor, total fees, slippage cost, exposure percentage, and average holding duration. Metrics with insufficient observations are persisted as null and rendered as unavailable.

Update the artifact type union without coercing unknown kinds to `manifest`.

- [ ] **Step 6: Run worker, tenant, and migrated-database tests**

Run:

```powershell
npx vitest run src/lib/backend/tenant-scoping.test.ts src/lib/backtest/client.test.ts
python -m pytest quant-worker/tests/test_worker.py quant-worker/tests/test_engine_golden.py -q
npm run test:integration -- src/lib/backend/tenant-isolation.integration.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the generic execution slice**

```powershell
git add src/lib/backend/db.ts src/lib/backend/types.ts src/lib/backend/tenant-scoping.test.ts src/lib/backend/tenant-isolation.integration.test.ts quant-worker/worker.py quant-worker/tests/test_worker.py
git commit -m "feat: execute versioned multi-strategy runs"
```

### Task 8: Make the worker durable for local and deployed use

**Files:**
- Modify: `quant-worker/worker.py`
- Modify: `quant-worker/tests/test_worker.py`
- Create: `scripts/run-quant-worker.ps1`
- Modify: `package.json`
- Modify: `quant-worker/README.md`

**Interfaces:**
- Consumes: generic `run_once()` from Task 7.
- Produces: `run_forever(poll_seconds, stop_event)`, CLI `--once` and `--watch`, and a Windows-safe launcher.

- [ ] **Step 1: Write lifecycle tests**

Use a fake stop event and injected sleeper to prove watch mode processes multiple queued runs, idles without exiting, and stops cleanly. Assert `--once` preserves the current single-run behavior for scheduled diagnostics. Add repository tests proving an expired lease is reclaimed once, attempt count is bounded, heartbeat extends an active lease, and a repeatedly lost run ends with sanitized `WORKER_LOST`.

- [ ] **Step 2: Verify lifecycle tests fail**

Run: `python -m pytest quant-worker/tests/test_worker.py -q`

Expected: FAIL because only one-shot `main()` exists.

- [ ] **Step 3: Implement durable mode**

Default the package script to `--watch`, catch and sanitize per-iteration connection errors, use bounded backoff, and reconnect for each transaction. Do not keep an aborted psycopg connection alive across iterations. Claiming sets a worker ID and lease expiry; the worker heartbeats during long execution, clears the lease on completion, and reclaims only expired leases below the attempt limit.

- [ ] **Step 4: Add the PowerShell launcher**

Resolve repository root and Python executable explicitly, pass through exit codes, and never log `.env.local` values. Add:

```json
"quant:worker": "python quant-worker/worker.py --watch",
"quant:worker:once": "python quant-worker/worker.py --once"
```

- [ ] **Step 5: Run lifecycle tests and a two-run local smoke**

Run worker watch mode, submit two runs through the API, and verify both reach `succeeded` without restarting the worker.

Expected: two distinct run IDs complete and the worker remains alive.

- [ ] **Step 6: Commit durable worker support**

```powershell
git add quant-worker/worker.py quant-worker/tests/test_worker.py scripts/run-quant-worker.ps1 package.json package-lock.json quant-worker/README.md
git commit -m "feat: run quant worker continuously"
```

### Task 9: Build the multi-strategy Quant Lab interface

**Files:**
- Modify: `src/components/BacktestWorkbench.tsx`
- Create: `src/components/backtest/BacktestAssetPicker.tsx`
- Create: `src/components/backtest/StrategySelector.tsx`
- Create: `src/components/backtest/StrategyParametersForm.tsx`
- Create: `src/components/backtest/BacktestResults.tsx`
- Create: `src/lib/backtest/form-state.ts`
- Create: `src/lib/backtest/form-state.test.ts`
- Modify: `src/components/MockPortfolio.tsx`

**Interfaces:**
- Consumes: `loadStrategyCatalog`, generalized `submitBacktest`, per-asset artifacts, and URL query `assets=FPT,BTC`.
- Produces: portfolio-prefilled multi-strategy form, dynamic bounded parameters, per-asset results, and Buy & Hold comparison.

- [ ] **Step 1: Write failing form-domain tests**

Test catalog selection changes visible parameter fields, XAU 1h is disabled, URL assets are normalized to the supported set, unselected assets are excluded from the payload, and MA requires fast period below slow period.

- [ ] **Step 2: Run component tests and verify failure**

Run: `npx vitest run src/lib/backtest/form-state.test.ts`

Expected: FAIL because the pure form-state normalizer does not exist.

- [ ] **Step 3: Split the workbench by responsibility**

Keep network polling in `BacktestWorkbench`. Move asset selection, strategy selection, parameter fields, and result rendering into focused components. Put URL asset parsing, supported-combination checks, and submission construction in pure `form-state.ts` functions so Vitest does not require a DOM testing dependency. Generate only allow-listed field types from catalog metadata: bounded integer, bounded decimal, and enum.

- [ ] **Step 4: Add portfolio handoff**

Add **Backtest** actions to supported Mock Portfolio holdings that navigate to `/quant-lab?assets=SYMBOL`. Unsupported holdings show the dataset-unavailable reason and do not navigate into a runnable state.

- [ ] **Step 5: Render per-asset and normalized results**

Show signal markers, strategy versus Buy & Hold, risk metrics, trade ledger, and manifest. Label unavailable metrics as `N/A`, not zero. Do not show **Apply Strategy** yet; Plan 2 adds it with persistence.

- [ ] **Step 6: Run focused UI and contract tests**

Run:

```powershell
npx vitest run src/lib/backtest/form-state.test.ts src/lib/backtest/client.test.ts src/lib/backtest/contracts.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit the interface**

```powershell
git add src/components/BacktestWorkbench.tsx src/components/backtest src/components/MockPortfolio.tsx src/lib/backtest/form-state.ts src/lib/backtest/form-state.test.ts
git commit -m "feat: add multi-strategy quant lab workflow"
```

### Task 10: Verify the complete multi-strategy slice

**Files:**
- Modify only if verification exposes a defect in files already listed above.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: evidence that Plan 1 is ready for the Strategy Assignment plan.

- [ ] **Step 1: Run all unit suites**

Run:

```powershell
npm test
python -m pytest quant-worker/tests -q
```

Expected: all tests PASS; PostgreSQL-only tests may not be counted here because the next step runs them explicitly.

- [ ] **Step 2: Run migrated-database integration tests**

Run: `npm run test:integration`

Expected: PASS against the isolated local test database selected by the safety wrapper.

- [ ] **Step 3: Run static and production-build gates**

Run:

```powershell
npx tsc --noEmit
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 4: Run browser QA with the durable worker**

Exercise:

- `/portfolio` holding to `/quant-lab?assets=...`.
- All four strategy forms.
- One successful FPT 1d run per strategy.
- BTC 1h successful run.
- XAU 1h disabled reason.
- Desktop and 390px mobile layout.
- No framework overlay and no relevant console warning/error.

- [ ] **Step 5: Resolve verification defects through their owning task**

If a gate exposes a defect, return to the task that owns that file, add a failing regression test to that task's listed test file, implement the minimal correction, rerun the task's focused command and the failed gate, then commit only the files named by that task. If no defect is found, do not create an empty commit.
