# Mock Portfolio Component Modularization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `MockPortfolio.tsx` from roughly 840 lines to a focused data-loading and mutation orchestrator while preserving all current portfolio, chart, holding, risk, strategy-forward, transaction, localization, and responsive behavior.

**Architecture:** Keep portfolio fetching, cache invalidation, timeframe ownership, loading/error state, and composition in `MockPortfolio.tsx`. Move each visible portfolio section to a controlled component under `src/components/mock-portfolio/`; extracted components receive typed portfolio data and callbacks and never call the portfolio API directly.

**Tech Stack:** React 19, Next.js 16, TypeScript, Recharts, Vitest, existing i18n and financial formatting utilities.

## Global Constraints

- Preserve the `MockPortfolio` public API, UI copy, Tailwind classes, element hierarchy, responsive behavior, and chart configuration.
- Preserve portfolio cache, timeframe reload, transaction callbacks, currencies, PnL precision, and simulated-data labels.
- Keep `getCachedPortfolio` and `clearCachedPortfolio` imports in `MockPortfolio.tsx` only.
- Do not add dependencies, contexts, generic hooks, design changes, or business behavior.
- Keep `MockPortfolio.tsx` below 260 lines and every extracted component below 360 lines.

---

### Task 1: Guard the component boundaries

**Files:**

- Create: `src/components/mock-portfolio/component-boundaries.test.ts`
- Modify: `src/components/PortfolioNumberFormatting.test.tsx`

**Interfaces:**

- Consumes: current `MockPortfolio` static render and portfolio response fixtures.
- Produces: line-budget, file-ownership, client-import, and visible-section regression gates.

- [ ] **Step 1: Write the failing boundary test** requiring `PortfolioHeader`, `PortfolioOverviewPanel`, `PortfolioHoldingsTable`, `PortfolioRiskMetrics`, and `PortfolioTransactionLog`, limiting the orchestrator to 260 lines, and forbidding portfolio client calls in child files.
- [ ] **Step 2: Run** `npx vitest run src/components/mock-portfolio/component-boundaries.test.ts src/components/PortfolioNumberFormatting.test.tsx` **and verify RED** because files are missing and the orchestrator is oversized.
- [ ] **Step 3: Extend the existing static-render characterization** to assert the balance, allocation, performance, holdings, risk, and transaction headings remain visible.
- [ ] **Step 4: Commit** with `test: guard mock portfolio component boundaries`.

### Task 2: Extract header and overview presentation

**Files:**

- Create: `src/components/mock-portfolio/PortfolioHeader.tsx`
- Create: `src/components/mock-portfolio/PortfolioOverviewPanel.tsx`
- Modify: `src/components/MockPortfolio.tsx`

**Interfaces:**

- Consumes: `PortfolioResponse | null`, active `PortfolioTimeframe`, and `onTimeframeChange(timeframe)`.
- Produces: `PortfolioHeader` and `PortfolioOverviewPanel` with unchanged rendered markup; the overview owns only the private hide-balance toggle.

- [ ] **Step 1: Move the header and loading/error status presentation without changing output.**
- [ ] **Step 2: Move balance, allocation pie, and performance area chart into `PortfolioOverviewPanel`.**
- [ ] **Step 3: Keep timeframe state and `startTransition` in the orchestrator; pass a callback to the overview.**
- [ ] **Step 4: Run the focused tests, ESLint, and TypeScript and verify GREEN.**
- [ ] **Step 5: Commit** with `refactor: extract mock portfolio overview`.

### Task 3: Extract holdings and risk panels

**Files:**

- Create: `src/components/mock-portfolio/PortfolioHoldingsTable.tsx`
- Create: `src/components/mock-portfolio/PortfolioRiskMetrics.tsx`
- Modify: `src/components/MockPortfolio.tsx`
- Modify: `src/lib/financial-format-adoption.test.ts`

**Interfaces:**

- Consumes: typed holdings, typed risk metrics, and the active base currency.
- Produces: unchanged holdings table, sentiment badge, and risk metric cards using the existing formatter rules.

- [ ] **Step 1: Move the holdings table and private sentiment badge.**
- [ ] **Step 2: Move risk metric icon mapping and cards.**
- [ ] **Step 3: Add the new files to shared financial-formatter adoption coverage.**
- [ ] **Step 4: Run focused formatting tests, i18n tests, ESLint, and TypeScript and verify GREEN.**
- [ ] **Step 5: Commit** with `refactor: extract portfolio holdings and risk panels`.

### Task 4: Extract the transaction log and finish orchestration

**Files:**

- Create: `src/components/mock-portfolio/PortfolioTransactionLog.tsx`
- Modify: `src/components/MockPortfolio.tsx`
- Modify: `src/components/PortfolioNumberFormatting.test.tsx`
- Modify: `src/lib/financial-format-adoption.test.ts`

**Interfaces:**

- Consumes: portfolio transactions, holdings, disabled state, timeframe, base currency, and `onRecorded(portfolio)`.
- Produces: unchanged normalized transaction rows and `PortfolioTransactionDialog` workflow.

- [ ] **Step 1: Move transaction normalization and table rendering unchanged.**
- [ ] **Step 2: Remove obsolete imports and keep `MockPortfolio` as data/state/composition only.**
- [ ] **Step 3: Run all focused tests and verify boundary budgets and financial precision.**
- [ ] **Step 4: Commit** with `refactor: complete mock portfolio modularization`.

### Task 5: Verify, document, and integrate

**Files:**

- Modify: `docs/superpowers/specs/2026-08-16-codebase-simplification-design.md`

**Interfaces:**

- Consumes: all extracted components and current repository verification scripts.
- Produces: verified local-main merge and current local server on port 3100.

- [ ] **Step 1: Run** `npm run check` **and require lint, formatting, TypeScript, Vitest, and Python success.**
- [ ] **Step 2: Run** `npm run build` **from the main checkout after merge.**
- [ ] **Step 3: Update the simplification design to mark `MockPortfolio` complete and commit.**
- [ ] **Step 4: Merge the feature branch locally into `main`, remove only this worktree/branch, restart `npm run dev:web`, and verify `/portfolio` returns the expected authenticated redirect or page.**
