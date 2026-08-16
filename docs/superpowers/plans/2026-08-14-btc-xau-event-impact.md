# BTC and XAU Event Impact Implementation Plan

**Status:** Planned — the event-impact storage, calculation, API, and UI are not present on `main`.

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Measure and present the historical association between deduplicated macro events and subsequent BTC/XAU returns, with point-in-time alignment, matched controls, deterministic confidence intervals, and explicit sample-quality gates.

**Architecture:** The worker reads event clusters created by the Macro Event Risk plan and point-in-time market bars already stored in PostgreSQL. A pure calculation layer aligns tradable timestamps, computes per-event paths, selects non-overlapping matched controls, and writes event-level and category-level study records. Read-only authenticated APIs feed a Gold event-impact view and a new Crypto `Macro Link` tab without changing any existing decision score.

**Tech Stack:** Python 3.12, NumPy/Pandas, pytest, Prisma/PostgreSQL, Next.js 15, React 19, TypeScript, Vitest, Recharts.

**Dependency:** The Macro Event Risk foundation is present in
`quant-worker/smart_insights/event_*`, `quant-worker/smart_insights/metrics/event_risk.py`, and the
corresponding Prisma event models. Verify those current boundaries before starting this plan.

**Interpretation rule:** Results are descriptive associations, never causal claims or recommendations.

---

## File Map

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608140008_event_impact_studies/migration.sql`
- Create: `quant-worker/smart_insights/event_impact_contracts.py`
- Create: `quant-worker/smart_insights/event_impact.py`
- Create: `quant-worker/smart_insights/event_impact_repository.py`
- Create: `quant-worker/run_event_impact.py`
- Create: `quant-worker/tests/test_event_impact_alignment.py`
- Create: `quant-worker/tests/test_event_impact_controls.py`
- Create: `quant-worker/tests/test_event_impact_statistics.py`
- Create: `quant-worker/tests/test_event_impact_repository.py`
- Modify: `src/lib/backend/smart-insights-types.ts`
- Modify: `src/lib/smart-insights-client.ts`
- Modify: `src/lib/backend/smart-insights-macro.ts`
- Create: `src/app/api/smart-insights/macro/event-impact/route.ts`
- Create: `src/components/smart-insights/EventImpactPanel.tsx`
- Create: `src/components/smart-insights/CryptoMacroLinkPanel.tsx`
- Modify: `src/components/smart-insights/CryptoQuantPulseTabs.tsx`
- Modify: `src/components/smart-insights/LegacyMarketPulse.tsx`

### Task 1: Add auditable event-impact storage

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608140008_event_impact_studies/migration.sql`
- Create: `src/lib/backend/event-impact-schema.test.ts`

- [ ] **Step 1: Write a failing schema contract test**

```ts
const schema = readFileSync("prisma/schema.prisma", "utf8");
expect(schema).toContain("model EventImpactObservation");
expect(schema).toContain("model EventImpactAggregate");
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- src/lib/backend/event-impact-schema.test.ts`

- [ ] **Step 3: Add event-level and aggregate models**

```prisma
model EventImpactObservation {
  id                  String   @id @default(uuid()) @db.Uuid
  clusterId           String   @db.Uuid
  assetId             String   @db.Uuid
  horizonDays         Int
  eventAlignedAt      DateTime @db.Timestamptz(6)
  exitAt              DateTime @db.Timestamptz(6)
  rawReturn            Decimal  @db.Decimal(20, 10)
  abnormalReturn       Decimal? @db.Decimal(20, 10)
  maxAdverseExcursion  Decimal  @db.Decimal(20, 10)
  maxFavorableExcursion Decimal @db.Decimal(20, 10)
  realizedVolatility  Decimal  @db.Decimal(20, 10)
  matchedControlCount Int
  confounded          Boolean  @default(false)
  methodologyVersion  String
  dataFingerprint     String
  calculatedAt        DateTime @db.Timestamptz(6)
  cluster             GlobalEventCluster @relation(fields: [clusterId], references: [id], onDelete: Cascade)
  asset               Asset @relation(fields: [assetId], references: [id], onDelete: Cascade)

  @@unique([clusterId, assetId, horizonDays, methodologyVersion])
  @@index([assetId, horizonDays, calculatedAt])
  @@map("event_impact_observations")
}

model EventImpactAggregate {
  id                 String   @id @default(uuid()) @db.Uuid
  assetId            String   @db.Uuid
  eventCategory      String
  horizonDays        Int
  sampleStatus       String
  sampleSize         Int
  medianReturn       Decimal? @db.Decimal(20, 10)
  medianAbnormal     Decimal? @db.Decimal(20, 10)
  interquartileLow   Decimal? @db.Decimal(20, 10)
  interquartileHigh  Decimal? @db.Decimal(20, 10)
  hitRate            Decimal? @db.Decimal(10, 8)
  confidenceLow      Decimal? @db.Decimal(20, 10)
  confidenceHigh     Decimal? @db.Decimal(20, 10)
  methodologyVersion String
  dataFingerprint    String
  calculatedAt       DateTime @db.Timestamptz(6)
  asset              Asset @relation(fields: [assetId], references: [id], onDelete: Cascade)

  @@unique([assetId, eventCategory, horizonDays, methodologyVersion])
  @@index([assetId, calculatedAt])
  @@map("event_impact_aggregates")
}
```

Add the corresponding relation arrays to `Asset` and `GlobalEventCluster`. Create matching indexes, foreign keys, and unique constraints in SQL.

- [ ] **Step 4: Validate Prisma and run the test**

Run: `npx prisma format`
Run: `npx prisma validate`
Run: `npm test -- src/lib/backend/event-impact-schema.test.ts`

- [ ] **Step 5: Commit**

```powershell
git add prisma/schema.prisma prisma/migrations/202608140008_event_impact_studies/migration.sql src/lib/backend/event-impact-schema.test.ts
git commit -m "feat: add event impact study storage"
```

### Task 2: Implement point-in-time BTC and XAU alignment

**Files:**

- Create: `quant-worker/smart_insights/event_impact_contracts.py`
- Create: `quant-worker/smart_insights/event_impact.py`
- Create: `quant-worker/tests/test_event_impact_alignment.py`

- [ ] **Step 1: Write failing alignment tests**

Cover BTC event timestamps on weekends, exact-bar timestamps, XAU after close, XAU weekends/holidays, missing bars, stale bars, horizons 1/3/7/30, and no future data entering the alignment decision.

```python
assert align_entry("BTC", saturday_event, btc_daily_bars).ts == next_utc_bar
assert align_entry("XAU", friday_after_close, xau_daily_bars).ts == monday_close
with pytest.raises(InsufficientMarketData):
    align_entry("XAU", event, stale_xau_bars)
```

- [ ] **Step 2: Run and confirm failure**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_event_impact_alignment.py -q`

- [ ] **Step 3: Implement explicit asset calendars**

```python
HORIZONS = (1, 3, 7, 30)

def align_event(asset_code: str, occurred_at: datetime, bars: Sequence[MarketBar]) -> MarketBar:
    require_utc(occurred_at)
    eligible = [bar for bar in bars if bar.ts >= occurred_at]
    if not eligible:
        raise InsufficientMarketData("no tradable bar after event")
    return min(eligible, key=lambda bar: bar.ts)
```

BTC uses continuous UTC daily bars. XAU uses the next stored market close; do not synthesize weekend or holiday prices.

- [ ] **Step 4: Calculate per-event paths**

For each horizon, calculate forward return, maximum adverse excursion, maximum favorable excursion, and realized volatility from stored bars only. Mark overlapping high-severity event windows as `confounded=True`.

- [ ] **Step 5: Re-run tests and commit**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_event_impact_alignment.py -q`

```powershell
git add quant-worker/smart_insights/event_impact_contracts.py quant-worker/smart_insights/event_impact.py quant-worker/tests/test_event_impact_alignment.py
git commit -m "feat: align BTC and XAU event windows"
```

### Task 3: Select matched controls without event leakage

**Files:**

- Modify: `quant-worker/smart_insights/event_impact.py`
- Create: `quant-worker/tests/test_event_impact_controls.py`

- [ ] **Step 1: Write failing control-selection tests**

Prove controls match asset, weekday, and volatility regime; precede the calculation cutoff; exclude windows around other high-severity events; do not overlap the study event; and return a limited state when too few controls exist.

- [ ] **Step 2: Run and confirm failure**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_event_impact_controls.py -q`

- [ ] **Step 3: Implement deterministic matching**

```python
def select_controls(event: StudyEvent, candidates: Sequence[ControlWindow], limit: int = 20) -> list[ControlWindow]:
    eligible = [
        item for item in candidates
        if item.asset_id == event.asset_id
        and item.weekday == event.weekday
        and item.volatility_regime == event.volatility_regime
        and not item.overlaps_high_severity_event
        and item.end_at < event.calculation_cutoff
    ]
    return sorted(eligible, key=lambda item: (item.volatility_distance, item.start_at))[:limit]
```

Compute abnormal return as event raw return minus the median matched-control return. Preserve `matchedControlCount` and return `null` abnormal return when there are no valid controls.

- [ ] **Step 4: Re-run and commit**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_event_impact_controls.py -q`

```powershell
git add quant-worker/smart_insights/event_impact.py quant-worker/tests/test_event_impact_controls.py
git commit -m "feat: match event study control windows"
```

### Task 4: Add sample gates and deterministic aggregate statistics

**Files:**

- Modify: `quant-worker/smart_insights/event_impact.py`
- Create: `quant-worker/tests/test_event_impact_statistics.py`

- [ ] **Step 1: Write failing statistics tests**

Cover exact thresholds 4/5/19/20, median, IQR, hit rate, fixed-seed bootstrap interval, data fingerprint stability, and a no-statistics response for stale source data.

```python
assert aggregate(studies[:4]).sample_status == "INSUFFICIENT_DATA"
assert aggregate(studies[:5]).sample_status == "THIN_SAMPLE"
assert aggregate(studies[:20]).sample_status == "AVAILABLE"
assert aggregate(studies[:20], seed=20260814) == aggregate(studies[:20], seed=20260814)
```

- [ ] **Step 2: Run and confirm failure**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_event_impact_statistics.py -q`

- [ ] **Step 3: Implement versioned methodology**

Use `btc-xau-event-impact-v1`, bootstrap seed `20260814`, 2,000 resamples, and a 95% interval. Under 5 observations, return only status and sample size. From 5 to 19, return descriptive statistics without a confidence interval. From 20 onward, return all fields.

- [ ] **Step 4: Re-run and commit**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_event_impact_statistics.py -q`

```powershell
git add quant-worker/smart_insights/event_impact.py quant-worker/tests/test_event_impact_statistics.py
git commit -m "feat: aggregate event impact distributions"
```

### Task 5: Persist idempotent studies and add the bounded runner

**Files:**

- Create: `quant-worker/smart_insights/event_impact_repository.py`
- Create: `quant-worker/run_event_impact.py`
- Create: `quant-worker/tests/test_event_impact_repository.py`
- Create: `quant-worker/tests/test_event_impact_runner.py`

- [ ] **Step 1: Write failing repository and runner tests**

Test idempotent upsert, asset allowlist (`BTC`, `XAU` only), bounded lookback, stale-source abort, partial transaction rollback, fingerprint-driven recalculation, and dry-run behavior.

- [ ] **Step 2: Run and confirm failure**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_event_impact_repository.py quant-worker/tests/test_event_impact_runner.py -q`

- [ ] **Step 3: Implement repository and CLI**

```python
parser.add_argument("--asset", required=True, choices=("BTC", "XAU"))
parser.add_argument("--as-of", required=True)
parser.add_argument("--lookback-days", type=int, default=1095, choices=range(180, 3651))
parser.add_argument("--dry-run", action="store_true")
```

Read only eligible event clusters and point-in-time market bars up to `--as-of`. Write event observations and aggregates in one transaction per asset.

- [ ] **Step 4: Re-run and commit**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_event_impact_repository.py quant-worker/tests/test_event_impact_runner.py -q`

```powershell
git add quant-worker/smart_insights/event_impact_repository.py quant-worker/run_event_impact.py quant-worker/tests/test_event_impact_repository.py quant-worker/tests/test_event_impact_runner.py
git commit -m "feat: persist and run event impact studies"
```

### Task 6: Add the authenticated event-impact API

**Files:**

- Modify: `src/lib/backend/smart-insights-types.ts`
- Modify: `src/lib/smart-insights-client.ts`
- Modify: `src/lib/backend/smart-insights-macro.ts`
- Create: `src/app/api/smart-insights/macro/event-impact/route.ts`
- Create: `src/app/api/smart-insights/macro/event-impact/route.test.ts`

- [ ] **Step 1: Write failing route tests**

Test authentication/capability, exact asset allowlist, sample status, methodology, timestamps, confidence fields, source freshness, and rejection of arbitrary query values.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- src/app/api/smart-insights/macro/event-impact/route.test.ts`

- [ ] **Step 3: Implement the view contract**

```ts
export interface EventImpactView {
  asset: "BTC" | "XAU";
  methodology: "btc-xau-event-impact-v1";
  asOf: string;
  sourceStatus: Availability;
  horizons: Array<{
    category: string;
    days: 1 | 3 | 7 | 30;
    sampleStatus: "INSUFFICIENT_DATA" | "THIN_SAMPLE" | "AVAILABLE";
    sampleSize: number;
    medianAbnormal: number | null;
    iqr: [number, number] | null;
    confidence95: [number, number] | null;
    hitRate: number | null;
  }>;
}
```

Use existing tenant and research-read authorization. Do not return provider raw payloads or claim causality.

- [ ] **Step 4: Re-run and commit**

Run: `npm test -- src/app/api/smart-insights/macro/event-impact/route.test.ts`

```powershell
git add src/lib/backend/smart-insights-types.ts src/lib/smart-insights-client.ts src/lib/backend/smart-insights-macro.ts src/app/api/smart-insights/macro/event-impact
git commit -m "feat: expose BTC and XAU event impact"
```

### Task 7: Add Gold impact and Crypto Macro Link visualizations

**Files:**

- Create: `src/components/smart-insights/EventImpactPanel.tsx`
- Create: `src/components/smart-insights/CryptoMacroLinkPanel.tsx`
- Modify: `src/components/smart-insights/CryptoQuantPulseTabs.tsx`
- Modify: `src/components/smart-insights/LegacyMarketPulse.tsx`
- Create: `src/components/smart-insights/EventImpactPanel.test.tsx`
- Create: `src/components/smart-insights/CryptoMacroLinkPanel.test.tsx`

- [ ] **Step 1: Write failing component tests**

Assert BTC and XAU are not mixed, sample size/status is always visible, confidence bars render only for adequate samples, thin/insufficient copy is accurate, charts include percent units and horizons, old Crypto/Gold blocks remain, and the panels never display causal wording.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- src/components/smart-insights/EventImpactPanel.test.tsx src/components/smart-insights/CryptoMacroLinkPanel.test.tsx`

- [ ] **Step 3: Implement reusable chart/table panel**

Use an interval chart for 1D/3D/7D/30D, a category comparison table, and compact evidence details. In Crypto, add `Macro Link` as another horizontally scrollable tab. In Gold, retain the existing content and organize driver trends plus event impact inside the current style.

Disable non-essential Recharts animation and retain explicit labels/icons for positive, negative, thin, stale, and unavailable states.

- [ ] **Step 4: Re-run, lint, and build**

Run: `npm test -- src/components/smart-insights/EventImpactPanel.test.tsx src/components/smart-insights/CryptoMacroLinkPanel.test.tsx`
Run: `npm run lint`
Run: `npm run build`

- [ ] **Step 5: Commit**

```powershell
git add src/components/smart-insights/EventImpactPanel.tsx src/components/smart-insights/CryptoMacroLinkPanel.tsx src/components/smart-insights/CryptoQuantPulseTabs.tsx src/components/smart-insights/LegacyMarketPulse.tsx src/components/smart-insights/EventImpactPanel.test.tsx src/components/smart-insights/CryptoMacroLinkPanel.test.tsx
git commit -m "feat: visualize BTC and XAU event impact"
```

### Task 8: Migrate, backfill, and verify without synthetic values

**Files:**

- Create: `docs/smart-insights/event-impact-backfill-2026-08-14.md`
- Modify only if a verified defect is found.

- [ ] **Step 1: Verify target and apply migration**

Run: `npx prisma migrate status`
Run: `npx prisma migrate deploy`

- [ ] **Step 2: Verify historical market-bar coverage**

Query BTC and XAU daily bar min/max timestamps, missing periods, duplicates, and source freshness. Do not run the study for an asset lacking the required point-in-time history.

- [ ] **Step 3: Run dry-run then bounded backfill**

Run BTC and XAU independently. Record cutoff, cluster count, eligible event count, skipped reasons, control coverage, sample statuses, input fingerprint, and output row counts.

- [ ] **Step 4: Run all focused tests and build**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_event_impact_*.py -q`
Run: `npm test -- src/app/api/smart-insights/macro/event-impact/route.test.ts src/components/smart-insights/EventImpactPanel.test.tsx src/components/smart-insights/CryptoMacroLinkPanel.test.tsx`
Run: `npm run build`

- [ ] **Step 5: Browser QA**

Verify desktop/mobile, tooltip units, status labels, stacked evidence rows, unchanged old blocks, and explicit descriptive/non-causal language. Confirm missing datasets show `UNAVAILABLE` instead of seed values.

- [ ] **Step 6: Record evidence and inspect final diff**

Run: `git diff --check`
Run: `git status --short`

Document whether each asset is fully available, thin, insufficient, or blocked by missing market history.

- [ ] **Step 7: Commit evidence**

```powershell
git add docs/smart-insights/event-impact-backfill-2026-08-14.md
git commit -m "docs: record event impact backfill evidence"
```
