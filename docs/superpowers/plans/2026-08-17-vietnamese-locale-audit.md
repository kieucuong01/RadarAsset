# Vietnamese Locale Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the application locale is Vietnamese, every user-facing application string uses natural Vietnamese while technical identifiers, provider names, and raw audit values remain unchanged.

**Architecture:** First inventory locale providers and all user-facing text in `src`, tests, routes, and data contracts. Then centralize missing copy in the existing locale dictionary rather than adding one-off conditional strings. Finally verify both Vietnamese and English renders, static source coverage, and production build behavior.

**Tech Stack:** Next.js 16, React 19, TypeScript, existing locale/i18n helpers, Vitest, Playwright, ESLint, Prettier.

## Global Constraints

- Vietnamese is the default copy only when the active locale is Vietnamese; English remains unchanged.
- Do not translate tickers, provider/source names, API fields, enum values, URLs, code, or raw financial data labels that must remain interoperable.
- Prefer the existing translation helper/dictionary and preserve formatting, accessibility labels, and loading/error semantics.
- Do not modify unrelated portfolio, market-data, or deployment behavior.

---

### Task 1: Inventory locale surface and build the source map

**Files:**

- Inspect: `src/**/*.{ts,tsx}`, `e2e/**/*.{ts,tsx}`, `scripts/**/*.{ts,mjs}`, locale files, and `graphify-out/graph.json`
- Create: `docs/verification/2026-08-17-vietnamese-locale-audit.md`

**Interfaces:**

- Produces a categorized list of hard-coded UI English, missing dictionary keys, and intentional technical English.

- [x] **Step 1: Run the deterministic source scan**

```powershell
rg -n --glob 'src/**/*.{ts,tsx}' --glob 'e2e/**/*.{ts,tsx}' --glob 'scripts/**/*.{ts,mjs}' "\b(Loading|Unavailable|Error|Refresh|Retry|Search|Settings|Overview|Holdings|Risk|Performance|Trade|Buy|Sell|Save|Cancel|Delete|Close|Date|Price|Quantity|Currency|Source|Status|Daily|Weekly|Monthly|Confidence|Action|Insight|Analysis)\b" .
```

- [x] **Step 2: Map results to locale helpers and screen ownership**

Record each result as `must translate`, `already localized`, or `technical/keep`, including the owning route/component and the replacement dictionary key.

- [x] **Step 3: Run source-level graph inspection**

Use the existing `graphify-out/graph.json` to identify locale providers, shared UI components, and route entry points before editing.

- [x] **Step 4: Save the audit evidence**

Write the categorized inventory and expected test matrix to `docs/verification/2026-08-17-vietnamese-locale-audit.md`.

### Task 2: Complete Vietnamese dictionary and shared copy adapters

**Files:**

- Modify: existing locale dictionary/provider files identified in Task 1
- Test: adjacent locale/unit tests or create `src/lib/i18n.test.ts` when no coverage exists

**Interfaces:**

- Produces complete Vietnamese keys for shared navigation, status, actions, empty/loading/error states, dates, portfolio, Smart Insights, Quant Lab, and data-source panels.

- [x] **Step 1: Add failing assertions for every missing shared key**

Assert that the Vietnamese dictionary returns a non-English value for each key and that English values remain unchanged.

- [x] **Step 2: Add the minimum dictionary entries and typed key definitions**

Use the project’s existing locale shape; do not create a second translation mechanism.

- [x] **Step 3: Replace shared hard-coded English with dictionary calls**

Update shared layout, navigation, buttons, badges, table headers, modals, charts, tooltips, and error boundaries to consume the dictionary.

- [x] **Step 4: Run focused i18n tests and lint**

```powershell
npm test -- --runInBand src/lib/i18n.test.ts
npm run lint
```

### Task 3: Localize page-specific and data-state UI

**Files:**

- Modify: Smart Insights, Mock Portfolio, Quant Lab, Market Pulse, Macro/Gold, auth/onboarding, and shared chart/table components found in Task 1
- Test: colocated `*.test.tsx` files and relevant e2e specs

**Interfaces:**

- Vietnamese render contains no accidental English UI copy, while tickers, source names, and technical raw values stay intact.

- [x] **Step 1: Add render assertions for representative Vietnamese routes**

Cover `/smart-insights`, `/portfolio`, `/quant-lab`, and the main dashboard with loading, empty, error, and populated states.

- [x] **Step 2: Replace page-specific English strings**

Translate copy in the component owner; pass translated labels into charts and tables instead of translating inside data contracts.

- [x] **Step 3: Verify accessibility names and controls**

Ensure translated `aria-label`, dialog titles, button text, and status announcements match visible copy.

- [x] **Step 4: Run focused component checks and local browser smoke**

```powershell
npm test -- --run src/components src/app
```

### Task 4: Whole-project verification and handoff

**Files:**

- Modify: `docs/verification/2026-08-17-vietnamese-locale-audit.md` with final evidence

**Interfaces:**

- Produces a clean verification report with remaining intentional English and zero accidental Vietnamese-locale regressions.

- [x] **Step 1: Run static accidental-English scan**

Review all matches rather than blindly translating technical identifiers.

- [x] **Step 2: Run full quality gates**

```powershell
npm run format:check
npm run typecheck
npm run lint
npm test
npm run test:python
npm run build
```

- [x] **Step 3: Smoke-test Vietnamese and English locally**

Open the primary dashboard, Smart Insights, and Portfolio routes in both locales and record HTTP/browser console results.

- [x] **Step 4: Report exact scope and intentional English**

Document translated surfaces, unchanged provider/technical terms, test results, and any follow-up that is outside this task.
