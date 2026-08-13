# Smart Insights Delivery Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Crypto, Macro, Gold, and the Personal Decision Cockpit in dependency order while requiring real validated data at every vertical-slice gate.

**Architecture:** Five executable plans share one immutable observation contract. Foundation comes first; Crypto provides common metric math; Macro and Gold build independent market slices; Research Workbench and the Cockpit consume only completed, evidence-backed slices.

**Tech Stack:** PostgreSQL, Prisma 7, Python worker, Firecrawl REST sidecar, approved public/official sources, Next.js App Router, React, TypeScript, Zod, pytest, Vitest.

## Global Constraints

- This roadmap coordinates the five detailed plans; their task steps are the implementation authority.
- A source family is not complete while it is fixture-only or disabled outside tests.
- Do not begin UI sample removal until the APIs can return explicit empty/unavailable states.
- Do not enable AI synthesis until evidence, number formatting, tenant access, and grounding tests pass.
- Each phase preserves unrelated working-tree changes and commits only its files.

---

## File Structure

- `docs/superpowers/plans/2026-08-13-smart-insights-data-foundation.md`: persistence, source, Firecrawl, validation, scheduler, and Data Health execution plan.
- `docs/superpowers/plans/2026-08-13-smart-insights-crypto-data.md`: Crypto collectors, metrics, signals, scoring, and replay execution plan.
- `docs/superpowers/plans/2026-08-13-smart-insights-macro-calendar.md`: CryptoCraft, official Macro data, event risk, scoring, and replay execution plan.
- `docs/superpowers/plans/2026-08-13-smart-insights-gold-data.md`: Gold source-period collectors, metrics, scoring, and replay execution plan.
- `docs/superpowers/plans/2026-08-13-smart-insights-workbench-cockpit.md`: evidence, AI grounding, personalization, APIs, UI, and end-to-end verification plan.

---

## Execution Order

| Phase | Executable plan | Entry condition | Exit gate |
|---|---|---|---|
| 1 | `2026-08-13-smart-insights-data-foundation.md` | Approved design | Migration, source registry, Firecrawl boundary, validation, repository, scheduler, and Data Health tests pass |
| 2 | `2026-08-13-smart-insights-crypto-data.md` | Phase 1 complete | Daily F&G/ETF/on-chain, weekly CoinShares, price/derivatives, Crypto regime, signals, and source smoke pass |
| 3 | `2026-08-13-smart-insights-macro-calendar.md` | Phase 1 and common Crypto metric math complete | CryptoCraft cadence/revisions, FRED/CFTC, surprise/event risk, Macro regime, and smoke pass |
| 4 | `2026-08-13-smart-insights-gold-data.md` | Phases 1–3 complete | XAU/WGC/CFTC/FRED Gold metrics, Gold regime, point-in-time replay, and smoke pass |
| 5 | `2026-08-13-smart-insights-workbench-cockpit.md` | Phases 1–4 publish real validated facts | Evidence, relevance, grounding, immutable briefing, tenant APIs, cockpit UI, browser QA, and replay pass |

---

### Task 1: Complete and verify the data foundation

- [ ] Execute every checkbox in `docs/superpowers/plans/2026-08-13-smart-insights-data-foundation.md`.
- [ ] Record passing migration, contract, Firecrawl security, repository idempotency, scheduler, and Data Health commands listed in that plan.
- [ ] Confirm raw snapshots are immutable and a failed candidate cannot overwrite the last accepted observation.
- [ ] Confirm Firecrawl is private, allow-listed, bounded, and browser clients cannot call it.

### Task 2: Complete and verify the Crypto slice

- [ ] Execute every checkbox in `docs/superpowers/plans/2026-08-13-smart-insights-crypto-data.md`.
- [ ] Confirm ETF BTC/ETH/SOL one-row-per-source-trading-date behavior.
- [ ] Confirm Fear & Greed and closed-day on-chain one-row-per-UTC-date behavior.
- [ ] Confirm CoinShares remains weekly and large-address activity is not labeled as investor buy/sell.
- [ ] Confirm the deterministic Crypto score is unavailable below 60% fresh configured-weight coverage.

### Task 3: Complete and verify Macro plus CryptoCraft Calendar

- [ ] Execute every checkbox in `docs/superpowers/plans/2026-08-13-smart-insights-macro-calendar.md`.
- [ ] Confirm current week runs every two hours, next week every twelve hours, and high-impact T-30/T+90 detail refresh runs every fifteen minutes.
- [ ] Confirm event revisions preserve original/revised actual, forecast, previous, source/display timezone, and observation time.
- [ ] Confirm Event Risk stays non-directional and separate from Macro Risk-Asset Regime.

### Task 4: Complete and verify the Gold slice

- [ ] Execute every checkbox in `docs/superpowers/plans/2026-08-13-smart-insights-gold-data.md`.
- [ ] Confirm WGC ETF/central-bank and CFTC rows retain source frequency without daily interpolation.
- [ ] Confirm cross-asset correlation/beta uses timestamp intersection with no forward-fill.
- [ ] Confirm the deterministic Gold score is unavailable below 60% fresh configured-weight coverage.

### Task 5: Complete and verify Research Workbench plus Cockpit

- [ ] Execute every checkbox in `docs/superpowers/plans/2026-08-13-smart-insights-workbench-cockpit.md`.
- [ ] Confirm evidence and grounding gates before enabling live AI synthesis.
- [ ] Confirm active tenant/user isolation for preferences, evidence, research runs, portfolios, and briefings.
- [ ] Confirm the rendered Smart Insights page contains no hard-coded runtime market facts or sample explanations.
- [ ] Confirm frozen-day replay, AI-failure degradation, independent-source failure, desktop/mobile, theme, and console/network checks.

---

## Release Gate

- [ ] Every enabled provider has bounded live-smoke evidence through its production parser and validator.
- [ ] Crypto, Macro, and Gold each publish real metric history, deterministic regime, signals, provenance, freshness, and Data Confidence.
- [ ] CryptoCraft is the visible attributed `research_only` calendar source collected through Firecrawl at the approved cadence.
- [ ] Every Workbench number is grounded; AI failure never creates a fallback market fact.
- [ ] A prior briefing replays from frozen observation IDs, formula versions, portfolio/preferences, prompt version, and model identity.
- [ ] Full worker tests, web tests, tenant tests, typecheck, build, browser verification, and `git diff --check` pass.
