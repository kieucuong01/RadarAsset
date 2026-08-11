# Backtest & Risk Classic Results UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the classic Active Portfolio, Equity Curve & Drawdown, KPI, and Trade List hierarchy using only immutable real backtest artifacts.

**Architecture:** Keep the Python engine and API contracts unchanged. Add a pure TypeScript presentation layer that aligns artifacts and aggregates portfolio trades, then split the current monolithic results component into focused React components. The workbench renders explicit empty, active, failed, and succeeded states; existing QuantStats, contribution, cash-flow, per-leg details, and Mock Portfolio actions move into a secondary Advanced Analysis surface.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Recharts, shadcn/ui, Tailwind CSS.

## Global Constraints

- Never display generated performance, generated trades, or simulated chart points before a successful run.
- Do not replace the Python backtest engine or change portfolio accounting semantics.
- Do not add a new backtesting or charting dependency.
- Missing benchmark and metrics remain explicitly unavailable; never substitute a hard-coded benchmark or value.
- Preserve QuantStats download, contribution/cash-flow details, dataset provenance, and Apply to Mock Portfolio.
- Keep the page free of horizontal overflow; only the Trade List card may scroll horizontally on small screens.
- Verify the merged `main` build and restart the app at `http://localhost:3100`.

---

## File Structure

- Create `src/lib/backtest/result-presentation.ts`: pure alignment, trade aggregation, filtering, and KPI derivation from validated artifacts.
- Create `src/lib/backtest/result-presentation.test.ts`: literal fixtures covering ordering, alignment, filtering, and missing values.
- Create `src/components/backtest-results/ActiveBacktestPortfolio.tsx`: submitted run legs and provenance summary.
- Create `src/components/backtest-results/EquityDrawdownChart.tsx`: responsive combined chart card.
- Create `src/components/backtest-results/BacktestKpiGrid.tsx`: artifact-backed KPI cards.
- Create `src/components/backtest-results/BacktestTradeList.tsx`: portfolio-level filtering and responsive trade table.
- Create `src/components/backtest-results/BacktestAdvancedAnalysis.tsx`: existing QuantStats, contribution, cash-flow, and per-leg content.
- Create `src/components/backtest-results/BacktestResultsEmpty.tsx`: no-run empty output hierarchy with no chart data.
- Modify `src/components/BacktestResults.tsx`: compose the focused result components.
- Modify `src/components/BacktestWorkbench.tsx`: render empty/active/failed/succeeded output states without duplicate success banners.
- Test `src/components/backtest-results/BacktestResultsEmpty.test.tsx`: server-render the real empty component and assert absence of fabricated values.

---

### Task 1: Artifact-backed presentation model

**Files:**
- Create: `src/lib/backtest/result-presentation.ts`
- Create: `src/lib/backtest/result-presentation.test.ts`

**Interfaces:**
- Consumes: `BacktestResultModel` from `src/lib/backtest/result-model.ts`.
- Produces: `alignEquityAndDrawdown(equity, drawdown)`, `buildPortfolioTradeRows(model)`, `filterPortfolioTradeRows(rows, symbol)`, and `buildBacktestKpis(model)`.

- [ ] **Step 1: Write failing tests for aligned chart points**

```ts
it("aligns drawdown to equity timestamps without inventing points", () => {
  expect(
    alignEquityAndDrawdown(
      [
        { timestamp: "2026-01-01T00:00:00Z", equity: 100, cash: 20, marketValue: 80, grossExposure: 80 },
        { timestamp: "2026-01-02T00:00:00Z", equity: 90, cash: 10, marketValue: 80, grossExposure: 80 },
      ],
      [{ timestamp: "2026-01-02T00:00:00Z", drawdownPct: -10 }],
    ),
  ).toEqual([
    { timestamp: "2026-01-01T00:00:00Z", equity: 100, drawdownPct: null },
    { timestamp: "2026-01-02T00:00:00Z", equity: 90, drawdownPct: -10 },
  ]);
});
```

- [ ] **Step 2: Run the alignment test and verify RED**

Run: `npm test -- --run src/lib/backtest/result-presentation.test.ts`

Expected: FAIL because `result-presentation.ts` and `alignEquityAndDrawdown` do not exist.

- [ ] **Step 3: Implement timestamp alignment with a Map lookup**

```ts
export function alignEquityAndDrawdown(
  equity: BacktestResultModel["aggregate"]["equity"],
  drawdown: BacktestResultModel["aggregate"]["drawdown"],
) {
  const drawdownByTimestamp = new Map(drawdown.map((point) => [point.timestamp, point.drawdownPct]));
  return equity.map((point) => ({
    timestamp: point.timestamp,
    equity: point.equity,
    drawdownPct: drawdownByTimestamp.get(point.timestamp) ?? null,
  }));
}
```

- [ ] **Step 4: Add failing tests for portfolio trade ordering and symbol filtering**

Use two literal leg fixtures: BTC exits at `2026-01-04T00:00:00Z` and FPT exits at `2026-01-06T00:00:00Z`. Assert the result is `[FPT, BTC]`, retains `legId`, `strategyCode`, `fees`, `barsHeld`, and returns only BTC when filtered with `"BTC"`.

- [ ] **Step 5: Run the trade tests and verify RED**

Run: `npm test -- --run src/lib/backtest/result-presentation.test.ts`

Expected: FAIL because `buildPortfolioTradeRows` and `filterPortfolioTradeRows` are missing.

- [ ] **Step 6: Implement immutable aggregation and filtering**

```ts
export type PortfolioTradeRow = BacktestResultModel["legs"][number]["trades"][number] & {
  legId: string;
  strategyCode: string;
};

export function buildPortfolioTradeRows(model: BacktestResultModel): PortfolioTradeRow[] {
  return model.legs
    .flatMap((leg) =>
      leg.trades.map((trade) => ({ ...trade, legId: leg.id, strategyCode: leg.strategyCode })),
    )
    .toSorted((left, right) => right.exitAt.localeCompare(left.exitAt));
}

export function filterPortfolioTradeRows(rows: PortfolioTradeRow[], symbol: string) {
  return symbol === "all" ? rows : rows.filter((trade) => trade.asset === symbol);
}
```

- [ ] **Step 7: Add failing KPI tests**

Assert that explicit aggregate `totalReturnPct`, `maxDrawdownPct`, and `sharpe` are returned as numbers, while absent `winRatePct` and `profitFactor` return `null`. The test must use literal metrics and must not compute its expected values with the implementation.

- [ ] **Step 8: Implement strict finite-number KPI selection**

```ts
function finiteMetric(metrics: Record<string, unknown>, key: string) {
  const value = metrics[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildBacktestKpis(model: BacktestResultModel) {
  return {
    totalReturnPct: finiteMetric(model.aggregate.metrics, "totalReturnPct"),
    maxDrawdownPct: finiteMetric(model.aggregate.metrics, "maxDrawdownPct"),
    sharpe: finiteMetric(model.aggregate.metrics, "sharpe"),
    winRatePct: finiteMetric(model.aggregate.metrics, "winRatePct"),
    profitFactor: finiteMetric(model.aggregate.metrics, "profitFactor"),
  };
}
```

- [ ] **Step 9: Run presentation tests and verify GREEN**

Run: `npm test -- --run src/lib/backtest/result-presentation.test.ts`

Expected: PASS.

- [ ] **Step 10: Commit the presentation model**

```powershell
git add src/lib/backtest/result-presentation.ts src/lib/backtest/result-presentation.test.ts
git commit -m "feat: add backtest result presentation model"
```

---

### Task 2: Classic primary result components

**Files:**
- Create: `src/components/backtest-results/ActiveBacktestPortfolio.tsx`
- Create: `src/components/backtest-results/EquityDrawdownChart.tsx`
- Create: `src/components/backtest-results/BacktestKpiGrid.tsx`
- Create: `src/components/backtest-results/BacktestTradeList.tsx`
- Create: `src/components/backtest-results/BacktestResultsEmpty.tsx`
- Create: `src/components/backtest-results/BacktestResultsEmpty.test.tsx`

**Interfaces:**
- Consumes: `BacktestRun`, `BacktestResultModel`, and Task 1 presentation helpers.
- Produces: focused React components used by `BacktestResults` and `BacktestWorkbench`.

- [ ] **Step 1: Write a failing empty-state rendering test**

```tsx
import { renderToStaticMarkup } from "react-dom/server";

it("renders a run prompt without fabricated performance or trades", () => {
  const html = renderToStaticMarkup(<BacktestResultsEmpty />);
  expect(html).toContain("Active Portfolio");
  expect(html).toContain("Run a portfolio backtest");
  expect(html).toContain("Equity Curve &amp; Drawdown");
  expect(html).toContain("Trade List");
  expect(html).not.toMatch(/\+\d|Sharpe\s+\d|BTC.*PnL/);
});
```

- [ ] **Step 2: Run the component test and verify RED**

Run: `npm test -- --run src/components/backtest-results/BacktestResultsEmpty.test.tsx`

Expected: FAIL because `BacktestResultsEmpty` does not exist.

- [ ] **Step 3: Implement the empty result hierarchy**

Create real Card shells titled `Active Portfolio`, `Equity Curve & Drawdown`, and `Trade List`. Use one shared message: `Run a portfolio backtest to populate real performance and completed trades.` Do not render Recharts components, metric values, asset symbols, or rows.

- [ ] **Step 4: Run the component test and verify GREEN**

Run: `npm test -- --run src/components/backtest-results/BacktestResultsEmpty.test.tsx`

Expected: PASS.

- [ ] **Step 5: Implement Active Portfolio using submitted run legs**

`ActiveBacktestPortfolio` accepts `{ run: BacktestRun; model: BacktestResultModel }`. Render each leg's symbol, strategy name/version, `allocationBps / 100`, `initialNotional`, leverage from the matching `run.legs` item, timeframe, and short dataset version. Use flex wrapping so chips do not widen the page.

- [ ] **Step 6: Implement the combined responsive chart**

`EquityDrawdownChart` accepts `{ model: BacktestResultModel; currency: "USD" | "VND" }`, calls `alignEquityAndDrawdown`, and renders:

- an equity `AreaChart` in the main panel;
- a drawdown `AreaChart` in the secondary panel;
- `lg:grid-cols-[minmax(0,1fr)_280px]` on desktop;
- one stacked column below `lg`;
- no benchmark legend or line because no benchmark artifact contract currently exists.

- [ ] **Step 7: Implement KPI cards with explicit missing values**

`BacktestKpiGrid` accepts `{ model: BacktestResultModel }`, calls `buildBacktestKpis`, and formats null as `—`. It must not derive Win Rate or Profit Factor from trades in the component.

- [ ] **Step 8: Implement the portfolio Trade List**

`BacktestTradeList` accepts `{ model: BacktestResultModel; currency: "USD" | "VND" }`. Build rows once with `useMemo`, keep a symbol filter in `useState`, and render columns for entry, exit, asset, strategy, side, entry price, exit price, bars, fees, PnL, and return. Wrap only the table in `overflow-x-auto`; keep the Card at `min-w-0 max-w-full`.

- [ ] **Step 9: Run focused tests and changed-file lint**

Run:

```powershell
npm test -- --run src/lib/backtest/result-presentation.test.ts src/components/backtest-results/BacktestResultsEmpty.test.tsx
npx eslint src/lib/backtest/result-presentation.ts src/lib/backtest/result-presentation.test.ts src/components/backtest-results/*.tsx
```

Expected: all tests and lint pass.

- [ ] **Step 10: Commit primary result components**

```powershell
git add src/components/backtest-results src/lib/backtest/result-presentation.ts src/lib/backtest/result-presentation.test.ts
git commit -m "feat: restore classic backtest result surfaces"
```

---

### Task 3: Preserve and demote Advanced Analysis

**Files:**
- Create: `src/components/backtest-results/BacktestAdvancedAnalysis.tsx`
- Modify: `src/components/BacktestResults.tsx`

**Interfaces:**
- Consumes: `BacktestRun`, `BacktestResultModel`, existing assignment normalization, and existing result artifacts.
- Produces: the final succeeded-run composition without changing API behavior.

- [ ] **Step 1: Write a failing presentation contract test**

Extend `result-presentation.test.ts` with a successful model containing `analytics` and `reportHtml`. Assert a new `advancedAnalysisAvailability(model)` returns:

```ts
{
  quantStats: true,
  contribution: true,
  cashFlowOrRebalance: true,
  perLeg: true,
}
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- --run src/lib/backtest/result-presentation.test.ts`

Expected: FAIL because `advancedAnalysisAvailability` is missing.

- [ ] **Step 3: Implement the availability helper**

Return booleans based only on validated model arrays and artifacts. Do not inspect raw run JSON.

- [ ] **Step 4: Extract current detailed content into Advanced Analysis**

Move, without changing behavior:

- QuantStats HTML Blob download;
- contribution chart and latest component values;
- cash-flow/rebalance event table;
- per-leg equity, strategy parameters, provenance, completed-trade detail, and Apply to Mock Portfolio.

Use a collapsed native `<details>` surface titled `Advanced Analysis`; keep the existing Portfolio/per-leg Tabs inside it. Preserve fetch URL, normalized assignment payload, success/error toasts, and download filename.

- [ ] **Step 5: Recompose BacktestResults in classic order**

`BacktestResults` should only build the result model and currency, then render:

```tsx
<ActiveBacktestPortfolio run={run} model={model} />
<EquityDrawdownChart model={model} currency={currency} />
<BacktestKpiGrid model={model} />
<BacktestTradeList model={model} currency={currency} />
<BacktestAdvancedAnalysis run={run} model={model} currency={currency} />
```

- [ ] **Step 6: Run focused and full Vitest**

Run:

```powershell
npm test -- --run src/lib/backtest/result-model.test.ts src/lib/backtest/result-presentation.test.ts src/components/backtest-results/BacktestResultsEmpty.test.tsx
npm test -- --run
```

Expected: all existing and new tests pass.

- [ ] **Step 7: Run changed-file ESLint**

Run:

```powershell
npx eslint src/components/BacktestResults.tsx src/components/backtest-results/*.tsx src/lib/backtest/result-presentation.ts src/lib/backtest/result-presentation.test.ts
```

Expected: no diagnostics.

- [ ] **Step 8: Commit Advanced Analysis composition**

```powershell
git add src/components/BacktestResults.tsx src/components/backtest-results src/lib/backtest/result-presentation.ts src/lib/backtest/result-presentation.test.ts
git commit -m "refactor: organize advanced backtest analysis"
```

---

### Task 4: Workbench states, production build, and local QA

**Files:**
- Modify: `src/components/BacktestWorkbench.tsx`
- Modify only if QA finds a scoped responsive defect: files under `src/components/backtest-results/`

**Interfaces:**
- Consumes: `BacktestResultsEmpty`, existing run polling, and `BacktestResults`.
- Produces: correct no-run, active, failed, and succeeded rendered states.

- [ ] **Step 1: Add a failing pure state test**

Add `backtestOutputState(status)` to `result-presentation.ts` and test these literal mappings:

```ts
expect(backtestOutputState(null)).toBe("empty");
expect(backtestOutputState("queued")).toBe("active");
expect(backtestOutputState("running")).toBe("active");
expect(backtestOutputState("failed")).toBe("failed");
expect(backtestOutputState("succeeded")).toBe("results");
```

- [ ] **Step 2: Run the state test and verify RED**

Run: `npm test -- --run src/lib/backtest/result-presentation.test.ts`

Expected: FAIL because `backtestOutputState` is missing.

- [ ] **Step 3: Implement state mapping and update the workbench**

Keep polling behavior unchanged. Render:

- `BacktestResultsEmpty` when no run exists;
- current progress Card only for queued/running;
- sanitized destructive Alert for failed;
- `BacktestResults` only for succeeded.

Remove the redundant succeeded Alert so the classic Active Portfolio begins immediately after completion.

- [ ] **Step 4: Run full verification**

Run:

```powershell
npm test -- --run
npx eslint src/components/BacktestWorkbench.tsx src/components/BacktestResults.tsx src/components/backtest-results/*.tsx src/lib/backtest/result-presentation.ts src/lib/backtest/result-presentation.test.ts
npm run build
git diff --check
```

Expected: Vitest, ESLint, TypeScript/Turbopack build, and diff check pass.

- [ ] **Step 5: Restart local services safely**

Resolve listeners for ports `3100` and `8100`, stop only commands whose working path belongs to this project, then start hidden processes:

```powershell
Start-Process -FilePath ".\.venv\Scripts\python.exe" -ArgumentList @("-m","uvicorn","service:app","--app-dir","quant-worker","--host","127.0.0.1","--port","8100") -WorkingDirectory $PWD -WindowStyle Hidden
Start-Process -FilePath "npm.cmd" -ArgumentList @("start","--","-p","3100") -WorkingDirectory $PWD -WindowStyle Hidden
```

- [ ] **Step 6: Run HTTP and browser QA**

Verify:

- `GET http://127.0.0.1:8100/healthz` returns 200;
- `GET http://localhost:3100/` returns 200;
- `/quant-lab` page identity and meaningful DOM;
- no framework overlay;
- no relevant console errors;
- empty state contains no generated results;
- authenticated successful result, when test credentials are safely available, shows Active Portfolio → Equity Curve & Drawdown → KPI → Trade List → Advanced Analysis;
- symbol filter changes visible trades;
- desktop and mobile have no page-level horizontal overflow.

- [ ] **Step 7: Commit final workbench integration and QA fixes**

```powershell
git add src/components/BacktestWorkbench.tsx src/components/BacktestResults.tsx src/components/backtest-results src/lib/backtest/result-presentation.ts src/lib/backtest/result-presentation.test.ts
git commit -m "feat: complete classic backtest results workflow"
```

- [ ] **Step 8: Confirm final repository and runtime state**

Run:

```powershell
git status --short
git log -4 --oneline
```

Expected: clean `main`, feature commits present, and local web/quant engine health checks remain 200.
