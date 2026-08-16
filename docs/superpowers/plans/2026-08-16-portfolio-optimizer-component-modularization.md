# Portfolio Optimizer Component Modularization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `PortfolioOptimizerWorkbench.tsx` from roughly 720 lines to a focused state and request orchestrator while preserving asset selection, optimizer methods, validation metrics, allocation chart, risk-return chart, correlation matrix, and allocation breakdown.

**Architecture:** Keep initial-symbol loading, optimizer state, proposal invalidation, request execution, and dashboard-model derivation in `PortfolioOptimizerWorkbench.tsx`. Extract a controlled configuration panel and a results panel under `src/components/portfolio-optimizer/`; keep the chart/table presentation in a sibling visualization module so result composition remains readable.

**Tech Stack:** React 19, Next.js 16, TypeScript, Recharts, Vitest, existing optimizer contracts, i18n, and financial formatting utilities.

## Global Constraints

- Preserve the workbench public props, current optimizer request payload, method defaults, proposal invalidation, and initial-symbol behavior.
- Preserve all translated copy, element IDs, Tailwind classes, chart configuration, formatted values, and responsive layout.
- Keep `getQuantAssets` and `requestOptimizedAllocation` in the orchestrator only.
- Do not add dependencies, contexts, generic hooks, algorithm changes, or UI redesign.
- Keep the orchestrator below 240 lines and every extracted file below 380 lines.

---

### Task 1: Add characterization and boundary gates

**Files:**
- Create: `src/components/portfolio-optimizer/component-boundaries.test.ts`
- Modify: `src/components/PortfolioOptimizerWorkbench.test.tsx`

**Interfaces:**
- Consumes: current static-render proposal fixture and source modules.
- Produces: regression checks for visible result sections, line budgets, required modules, and remote-client ownership.

- [ ] **Step 1: Write a failing boundary test** requiring `OptimizerConfigurationPanel`, `OptimizerResultsPanel`, and `OptimizerVisualizations`, limiting the orchestrator to 240 lines, and forbidding remote optimizer/asset calls in child modules.
- [ ] **Step 2: Run** `npx vitest run src/components/portfolio-optimizer/component-boundaries.test.ts src/components/PortfolioOptimizerWorkbench.test.tsx` **and verify RED** for missing modules and oversized orchestrator.
- [ ] **Step 3: Extend static-render assertions** for result summary, allocation, risk-return, correlation, and allocation-details sections.
- [ ] **Step 4: Commit** with `test: guard portfolio optimizer boundaries`.

### Task 2: Extract the controlled configuration panel

**Files:**
- Create: `src/components/portfolio-optimizer/OptimizerConfigurationPanel.tsx`
- Modify: `src/components/PortfolioOptimizerWorkbench.tsx`

**Interfaces:**
- Consumes: timeframe/range/method/targets/risk tolerance/max weight/assets/loading plus explicit change, add, remove, and optimize callbacks.
- Produces: unchanged configuration card with no network or proposal state ownership.

- [ ] **Step 1: Move timeframe, dates, method-specific controls, maximum weight, asset picker/list, and run button markup unchanged.**
- [ ] **Step 2: Pass primitive controlled values and callbacks; keep every callback responsible for proposal invalidation in the orchestrator.**
- [ ] **Step 3: Run focused tests, ESLint, and TypeScript and verify GREEN.**
- [ ] **Step 4: Commit** with `refactor: extract optimizer configuration panel`.

### Task 3: Extract results and visualizations

**Files:**
- Create: `src/components/portfolio-optimizer/OptimizerResultsPanel.tsx`
- Create: `src/components/portfolio-optimizer/OptimizerVisualizations.tsx`
- Modify: `src/components/PortfolioOptimizerWorkbench.tsx`
- Modify: `src/lib/i18n/quant-copy.test.ts`
- Modify: `src/lib/financial-format-adoption.test.ts`

**Interfaces:**
- Consumes: `OptimizerProposal | null` and `OptimizerDashboardModel | null` from the orchestrator.
- Produces: unchanged result status, metrics, validation cards, charts, correlation table, allocation breakdown, and observation/source footer.

- [ ] **Step 1: Move pure chart/table components and tooltip formatting to `OptimizerVisualizations.tsx`.**
- [ ] **Step 2: Move result card composition and empty state to `OptimizerResultsPanel.tsx`.**
- [ ] **Step 3: Add extracted files to Quant copy and financial formatter adoption tests.**
- [ ] **Step 4: Run focused rendering, formatter, i18n, ESLint, and TypeScript checks and verify GREEN.**
- [ ] **Step 5: Commit** with `refactor: extract optimizer results and charts`.

### Task 4: Verify, document, and integrate

**Files:**
- Modify: `docs/superpowers/specs/2026-08-16-codebase-simplification-design.md`

**Interfaces:**
- Consumes: all extracted modules and repository verification scripts.
- Produces: verified local-main merge and current local server on port 3100.

- [ ] **Step 1: Run** `npm run check` **and require lint, formatting, TypeScript, Vitest, and Python success.**
- [ ] **Step 2: Mark `PortfolioOptimizerWorkbench` complete in the simplification design and commit.**
- [ ] **Step 3: Merge locally into `main`, rerun the full check, and run `npm run build`.**
- [ ] **Step 4: Remove only this worktree/branch, restart `npm run dev:web`, and verify `/quant-lab` returns the expected authenticated redirect or page.**

