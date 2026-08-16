# Backtest Advanced Analysis Modularization Plan

**Goal:** Reduce `BacktestAdvancedAnalysis.tsx` from roughly 590 lines to a focused mutation and tab orchestrator while preserving reports, robustness diagnostics, portfolio contribution, cash-flow events, per-leg equity, strategy apply, and completed trades.

**Architecture:** Keep strategy-assignment mutation, QuantStats download, active-leg state, availability derivation, and tab composition in the top-level component. Extract three visible presentation domains under `src/components/backtest-results/advanced/`: summary/robustness, aggregate portfolio analysis, and per-leg analysis.

**Constraints:** Preserve public props, request payload, loading behavior, translated copy, chart configuration, formatting, Tailwind classes, and tab structure. Do not add dependencies or change backtest calculations.

## Task 1: Add characterization and boundary gates

- Create a boundary test requiring `AdvancedAnalysisSummary`, `AggregatePortfolioAnalysis`, and `BacktestLegAnalysis`.
- Limit the orchestrator to 220 lines and each child to 360 lines.
- Keep `fetch`, `toast`, and strategy-assignment normalization in the orchestrator only.
- Add source-level regression checks for report, robustness, contribution, cash-flow, equity, apply, and trade sections.

## Task 2: Extract summary and robustness

- Move survivorship warning, availability badges, QuantStats report card, and robustness diagnostics/table into `AdvancedAnalysisSummary`.
- Pass only the aggregate model, availability, currency/locale context where needed, and the download callback.

## Task 3: Extract aggregate and leg analysis

- Move portfolio contribution chart/table and cash-flow/rebalance events into `AggregatePortfolioAnalysis`.
- Move per-leg equity chart, parameters, apply action, and completed trades into `BacktestLegAnalysis`.
- Keep the tab list and mapping in the orchestrator.
- Add new files to i18n and financial-format adoption gates.

## Task 4: Verify and integrate

- Run focused Vitest, ESLint, TypeScript, then `npm run check`.
- Mark `BacktestAdvancedAnalysis` complete in the simplification design.
- Merge locally into `main`, rerun `npm run check`, run `npm run build`, and restart port 3100.
