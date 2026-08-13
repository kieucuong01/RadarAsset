# Quant P0.3 Historical Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retain listing history, disclose incomplete historical universes, and audit VN raw/adjusted lineage with immutable evidence.

**Architecture:** Extend existing catalog snapshots into explicit listing intervals and attach catalog/adjustment provenance to run artifacts. Do not claim pre-snapshot historical constituents; expose a structured partial-survivorship warning instead.

**Tech Stack:** PostgreSQL/Prisma, Python/psycopg/Decimal, Next.js/TypeScript/Zod, pytest/Vitest.

## Global Constraints

- Catalog sync never deletes inactive/delisted assets or immutable datasets.
- Missing provider observation alone does not immediately prove delisting.
- Historical universe coverage is explicit and versioned.
- Adjusted verification never replaces provider raw bars.

---

### Task 1: Persist confirmed listing intervals

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608140006_asset_listing_history/migration.sql`
- Modify: `quant-worker/sync_provider_instruments.py`
- Test: `quant-worker/tests/test_sync_provider_instruments.py`

- [ ] Write failing tests for first-seen active, one-snapshot absence, confirmed inactive, explicit delisted, and symbol/venue lineage.
- [ ] Verify RED.
- [ ] Add `AssetListingPeriod` and catalog coverage metadata; close intervals only on explicit provider status or confirmation-window evidence.
- [ ] Preserve assets and datasets, validate migration, and commit `feat: retain quant listing history`.

### Task 2: Add survivorship coverage to catalog and runs

**Files:**
- Modify: `src/lib/backend/types.ts`
- Modify: `src/lib/backend/quant-assets.ts`
- Modify: `src/lib/backend/quant-runs.ts`
- Modify: `quant-worker/worker.py`
- Modify: `src/lib/backtest/result-model.ts`
- Modify: `src/components/PortfolioBacktestBuilder.tsx`
- Modify: `src/components/backtest-results/BacktestAdvancedAnalysis.tsx`
- Modify: `src/lib/i18n/dictionary.ts`
- Test: `src/lib/backend/quant-assets.test.ts`
- Test: `src/lib/backend/quant-runs.test.ts`
- Test: `quant-worker/tests/test_worker.py`

- [ ] Write failing tests for inactive historical selection and `SURVIVORSHIP_COVERAGE_PARTIAL` when `from` predates certified catalog coverage.
- [ ] Verify RED.
- [ ] Return structured catalog coverage, freeze it into run parameters/artifacts, and render bilingual builder/result provenance.
- [ ] Ensure current active status never filters an otherwise eligible historical interval.
- [ ] Verify and commit `feat: disclose quant survivorship coverage`.

### Task 3: Build a deterministic VN adjustment audit

**Files:**
- Create: `quant-worker/audit_vn_adjustments.py`
- Create: `quant-worker/tests/test_audit_vn_adjustments.py`
- Modify: `quant-worker/backtest/adjusted_publication.py`

- [ ] Write failing tests for basket selection and factor evidence covering cash, stock/split, rights, inactive symbol, unresolved action, raw checksum, and post-event invariance.
- [ ] Verify RED.
- [ ] Implement a read-only audit report over immutable raw/adjusted versions and corporate actions; use independent Decimal formulas for expected factors.
- [ ] Emit stable pass/block codes and no raw payload secrets.
- [ ] Verify and commit `feat: audit vn adjusted datasets`.

### Task 4: Operational historical-correctness gate

**Files:**
- Create: `docs/verification/2026-08-14-quant-p0-3-historical-correctness.md`
- Modify only defects found by the audit.

- [ ] Run catalog sync twice with a controlled inactive/delisted fixture and prove retention.
- [ ] Run the VN audit on a fixed available basket and record pass/block evidence per event type.
- [ ] Run raw checksum/row-count invariants before and after adjusted publication.
- [ ] Run full affected Python/Vitest/Prisma suites and commit `docs: verify quant historical correctness`.

