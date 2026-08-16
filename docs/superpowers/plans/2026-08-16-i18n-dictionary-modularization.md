# I18n Dictionary Modularization Plan

> **Execution:** Use `superpowers:executing-plans`; preserve every existing key and rendered string.

**Goal:** Replace the 1,942-line bilingual dictionary catch-all with domain dictionaries while keeping the `translate`, `TranslationKey`, locale persistence, and UI behavior unchanged.

**Architecture:** Compose four domain objects per locale: `common`, `portfolio`, `quant`, and `smart-insights`. Vietnamese is the canonical key shape; each English domain must satisfy the same recursive shape at compile time. `dictionary.ts` remains the stable public API and composition layer.

## Constraints

- No translation copy changes, key renames, component changes, dependencies, or runtime fallback changes.
- Preserve `LOCALES`, `DEFAULT_LOCALE`, `Locale`, `TranslationKey`, `normalizeLocale`, `translate`, and `dictionaries` exports.
- Domain ownership:
  - common: `header`, `routes`, `dataStatus`, `common`
  - smart-insights: `overview`
  - portfolio: `portfolio`
  - quant: `quant`, `optimizer`, `strategyLab`, `factorLab`, `backtestResults`, `backtest`
- Keep the public dictionary type derived from the composed Vietnamese dictionary.

### Task 1: Add parity and boundary tests

- [ ] Extend dictionary tests to recursively assert VI/EN key parity.
- [ ] Add a source boundary test requiring the eight locale/domain files and keeping `dictionary.ts` below 100 lines.
- [ ] Run targeted Vitest and confirm the boundary test fails before extraction.

### Task 2: Extract Vietnamese dictionaries

- [ ] Create `dictionaries/vi/common.ts`, `portfolio.ts`, `quant.ts`, and `smart-insights.ts` by moving object literals unchanged.
- [ ] Create `dictionaries/types.ts` with the recursive string-shape utility.
- [ ] Compose Vietnamese domains in `dictionary.ts` and run typecheck plus targeted tests.
- [ ] Commit `refactor: split vietnamese i18n dictionaries`.

### Task 3: Extract English dictionaries with compile-time parity

- [ ] Create the matching four English files.
- [ ] Apply `satisfies DictionaryShape<typeof viDomain>` to every English domain.
- [ ] Compose English domains without changing public exports.
- [ ] Run targeted dictionary/Quant copy tests and typecheck.
- [ ] Commit `refactor: split english i18n dictionaries`.

### Task 4: Verify and integrate

- [ ] Run `npm run check`, production build, `git diff --check`, and confirm no rendered copy changed via a serialized dictionary snapshot comparison.
- [ ] Update the simplification design, merge into local `main`, and remove only this task's branch/worktree.
