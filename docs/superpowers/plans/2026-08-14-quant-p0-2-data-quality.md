# Quant P0.2 Missing Bars and Data Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the opaque missing-bar count with versioned calendar-aware issue ranges and fail-closed Backtest eligibility.

**Architecture:** Extend the existing Python calendar/quality modules and `DataQualityIssue` persistence. Keep `missingBarCount` as genuine provider gaps, store bounded classified ranges in `qualitySummary`/issues, and let catalog selection reject only issues intersecting the requested range.

**Tech Stack:** Python 3.12 standard library, psycopg 3, Prisma/PostgreSQL, TypeScript/Zod, Next.js/Vitest.

## Global Constraints

- Never generate or forward-fill OHLC bars.
- Every dataset declares a calendar version and certified range.
- Listing intervals constrain expected bars before quality classification.
- Unknown closures are warnings or quarantine, never silently accepted holidays.

---

### Task 1: Freeze calendar contracts and certified ranges

**Files:**
- Modify: `quant-worker/backtest/market_calendar.py`
- Modify: `quant-worker/backtest/models.py`
- Test: `quant-worker/tests/test_market_calendar.py`

- [ ] Write failing tests for HOSE Tet/lunch, crypto weekends, XAU weekends/rollover, and uncertified HOSE future dates.
- [ ] Run `pytest quant-worker/tests/test_market_calendar.py -q` and verify RED.
- [ ] Add `MarketCalendarContract` with venue, timezone, version, certified bounds, sessions, and closures; preserve current public helpers through the contract.
- [ ] Verify deterministic expected timestamps and commit `feat: version quant market calendars`.

### Task 2: Classify bounded gap ranges

**Files:**
- Modify: `quant-worker/backtest/quality.py`
- Modify: `quant-worker/backtest/models.py`
- Test: `quant-worker/tests/test_quality.py`

- [ ] Write failing tests for `EXPECTED_CLOSURE`, `LISTING_INACTIVE`, `SUSPENSION_UNVERIFIED`, `PROVIDER_GAP`, and `CALENDAR_RANGE_UNVERIFIED`.
- [ ] Verify RED with the focused quality suite.
- [ ] Extend `validate_bars(rows, market, listing_start=None, listing_end=None, suspension_ranges=())` and collapse adjacent timestamps into bounded issue ranges.
- [ ] Make `missing_bar_count` count only `PROVIDER_GAP`; quarantine invalid OHLC/duplicates and uncertified intersecting ranges.
- [ ] Verify and commit `feat: classify quant data gaps`.

### Task 3: Persist issue ranges and dataset lineage

**Files:**
- Modify: `quant-worker/backtest/publication.py`
- Modify: `quant-worker/backtest/snapshots.py`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608140005_dataset_quality_ranges/migration.sql`
- Test: `quant-worker/tests/test_publication.py`
- Test: `quant-worker/tests/test_publication_integration.py`

- [ ] Write failing publication tests proving calendar version, classified counts, range start/end, and no bar insertion for gaps.
- [ ] Verify RED.
- [ ] Add nullable `range_start`/`range_end` and `classification` to `data_quality_issues`; persist bounded public details and aggregate counts in `quality_summary`.
- [ ] Preserve immutable checksum and bar rows; verify PostgreSQL round-trip.
- [ ] Run Prisma validation and commit `feat: persist quant quality ranges`.

### Task 4: Enforce requested-range eligibility

**Files:**
- Modify: `src/lib/backend/quant-assets.ts`
- Modify: `src/lib/backend/quant-runs.ts`
- Modify: `src/lib/backend/types.ts`
- Modify: `src/lib/backtest/asset-client.ts`
- Modify: `src/components/QuantAssetPickerDialog.tsx`
- Modify: `src/lib/i18n/dictionary.ts`
- Test: `src/lib/backend/quant-assets.test.ts`
- Test: `src/lib/backend/quant-runs.test.ts`

- [ ] Write failing tests: an issue outside the requested interval permits selection with warning; an intersecting provider gap or uncertified calendar blocks creation.
- [ ] Verify RED with focused Vitest.
- [ ] Query bounded issues with the immutable active version and produce stable reason codes plus coverage/calendar/gap metadata.
- [ ] Render bilingual reason and quality evidence in the picker without raw error text.
- [ ] Verify TypeScript/Vitest and commit `feat: enforce backtest data quality ranges`.

### Task 5: Explain and remediate current missing bars

**Files:**
- Create: `quant-worker/report_market_data_quality.py`
- Create: `quant-worker/tests/test_market_data_quality_report.py`
- Create: `docs/verification/2026-08-14-quant-p0-2-data-quality.md`

- [ ] Write a failing deterministic aggregation test grouped by market/timeframe/provider/classification/range.
- [ ] Implement a read-only JSON report CLI and verify RED/GREEN.
- [ ] Run it against the configured DB, requeue genuine provider gaps through the existing bounded request path, and recompute quality without mutating old versions.
- [ ] Record remaining external-provider blocks, full tests, and commit `docs: verify quant data quality`.

