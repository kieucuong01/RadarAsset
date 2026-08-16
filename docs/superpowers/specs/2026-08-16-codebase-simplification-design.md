# Codebase Simplification Design

**Date:** 2026-08-16  
**Status:** Approved for planning  
**Scope:** Developer experience, dead-code removal, and incremental modularization

## Context

The application builds and its main TypeScript and Python test suites pass, but routine work is
slower than necessary. The repository contains proven dead UI code and dependencies, several files
above 1,000 lines, a hand-assembled lint configuration that conflicts with Next.js conventions,
and Python tests that depend on the caller's working directory and `PYTHONPATH`.

The current verified baseline is:

- `npm run build`: pass
- `npx tsc --noEmit`: pass
- `npm test`: 443 tests pass
- Python tests from `quant-worker`: 616 pass, 28 skip
- `npm run lint`: fails on line-ending formatting and emits irrelevant Fast Refresh warnings

This design uses an incremental modular-monolith approach. It does not replace Next.js, Prisma,
PostgreSQL, or the Python worker, and it does not change product behavior or financial data.

## Goals

1. Remove code and dependencies with no production consumer.
2. Make build, lint, formatting, TypeScript, and Python tests runnable from the repository root.
3. Reduce the responsibility and change surface of the largest files.
4. Establish explicit feature boundaries without a repository-wide path rewrite.
5. Preserve all API contracts, database behavior, tenant isolation, backtest results, and visible UI.
6. Keep every cleanup batch independently verifiable and reversible through Git.

## Non-goals

- No framework migration or new application framework.
- No database schema or migration changes unless a later correctness task explicitly requires one.
- No redesign of the user-facing interface.
- No strategy, optimizer, ingestion, or Smart Insights behavior changes.
- No speculative interfaces, factories, plugin systems, or shared abstractions with one consumer.
- No Graphify runtime integration; generated graph artifacts remain local development evidence.
- No bulk deletion of historical documents before active decisions are consolidated.

## Approach

### Phase 1: Proven-safe deletion and tooling

Delete these unreferenced shadcn component files:

- `aspect-ratio.tsx`
- `breadcrumb.tsx`
- `calendar.tsx`
- `carousel.tsx`
- `chart.tsx`
- `checkbox.tsx`
- `collapsible.tsx`
- `context-menu.tsx`
- `drawer.tsx`
- `form.tsx`
- `hover-card.tsx`
- `input-otp.tsx`
- `menubar.tsx`
- `navigation-menu.tsx`
- `pagination.tsx`
- `radio-group.tsx`
- `resizable.tsx`
- `sidebar.tsx`
- `switch.tsx`
- `textarea.tsx`
- `tooltip.tsx`

Delete these Smart Insights components because they have no production import and contain obsolete
sample or prototype presentation:

- `LegacyWatchlist.tsx`
- `LegacyInvestorIntelligence.tsx`
- `LegacyExpertSignals.tsx`
- `LegacyAIDigest.tsx`

Remove direct dependencies that are unused after those files are deleted. The candidate set must be
rechecked with source search and a clean install before package changes are committed:

- `@hookform/resolvers`
- `@radix-ui/react-aspect-ratio`
- `@radix-ui/react-checkbox`
- `@radix-ui/react-collapsible`
- `@radix-ui/react-context-menu`
- `@radix-ui/react-hover-card`
- `@radix-ui/react-menubar`
- `@radix-ui/react-navigation-menu`
- `@radix-ui/react-radio-group`
- `@radix-ui/react-switch`
- `@radix-ui/react-tooltip`
- `date-fns`
- `echarts`
- `echarts-for-react`
- `embla-carousel-react`
- `input-otp`
- `react-day-picker`
- `react-hook-form`
- `react-resizable-panels`
- `vaul`

Replace the custom ESLint composition with the installed Next.js Core Web Vitals flat config.
Formatting is checked separately with Prettier rather than executed as an ESLint rule. Remove the
now-redundant direct lint dependencies only after the replacement config passes.

Add root-level scripts with one canonical responsibility:

- `lint`: source lint only
- `format:check`: formatting verification only
- `typecheck`: TypeScript verification
- `test`: Vitest
- `test:python`: Python tests from the root without manual `PYTHONPATH`
- `check`: lint, format check, typecheck, Vitest, and Python tests

Python test discovery and import paths must be declared in project configuration rather than in a
developer's shell. Tests that open repository files must resolve paths relative to the test file or
repository root, never the process working directory.

### Phase 2: Server and worker boundaries

**Backend repository boundary: complete. Python worker split: complete.**

Split `src/lib/backend/db.ts` by existing business responsibility:

```text
src/lib/backend/
  portfolio-repository.ts
  market-repository.ts
  research-repository.ts
  quant-run-repository.ts
  strategy-forward-repository.ts
  db-mappers.ts
```

Route handlers should import the owning repository directly. During migration, `db.ts` may remain
as a temporary re-export facade so batches can be small. The facade is removed after all consumers
move. Shared code is limited to pure database mappers used by at least two repositories.

Split `quant-worker/worker.py` into:

```text
quant-worker/
  worker.py                 # CLI and process loop only
  backtest/
    run_contracts.py        # immutable queued-run contracts and repository protocol
    run_repository.py       # claim, lease, checkpoint, finish
    run_execution.py        # dataset loading and run orchestration
```

The existing `backtest` and `smart_insights` packages remain separate domains. The worker split must
preserve leasing, cancellation, timeout, retries, cache semantics, and result checksums.

### Phase 3: Frontend and localization boundaries

**Localization dictionary and all planned large-screen splits are complete: `StrategyLab`,
`PortfolioBacktestBuilder`, `MockPortfolio`, `PortfolioOptimizerWorkbench`, and
`BacktestAdvancedAnalysis`.**

Split only components that exceed roughly 600 lines or combine data loading, mutations, state, and
multiple visual panels. The first targets are:

- `StrategyLab.tsx`
- `PortfolioBacktestBuilder.tsx`
- `MockPortfolio.tsx`
- `PortfolioOptimizerWorkbench.tsx`
- `BacktestAdvancedAnalysis.tsx`

Each screen keeps one top-level orchestrator. Extract a child only when it is a visible panel or a
stateful workflow with a clear input/output contract. Do not create generic form, chart, repository,
or hook abstractions solely to reduce line counts.

Split the localization dictionary by domain and locale:

```text
src/lib/i18n/
  dictionaries/
    vi/
      common.ts
      portfolio.ts
      quant.ts
      smart-insights.ts
    en/
      common.ts
      portfolio.ts
      quant.ts
      smart-insights.ts
  dictionary.ts            # composition, locale normalization, translate
```

Translation keys and the public `translate` API remain stable. Domain dictionaries must have
compile-time parity between Vietnamese and English.

### Phase 4: Documentation consolidation

Create `docs/architecture.md` as the current source of truth for:

- Next.js request and authentication boundaries
- Prisma/PostgreSQL ownership and tenant scoping
- market-data ingestion and immutable dataset publication
- backtest and optimizer execution
- Smart Insights collection and publication
- local development and verification commands

Review the 75 historical files under `docs/superpowers`. A document may be deleted only when its
still-valid decisions are present in `docs/architecture.md`, a current runbook, or an ADR. Active
runbooks and verification evidence stay in place. Moving old files to another folder without
reducing ambiguity is not considered simplification.

## Data flow and dependency rules

```text
React screen -> typed client -> Next API route -> domain repository/service -> Prisma
                                             -> private Python engine when required

Scheduled script -> Python collector/worker -> PostgreSQL immutable datasets/artifacts
```

- UI components do not import Prisma or server repositories.
- API routes remain thin: authenticate, validate, call one domain entry point, map errors.
- Repository modules own Prisma queries and tenant predicates.
- Pure financial calculations remain outside repositories and have deterministic tests.
- Python CLI files parse arguments and invoke package functions; they do not contain domain logic.
- Cross-domain imports must use a public contract rather than another domain's private helper.

## Error handling

- Existing public error codes and HTTP statuses remain unchanged during refactoring.
- Deleting UI primitives must not replace working controls with ad-hoc HTML unless the native
  element provides equivalent accessibility and behavior.
- Python root commands must fail with actionable dependency or environment messages, not import
  stack traces caused by the current working directory.
- A cleanup batch is rejected if it changes generated backtest checksums, portfolio calculations,
  tenant filters, or dataset eligibility.

## Verification strategy

Every implementation batch must run the checks relevant to its surface. The final gate is:

```powershell
npm ci
npm run check
npm run build
```

Additional requirements:

- Verify deleted files have no imports before deletion and no references afterward.
- Verify removed packages are absent from production imports and `package-lock.json` is consistent.
- Run tenant and integration tests when backend repositories move.
- Run worker lifecycle, backtest golden, optimizer, and ingestion tests when Python modules move.
- Run targeted component tests and one authenticated browser smoke when large screens are split.
- Compare representative backtest checksums and API response fixtures before and after refactoring.

## Delivery sequence

Use small commits in this order:

1. Remove dead UI and Legacy components.
2. Remove unused runtime dependencies.
3. Standardize ESLint, Prettier, TypeScript, and Python root commands.
4. Split backend repositories one domain at a time.
5. Split Python worker lifecycle and execution.
6. Split localization dictionaries.
7. Split large UI screens one screen at a time.
8. Consolidate architecture documentation and remove superseded plans.

Do not combine database repository moves, Python worker moves, and UI restructuring in one commit.

## Success criteria

- Production behavior and public contracts are unchanged.
- All verification commands run from the repository root.
- Build, lint, formatting, TypeScript, Vitest, and Python tests pass.
- At least 3,300 proven-dead source lines and their exclusive dependencies are removed in Phase 1.
- `db.ts` is eliminated or reduced to a temporary facade with no business implementation.
- `worker.py` is a thin CLI/process loop rather than the backtest implementation.
- Translation content is organized by domain with Vietnamese/English parity checks.
- Current architecture can be understood from one maintained document without reading historical
  implementation plans.
