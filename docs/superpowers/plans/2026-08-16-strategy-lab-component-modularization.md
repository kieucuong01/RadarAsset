# Strategy Lab Component Modularization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `StrategyLab.tsx` from 1,144 lines to a focused workflow orchestrator while preserving its three tabs, DB-backed custom strategy lifecycle, backtest handoff, translations, and visual styling.

**Architecture:** Keep API loading, persistence mutations, active tab, library filters, builder draft, and backtest handoff in `StrategyLab.tsx`; filters stay above tab content so tab switches preserve them. Move each visible tab to a domain component under `src/components/strategy-lab/`: the library panel renders controlled search/filter inputs, the builder panel owns builder presentation fields, and the saved panel renders persisted strategies and delegates edit/archive/backtest actions upward. No new hooks, contexts, dependencies, or generic component abstractions.

**Tech Stack:** React 19, Next.js 16, TypeScript, shadcn/ui, Vitest server rendering.

## Global Constraints

- Preserve all translated copy, HTML labels, Tailwind classes, tab values, toast behavior, API calls, and `StrategyLabSelection` payloads.
- Preserve the current builder normalization and persistence behavior; financial/strategy semantics are out of scope.
- `StrategyLab.tsx` remains the only module that calls Strategy Lab API clients or performs legacy migration; saved panels may use the client module's exported type contract.
- Child panels import concrete UI modules directly; do not add barrel files or `React.memo` without measured need.
- Use functional state updates and keep derived filtering in render rather than effects.
- Add no dependency and change no i18n key.

## Target File Map

**Create:**

- `src/components/strategy-lab/StrategyLibraryPanel.tsx`: catalog search, family filter, capability cards, strategy education cards.
- `src/components/strategy-lab/StrategyBuilderPanel.tsx`: exported `StrategyBuilderState`, rule fields, preview, and save controls.
- `src/components/strategy-lab/SavedStrategiesPanel.tsx`: loading/empty/active saved strategy states.
- `src/components/strategy-lab/component-boundaries.test.ts`: source guard for orchestrator size and dependency ownership.

**Modify:**

- `src/components/StrategyLab.tsx`: stateful orchestrator and tab composition only.
- `src/components/StrategyLab.test.tsx`: characterization coverage for stable headings/tabs and extracted panels.
- `src/lib/i18n/quant-copy.test.ts`: include new files in mojibake/source checks.
- `docs/superpowers/specs/2026-08-16-codebase-simplification-design.md`: record Strategy Lab split status.

---

### Task 1: Establish behavior and boundary guards

**Files:** Modify `StrategyLab.test.tsx`; create `strategy-lab/component-boundaries.test.ts`.

- [ ] Extend the static-render characterization test to assert the workflow title, all three tab labels, catalog search label, family controls, and default catalog strategy content remain present.
- [ ] Add a failing boundary test requiring the three panel files, limiting `StrategyLab.tsx` to 420 lines, and asserting only `StrategyLab.tsx` imports `@/lib/strategy-lab/client` and `legacy-migration`.
- [ ] Run `npx vitest run src/components/StrategyLab.test.tsx src/components/strategy-lab/component-boundaries.test.ts` and confirm failure is caused by missing panel files/oversized orchestrator.
- [ ] Commit `test: guard strategy lab component boundaries`.

### Task 2: Extract the strategy library panel

**Files:** Create `strategy-lab/StrategyLibraryPanel.tsx`; modify `StrategyLab.tsx`, `StrategyLab.test.tsx`, `quant-copy.test.ts`.

**Interface:**

```ts
export function StrategyLibraryPanel(props: {
  query: string;
  family: "all" | StrategyFamily;
  onQueryChange: (query: string) => void;
  onFamilyChange: (family: "all" | StrategyFamily) => void;
  onBuild: () => void;
  onCustomize: (strategyCode: string) => void;
  onUsePreset: (input: {
    code: string;
    version: string;
    parameters: Record<string, unknown>;
  }) => void;
}): React.JSX.Element;
```

- [ ] Add a direct static-render test asserting search/family/capability/catalog education content renders from the new component.
- [ ] Move `FAMILY_LABELS`, `STYLE_KEYS`, `guideKey`, query/family state, derived filtering, `CapabilityCard`, and `GuideList` unchanged.
- [ ] Replace the library tab body with `StrategyLibraryPanel`; adapt callbacks only.
- [ ] Run focused tests, typecheck, and formatting; commit `refactor: extract strategy library panel`.

### Task 3: Extract the visual strategy builder panel

**Files:** Create `strategy-lab/StrategyBuilderPanel.tsx`; modify `StrategyLab.tsx`, `StrategyLab.test.tsx`, `quant-copy.test.ts`.

**Interface:**

```ts
export type StrategyBuilderState = {
  name: string;
  symbol: string;
  kind: CustomStrategyInput["kind"];
  strategyCode: string;
  strategyParameters: Record<string, number>;
  amount: number;
  currency: "USD" | "VND";
  dayOfMonth: number;
  priceOperator: "crosses_above" | "crosses_below";
  priceValue: number;
  action: "buy" | "sell";
  sizePct: number;
  metric: "pb" | "pe" | "roe";
  fundamentalOperator: "lt" | "lte" | "gt" | "gte";
  fundamentalValue: number;
};

export function StrategyBuilderPanel(props: {
  builder: StrategyBuilderState;
  setBuilder: React.Dispatch<React.SetStateAction<StrategyBuilderState>>;
  selectedDefinition: (typeof STRATEGY_CATALOG)[number];
  saving: boolean;
  editing: boolean;
  onSelectCatalog: (strategyCode: string) => void;
  onSave: () => void;
}): React.JSX.Element;
```

- [ ] Add a direct static-render test for name/symbol/rule controls, default technical fields, preview, and save action.
- [ ] Move builder-only UI plus `BuilderPreview`, `RuleFields`, `NumberField`, `CurrencyField`, and `SelectField` unchanged.
- [ ] Keep initial state, draft construction, normalization, persistence, selected-definition lookup, and catalog-selection state update in the orchestrator.
- [ ] Replace the builder tab body with `StrategyBuilderPanel`; run focused tests/typecheck/formatting and commit `refactor: extract strategy builder panel`.

### Task 4: Extract the saved strategies panel and slim the orchestrator

**Files:** Create `strategy-lab/SavedStrategiesPanel.tsx`; modify `StrategyLab.tsx`, `StrategyLab.test.tsx`, `quant-copy.test.ts`, `component-boundaries.test.ts`.

**Interface:**

```ts
export function SavedStrategiesPanel(props: {
  strategies: CustomStrategySummary[];
  loading: boolean;
  onCreate: () => void;
  onArchive: (id: string) => void;
  onEdit: (strategy: CustomStrategySummary) => void;
  onUseBacktest: (strategy: CustomStrategySummary) => void;
}): React.JSX.Element;
```

- [ ] Add direct rendering tests for loading, empty, and active DB-backed strategy states.
- [ ] Move saved-list cards and `ReadinessBadge` unchanged; keep archive/edit/backtest mutation decisions in the parent callbacks.
- [ ] Remove unused imports/helpers from `StrategyLab.tsx`; keep the header, tabs, API lifecycle, actions, and composition.
- [ ] Make the 420-line/dependency boundary test green; run all Strategy Lab/i18n tests, typecheck, lint, and formatting.
- [ ] Commit `refactor: extract saved strategies panel`.

### Task 5: Verify and integrate

- [ ] Run `npm run check` and `npm run build` with local build-only secrets if required.
- [ ] Run an authenticated `/quant-lab` browser smoke at desktop and mobile widths, checking Strategy Lab tabs render without console errors or overflow.
- [ ] Run `git diff --check`, verify only intended files changed, update the simplification design, and commit documentation.
- [ ] Merge the feature branch into local `main`, rerun focused tests/build on the merged tree, and remove only this task's worktree/branch.
