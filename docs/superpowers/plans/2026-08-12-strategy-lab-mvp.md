# Strategy Lab MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Strategy Lab between Portfolio Optimizer and Backtest where users can learn the available strategies, create safe visual rule drafts, save them locally, and hand executable technical presets to the existing portfolio backtest builder.

**Architecture:** Keep the immutable execution catalog unchanged and add an educational metadata layer keyed by catalog code/version. Represent user rules with a versioned Zod-validated discriminated union; only catalog-backed technical presets are executable in this MVP, while scheduled DCA, price-threshold, and fundamental rules carry explicit readiness states. QuantLab owns the selected preset and passes it into BacktestWorkbench so the existing builder applies it to subsequently selected compatible assets.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod 4, shadcn/Radix UI, Tailwind CSS 4, Vitest.

## Global Constraints

- Do not add a new runtime dependency.
- Do not mutate existing immutable strategy hashes or claim unsupported engine capability.
- Fundamental rules remain blocked until point-in-time financial data exists.
- Browser persistence must be versioned, validated, tenant-neutral, and contain no credentials or server data.
- All user-visible copy is Vietnamese-first and must distinguish executable presets from saved design drafts.

---

### Task 1: Strategy education and custom-rule domain model

**Files:**

- Create: `src/lib/strategy-lab/library.ts`
- Create: `src/lib/strategy-lab/library.test.ts`
- Create: `src/lib/strategy-lab/custom-strategy.ts`
- Create: `src/lib/strategy-lab/custom-strategy.test.ts`

**Interfaces:**

- Consumes: `STRATEGY_CATALOG` and `normalizeStrategyParameters()` from `src/lib/backtest/strategy-catalog.ts`.
- Produces: `listStrategyLibrary()`, `normalizeCustomStrategy()`, `describeCustomStrategy()`, `customStrategyReadiness()`, `parseStoredCustomStrategies()`, and `serializeCustomStrategies()`.

- [ ] **Step 1: Write failing library coverage tests**

```ts
expect(listStrategyLibrary()).toHaveLength(STRATEGY_CATALOG.length);
expect(listStrategyLibrary().every((entry) => entry.family === "technical")).toBe(true);
expect(listStrategyLibrary().find((entry) => entry.code === "ma_crossover")).toMatchObject({
  thesis: expect.any(String),
  entryRule: expect.any(String),
  exitRule: expect.any(String),
  risks: expect.any(Array),
});
```

- [ ] **Step 2: Run the library test and verify RED**

Run: `npm test -- src/lib/strategy-lab/library.test.ts`
Expected: FAIL because `library.ts` does not exist.

- [ ] **Step 3: Implement the educational metadata map**

Create one guide per immutable catalog entry, fail fast when a guide is missing, and return catalog execution fields together with thesis, style, entry rule, exit rule, ideal conditions, risks, and data requirements.

- [ ] **Step 4: Run the library test and verify GREEN**

Run: `npm test -- src/lib/strategy-lab/library.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing custom-rule validation and persistence tests**

```ts
expect(normalizeCustomStrategy(validCatalogPreset).readiness).toBe("executable");
expect(customStrategyReadiness(validDcaRule).status).toBe("engine_required");
expect(customStrategyReadiness(validFundamentalRule).status).toBe("data_required");
expect(() => normalizeCustomStrategy({ ...validDcaRule, amount: 0 })).toThrow();
expect(parseStoredCustomStrategies("not-json")).toEqual([]);
expect(parseStoredCustomStrategies(serializeCustomStrategies([validCatalogPreset]))).toHaveLength(
  1,
);
```

- [ ] **Step 6: Run the custom-rule test and verify RED**

Run: `npm test -- src/lib/strategy-lab/custom-strategy.test.ts`
Expected: FAIL because `custom-strategy.ts` does not exist.

- [ ] **Step 7: Implement the versioned custom-rule schema**

Use `z.discriminatedUnion("kind", ...)` for `catalog_preset`, `scheduled_dca`, `price_threshold`, and `fundamental_threshold`. Normalize symbol/name casing, validate catalog parameters through the canonical catalog validator, derive a Vietnamese summary, and ignore malformed/old storage payloads.

- [ ] **Step 8: Run Task 1 tests and verify GREEN**

Run: `npm test -- src/lib/strategy-lab/library.test.ts src/lib/strategy-lab/custom-strategy.test.ts`
Expected: PASS.

### Task 2: Backtest preset handoff contract

**Files:**

- Modify: `src/lib/backtest/preselection.ts`
- Modify: `src/lib/backtest/preselection.test.ts`
- Modify: `src/lib/backtest/builder-state.ts`
- Modify: `src/lib/backtest/builder-state.test.ts`
- Modify: `src/components/BacktestWorkbench.tsx`
- Modify: `src/components/PortfolioBacktestBuilder.tsx`

**Interfaces:**

- Consumes: executable `CatalogStrategyPreset` from Task 1.
- Produces: `normalizeBacktestStrategyPreset()` and a builder preset that applies canonical strategy fields to newly added compatible assets.

- [ ] **Step 1: Write failing preset normalization tests**

```ts
expect(normalizeBacktestStrategyPreset(validPreset)).toEqual(validPreset);
expect(normalizeBacktestStrategyPreset({ ...validPreset, strategyCode: "unknown" })).toBeNull();
```

- [ ] **Step 2: Run the preselection test and verify RED**

Run: `npm test -- src/lib/backtest/preselection.test.ts`
Expected: FAIL because `normalizeBacktestStrategyPreset` does not exist.

- [ ] **Step 3: Implement canonical preset normalization**

Validate catalog code/version and normalize parameters. Return `null` for malformed, unknown, or incompatible objects instead of leaking an exception into the client UI.

- [ ] **Step 4: Write failing builder reducer test**

Add an asset using a compatible selected preset and assert the resulting leg contains the preset code, version, name, parameter schema, and normalized parameter values.

- [ ] **Step 5: Run the builder-state test and verify RED**

Run: `npm test -- src/lib/backtest/builder-state.test.ts`
Expected: FAIL because the preset application action/helper does not exist.

- [ ] **Step 6: Implement minimal preset application in the existing builder path**

Pass an optional preset through `BacktestWorkbench` and `PortfolioBacktestBuilder`; when the user adds an asset, use the preset only if market/timeframe support it, otherwise fall back to the first compatible catalog strategy and show a clear warning.

- [ ] **Step 7: Run Task 2 tests and verify GREEN**

Run: `npm test -- src/lib/backtest/preselection.test.ts src/lib/backtest/builder-state.test.ts`
Expected: PASS.

### Task 3: Strategy Lab user interface

**Files:**

- Create: `src/components/StrategyLab.tsx`
- Modify: `src/components/QuantLab.tsx`

**Interfaces:**

- Consumes: Task 1 library/domain functions and Task 2 preset type.
- Produces: `StrategyLab({ onUsePreset })`, a new `strategies` QuantLab tab, local browser drafts, and a visible workflow from optimizer to mock-portfolio monitoring.

- [ ] **Step 1: Add the new `strategies` tab state expectation**

Extend the pure tab type/normalizer tests so `strategies` is accepted while symbol handoff still opens `backtest`.

- [ ] **Step 2: Run the preselection test and verify RED**

Run: `npm test -- src/lib/backtest/preselection.test.ts`
Expected: FAIL until tab typing/normalization supports `strategies`.

- [ ] **Step 3: Implement the Strategy Lab composition**

Compose existing `Tabs`, `Card`, `Badge`, `Alert`, `Accordion`, `Field`, `Input`, `Select`, `ToggleGroup`, and `Button` components. Include Library, Build Strategy, and My Strategies; filter by family/search; provide full explanations; save/delete validated drafts; disable unsupported backtest actions with readiness copy; and use `onUsePreset` only for executable catalog-backed drafts.

- [ ] **Step 4: Wire Strategy Lab between Optimizer and Backtest**

Add a lazy-loaded `StrategyLab`, insert the tab trigger between optimizer and backtest, keep the selected executable preset in QuantLab state, and switch to Backtest when the user clicks `Dùng trong Backtest`.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- src/lib/strategy-lab src/lib/backtest/preselection.test.ts src/lib/backtest/builder-state.test.ts`
Expected: PASS.

### Task 4: Verification, documentation, and local delivery

**Files:**

- Modify: `docs/superpowers/plans/2026-08-12-strategy-lab-mvp.md`

**Interfaces:**

- Consumes: completed Tasks 1–3.
- Produces: verified branch commit and a local service on port 3100.

- [ ] **Step 1: Run the complete unit suite**

Run: `npm test`
Expected: all tests pass with zero failures.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: exit code 0.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: Next.js build exits 0.

- [ ] **Step 4: Review diff and scope**

Run: `git status --short && git diff --check && git diff --stat`
Expected: only Strategy Lab, preset handoff, tests, and this plan are changed; no whitespace errors.

- [ ] **Step 5: Commit the verified feature branch**

```bash
git add docs/superpowers/plans/2026-08-12-strategy-lab-mvp.md src/components/StrategyLab.tsx src/components/QuantLab.tsx src/components/BacktestWorkbench.tsx src/components/PortfolioBacktestBuilder.tsx src/lib/strategy-lab src/lib/backtest/preselection.ts src/lib/backtest/preselection.test.ts src/lib/backtest/builder-state.ts src/lib/backtest/builder-state.test.ts
git commit -m "feat: add strategy lab workflow"
```

- [ ] **Step 6: Restart and smoke-test port 3100**

Stop only the process listening on port 3100, start `npm run dev` from the delivered checkout, request `http://localhost:3100/`, and confirm HTTP 200. Browser-authenticated QA remains a separate proof if the page requires a signed-in session.
