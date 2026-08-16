# Portfolio Backtest Builder Modularization Plan

**Goal:** Reduce `PortfolioBacktestBuilder.tsx` from roughly 870 lines to a focused workflow orchestrator while preserving portfolio setup, asset selection, optimizer controls, assumptions, validation, submission, translations, and both stacked/sidebar layouts.

**Architecture:** Keep catalog loading, initial-symbol hydration, dataset refresh, optimizer and submission mutations, reducer ownership, and toast handling in `PortfolioBacktestBuilder.tsx`. Extract the three visible configuration areas into controlled domain panels under `src/components/portfolio-backtest-builder/`. Panels render state and dispatch user intent upward; they do not fetch data or submit runs.

**Constraints:**

- Preserve current Tailwind classes, labels, element IDs, responsive behavior, and translation keys.
- Preserve the `PortfolioBacktestBuilder` public props and submission payload.
- Keep API clients and side effects in the top-level orchestrator.
- Do not add hooks, contexts, dependencies, generic form abstractions, or product behavior.
- Keep each extracted panel below 420 lines and the orchestrator below 360 lines.

## Task 1: Add characterization and boundary tests

**Files:** Modify `src/components/BacktestWorkbench.test.tsx`; create `src/components/portfolio-backtest-builder/component-boundaries.test.ts`.

- [ ] Add static-render checks for setup, allocation/cash, assumptions, validation, and run controls.
- [ ] Add a failing boundary test requiring the three panel files and enforcing line budgets.
- [ ] Assert only the orchestrator imports the asset, strategy, optimizer, and submission clients.
- [ ] Run the focused tests and confirm the boundary test fails for the intended missing files/oversized orchestrator.

## Task 2: Extract the portfolio setup panel

**Files:** Create `src/components/portfolio-backtest-builder/PortfolioSetupPanel.tsx`; modify `src/components/PortfolioBacktestBuilder.tsx` and focused tests.

- [ ] Move total capital, base currency, timeframe, and date range presentation unchanged.
- [ ] Pass `BuilderState`, `Dispatch<BuilderAction>`, and sidebar mode explicitly.
- [ ] Verify focused component tests and TypeScript.

## Task 3: Extract the allocation panel

**Files:** Create `src/components/portfolio-backtest-builder/PortfolioAllocationPanel.tsx`; modify `src/components/PortfolioBacktestBuilder.tsx` and focused tests.

- [ ] Move asset picker, allocation modes, optimizer controls, leg cards, cash controls, weight progress, and optimizer provenance.
- [ ] Keep optimizer request execution and unsupported-strategy toasts in the orchestrator.
- [ ] Preserve controlled optimizer inputs and callback semantics.
- [ ] Verify focused component and reducer tests.

## Task 4: Extract the assumptions panel

**Files:** Create `src/components/portfolio-backtest-builder/PortfolioAssumptionsPanel.tsx`; modify `src/components/PortfolioBacktestBuilder.tsx` and focused tests.

- [ ] Move rebalance, contribution, dividend/adjustment policy, FX explanation, warnings, and per-market cost inputs.
- [ ] Preserve raw/adjusted fail-closed warnings and market cost dispatches.
- [ ] Verify focused component tests and translation coverage.

## Task 5: Finish the orchestrator and verify

**Files:** Modify `src/components/PortfolioBacktestBuilder.tsx`, boundary tests, and `docs/superpowers/specs/2026-08-16-codebase-simplification-design.md`.

- [ ] Remove obsolete UI imports and keep only orchestration, derived state, actions, validation, and panel composition.
- [ ] Run focused Vitest, ESLint, Prettier, and TypeScript checks.
- [ ] Run `npm run check` and `npm run build`.
- [ ] Perform an unauthenticated auth-guard smoke and an authenticated browser smoke when a session is available.
- [ ] Update the simplification design, merge locally into `main`, and remove only this task's branch/worktree.

