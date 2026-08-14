# Restore Smart Insights UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore every former Smart Insights block and style while feeding it with current quantitative APIs and visibly labelling any seed fallback as `Dữ liệu mẫu`.

**Architecture:** Keep `SmartInsights.tsx` as the page orchestrator and move the former visual blocks into focused components. Reuse the current schemas and APIs, allowing local seed arrays only inside explicitly sample-labelled optional blocks.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, shadcn/ui, Vitest.

## Global Constraints

- Preserve the old block order, rounded-card language, gradient hero, spacing, and responsive grids.
- Keep Crypto, Macro, and Gold quantitative endpoints unchanged.
- Never present seed values without a visible `DataStatusBadge status="SAMPLE"` in that block.
- Do not restore the former unlabelled hard-coded market facts.
- Do not add dependencies.

---

### Task 1: Lock the restored UI contract

**Files:**

- Modify: `src/components/smart-insights/source-guard.test.ts`

**Interfaces:**

- Consumes: Smart Insights component source tree.
- Produces: regression assertions for all legacy sections, market tabs, and sample provenance.

- [ ] Add assertions for `LegacyDailyHero`, `LegacyAIDigest`, `LegacyInvestorIntelligence`,
      `LegacyMarketPulse`, `LegacyWatchlist`, and `LegacyExpertSignals`.
- [ ] Add an assertion that seed-backed source contains `status="SAMPLE"` and `Dữ liệu mẫu` remains
      provided by the existing data-status contract.
- [ ] Run the focused test and confirm it fails because the restored components do not exist.

### Task 2: Restore the old visual blocks with current data

**Files:**

- Create: `src/components/smart-insights/LegacyDailyHero.tsx`
- Create: `src/components/smart-insights/LegacyAIDigest.tsx`
- Create: `src/components/smart-insights/LegacyInvestorIntelligence.tsx`
- Create: `src/components/smart-insights/LegacyMarketPulse.tsx`
- Create: `src/components/smart-insights/LegacyWatchlist.tsx`
- Create: `src/components/smart-insights/LegacyExpertSignals.tsx`
- Modify: `src/components/SmartInsights.tsx`

**Interfaces:**

- Consumes: `BriefingModel`, `RegimeModel`, `MetricModel`, existing backend response types, and API
  routes already used by the project.
- Produces: complete legacy page anatomy with live-first data and per-block provenance labels.

- [ ] Build the gradient hero and digest from briefing/regime state.
- [ ] Restore asset intelligence and research-run loading as an isolated block.
- [ ] Restore Market Pulse with Crypto/Macro/Gold tabs, Fear & Greed/On-chain display, metric panels,
      and ticker loading.
- [ ] Restore the compact watchlist and add-asset interaction.
- [ ] Restore Expert Signals filters; show API rows as system data and fallback seed rows as sample.
- [ ] Compose all blocks in their former order and keep calendar, evidence, and data health.
- [ ] Run focused tests until green.

### Task 3: Validate behavior and presentation

**Files:**

- Modify only files from Task 2 if verification reveals a defect.

**Interfaces:**

- Consumes: local app at `http://localhost:3100` and the focused UI contracts.
- Produces: verified desktop/mobile Smart Insights surface.

- [ ] Run focused Vitest and the full frontend test suite.
- [ ] Run ESLint on the touched files and run the production build.
- [ ] Validate `/` at desktop and mobile sizes: identity, content, no overlay, console health, market-tab
      interaction, filters, and sample labels.
- [ ] Review `git diff` to confirm only Smart Insights and its design/test documentation changed.
