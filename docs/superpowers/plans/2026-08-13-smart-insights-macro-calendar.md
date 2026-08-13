# Smart Insights Macro and CryptoCraft Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a CryptoCraft-backed research calendar, official Macro observations, event surprise/risk metrics, and a deterministic Macro Risk-Asset Regime Score.

**Architecture:** Firecrawl collects only the allow-listed CryptoCraft current/next-week calendar pages and event detail pages. Official/community API adapters collect point-in-time Macro series and CFTC positioning; a deterministic engine normalizes releases, computes surprises/event risk, and publishes Macro signal snapshots without replacing CryptoCraft as the visible calendar source.

**Tech Stack:** Python 3.12-compatible standard library, zoneinfo, Decimal, psycopg 3, Firecrawl REST, CryptoCraft, FRED API, CFTC Public Reporting Environment, pytest, Prisma 7, PostgreSQL.

## Global Constraints

- Requires completed Smart Insights foundation and reusable metric math from the Crypto plan.
- CryptoCraft is the primary visible calendar source and remains `research_only` with attribution.
- Never expose a bulk raw CryptoCraft calendar export.
- Crawl current week every two hours, next week every twelve hours, and high-impact events every fifteen minutes from T-30 to T+90 minutes.
- Never invent `actual`, `forecast`, `previous`, timezone, or impact.
- CryptoCraft source times normalize to UTC while retaining source/display timezone.
- Official Macro data enriches metrics and checks; it does not silently replace a missing CryptoCraft event.
- CFTC remains weekly, with report date separate from publication/observation time.
- Macro score is directional for risk assets; Event Risk is separate and non-directional.
- Preserve unrelated working-tree changes and commit only task files.

---

## File Structure

- `prisma/schema.prisma`: extends `EconomicEvent` with source, identity, values, provenance, and revisions.
- `prisma/migrations/202608130002_crypto_calendar/migration.sql`: event schema and deduplication.
- `quant-worker/smart_insights/collectors/cryptocraft.py`: current/next/detail page collection and normalization.
- `quant-worker/smart_insights/scheduling.py`: deterministic source/event due-time calculation.
- `quant-worker/smart_insights/collectors/fred.py`: allow-listed FRED series adapter.
- `quant-worker/smart_insights/collectors/cftc.py`: bounded CFTC PRE adapter shared with Gold.
- `quant-worker/smart_insights/macro_registry.py`: metric/series/contract definitions.
- `quant-worker/smart_insights/metrics/macro.py`: release surprise, Event Risk, and Macro regime.
- `quant-worker/smart_insights/macro_pipeline.py`: collection/publication/scoring orchestration.
- `quant-worker/tests/fixtures/smart_insights/macro/`: CryptoCraft, FRED, and CFTC fixtures.
- `quant-worker/tests/test_smart_insights_cryptocraft.py`: parser, timezone, identity, and revision tests.
- `quant-worker/tests/test_smart_insights_macro_collectors.py`: FRED/CFTC adapters.
- `quant-worker/tests/test_smart_insights_macro_metrics.py`: surprise/risk/regime golden tests.
- `quant-worker/tests/test_smart_insights_macro_pipeline_integration.py`: point-in-time replay.
- `quant-worker/collect_smart_insights.py`: Macro schedules and live smoke.

---

### Task 1: Make economic events source-backed and revision-safe

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608130002_crypto_calendar/migration.sql`
- Modify: `src/lib/backend/tenant-isolation.integration.test.ts`

**Interfaces:**

- Consumes: `InsightRawSnapshot` and existing `EconomicEvent`.
- Produces: revision-aware global event rows keyed by source event identity.

- [ ] **Step 1: Write failing persistence tests**

```ts
const event = await prisma.economicEvent.create({
  data: {
    sourceCode: "cryptocraft",
    sourceEventKey: "cryptocraft:USD:core-cpi:2026-08-13T12:30:00Z",
    event: "Core CPI m/m",
    country: "US",
    currency: "USD",
    impact: "high",
    eventDate: new Date("2026-08-13T00:00:00Z"),
    eventAt: new Date("2026-08-13T12:30:00Z"),
    timeStatus: "timed",
    sourceTimezone: "UTC",
    actual: "0.2%",
    forecast: "0.3%",
    previous: "0.3%",
    observedAt: new Date("2026-08-13T12:31:00Z"),
    revision: 1,
  },
});
expect(event.sourceEventKey).toContain("core-cpi");
```

Assert duplicate `(sourceCode, sourceEventKey, revision)` fails and revision 2 can coexist without changing revision 1.

- [ ] **Step 2: Run integration test and verify RED**

Run: `npm run test:integration -- src/lib/backend/tenant-isolation.integration.test.ts`

Expected: FAIL because event fields are missing.

- [ ] **Step 3: Replace `EconomicEvent` with the revision-aware contract**

Add `economicEvents EconomicEvent[]` to `InsightRawSnapshot`, then replace the event model while retaining the original compatibility fields:

```prisma
model EconomicEvent {
  id             String              @id @default(uuid()) @db.Uuid
  sourceCode     String              @map("source_code")
  sourceEventKey String              @map("source_event_key")
  event          String
  country        String
  currency       String
  impact         String
  actual         String?
  forecast       String?
  previous       String?
  eventDate      DateTime            @map("event_date") @db.Date
  eventAt        DateTime?           @map("event_at") @db.Timestamptz(3)
  timeStatus     String              @map("time_status")
  sourceTimezone String              @map("source_timezone")
  detailUrl      String?             @map("detail_url") @db.Text
  rawSnapshotId  String?             @map("raw_snapshot_id") @db.Uuid
  publishedAt    DateTime?           @map("published_at") @db.Timestamptz(3)
  observedAt     DateTime            @map("observed_at") @db.Timestamptz(3)
  revision       Int                 @default(1)
  qualityStatus  String              @default("passed") @map("quality_status")
  qualityFlags   Json                @default("[]") @map("quality_flags")
  createdAt      DateTime            @default(now()) @map("created_at")
  rawSnapshot    InsightRawSnapshot? @relation(fields: [rawSnapshotId], references: [id], onDelete: Restrict)

  @@unique([sourceCode, sourceEventKey, revision])
  @@index([eventDate, impact])
  @@index([eventAt, impact])
  @@index([sourceCode, sourceEventKey, revision(sort: Desc)])
  @@index([rawSnapshotId])
  @@map("economic_events")
}
```

Backfill legacy seed events with `sourceCode='seed'`, a deterministic legacy key, `eventDate=eventAt::date`, `timeStatus='timed'`, `sourceTimezone='UTC'`, `observedAt=createdAt`, `revision=1`, and `qualityStatus='sample'`. The production Smart Insights query will later exclude `sourceCode='seed'`.

- [ ] **Step 4: Add database checks**

```sql
ALTER TABLE economic_events
  ADD CONSTRAINT economic_events_impact_check CHECK (impact IN ('high', 'medium', 'low')),
  ADD CONSTRAINT economic_events_revision_check CHECK (revision > 0),
  ADD CONSTRAINT economic_events_quality_check CHECK (quality_status IN ('passed', 'warning', 'conflicting', 'sample')),
  ADD CONSTRAINT economic_events_time_status_check CHECK (
    (time_status = 'timed' AND event_at IS NOT NULL)
    OR (time_status IN ('all_day', 'tentative') AND event_at IS NULL)
  );
```

- [ ] **Step 5: Apply, test, and commit**

Run: `npx prisma migrate dev --name crypto_calendar`

Run: `npx prisma validate`

Run: `npm run test:integration -- src/lib/backend/tenant-isolation.integration.test.ts`

Expected: PASS.

```bash
git add prisma/schema.prisma prisma/migrations/202608130002_crypto_calendar/migration.sql src/lib/backend/tenant-isolation.integration.test.ts
git commit -m "feat: store source-backed economic events"
```

---

### Task 2: Parse and revise CryptoCraft calendar events

**Files:**

- Create: `quant-worker/smart_insights/collectors/cryptocraft.py`
- Create: `quant-worker/tests/test_smart_insights_cryptocraft.py`
- Create: `quant-worker/tests/fixtures/smart_insights/macro/cryptocraft-current.md`
- Create: `quant-worker/tests/fixtures/smart_insights/macro/cryptocraft-next.md`
- Create: `quant-worker/tests/fixtures/smart_insights/macro/cryptocraft-actual-revision.md`
- Modify: `quant-worker/smart_insights/sources.py`

**Interfaces:**

- Produces: `CryptoCraftCollector.collect_week(week, observed_at) -> CalendarBatch`, `normalize_event_identity(event) -> str`, and `CalendarEventInput`.

- [ ] **Step 1: Write failing parser, timezone, and revision tests**

```python
events = CryptoCraftCollector(firecrawl=fake_firecrawl("cryptocraft-current.md")).collect_week(
    "current", observed_at=NOW
).events
high = next(row for row in events if row.name == "Core CPI m/m")
assert high.event_at_utc == datetime(2026, 8, 13, 12, 30, tzinfo=timezone.utc)
assert high.source_timezone == "America/New_York"
assert high.source_event_key == "cryptocraft:USD:core-cpi-m-m:2026-08-13T12:30:00Z"
```

Test date-header carry-forward, `All Day`/tentative rows stored with `eventDate` plus null `eventAt`, rejection of those rows from the timed-event score path, daylight-saving conversion, duplicate visible names at different times, absent timezone, impact parsing, actual revisions, and blank actual before release.

- [ ] **Step 2: Run tests and verify RED**

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_cryptocraft.py -q`

Expected: FAIL because collector is missing.

- [ ] **Step 3: Implement bounded page parsing**

Map `current` only to `https://www.cryptocraft.com/calendar?week=this` and `next` only to `https://www.cryptocraft.com/calendar?week=next`. Require an explicit `Calendar Time Zone` in the Firecrawl artifact content; no server-local fallback is allowed. Parse date sections and event rows into typed fields without interpreting percentages yet. Cap at 1,000 events/week and reject duplicate exact source keys with different row content as `DUPLICATE_CONFLICT`.

Use `zoneinfo.ZoneInfo` and convert aware source datetimes to UTC. Normalize timed identity from currency, slugified event name, UTC event instant, and detail URL when present. For `all_day` or `tentative`, use source calendar date plus time status instead of fabricating an instant. Changing actual/forecast/previous creates a new revision of the same source key.

- [ ] **Step 4: Persist event revisions with snapshot lineage**

Add `publish_calendar_batch` to the foundation repository. It locates the latest event revision, inserts only changed source values, links the raw snapshot, and never overwrites prior revisions. A page parse failure quarantines the snapshot and leaves the latest event revision active.

- [ ] **Step 5: Run tests and commit**

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_cryptocraft.py -q`

Expected: PASS.

```bash
git add quant-worker/smart_insights/collectors/cryptocraft.py quant-worker/smart_insights/sources.py quant-worker/smart_insights/repository.py quant-worker/tests/test_smart_insights_cryptocraft.py quant-worker/tests/fixtures/smart_insights/macro
git commit -m "feat: collect CryptoCraft calendar revisions"
```

---

### Task 3: Encode the approved CryptoCraft cadence

**Files:**

- Create: `quant-worker/smart_insights/scheduling.py`
- Modify: `quant-worker/collect_smart_insights.py`
- Modify: `scripts/run-smart-insights.ps1`
- Modify: `quant-worker/tests/test_smart_insights_cryptocraft.py`
- Modify: `README.md`

**Interfaces:**

- Produces: `due_calendar_jobs(now, events, last_success) -> tuple[ScheduledSourceJob, ...]` and CLI schedules `calendar-current`, `calendar-next`, `calendar-event`.

- [ ] **Step 1: Write failing cadence tests**

```python
assert due_calendar_jobs(at("2026-08-13T10:00:00Z"), events=(), last_success={
    "cryptocraft-current": at("2026-08-13T08:00:00Z"),
    "cryptocraft-next": at("2026-08-13T04:00:00Z"),
}) == (
    ScheduledSourceJob("cryptocraft-current", "current"),
)
assert ScheduledSourceJob("cryptocraft-next", "next") in due_calendar_jobs(
    at("2026-08-13T12:00:00Z"), events=(), last_success={
        "cryptocraft-current": at("2026-08-13T11:00:00Z"),
        "cryptocraft-next": at("2026-08-13T00:00:00Z"),
    }
)
```

Add high-impact assertions at T-31 (not due), T-30 (due), T+90 (due), T+91 (not due), and medium-impact events (no 15-minute event job).

- [ ] **Step 2: Run tests and verify RED**

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_cryptocraft.py -q`

Expected: FAIL because scheduling functions are missing.

- [ ] **Step 3: Implement pure due-time calculation**

Current-week cadence is two hours, next-week cadence twelve hours, and high-impact event detail cadence fifteen minutes from T-30 through T+90 inclusive. A missing last-success timestamp means due immediately. Read last successful source/job run from the repository and pass it to the pure function; do not derive due state from process memory.

- [ ] **Step 4: Wire CLI schedules and document external triggers**

The platform scheduler may invoke `calendar-current` every fifteen minutes; `due_calendar_jobs` prevents unnecessary fetches. Document this recommended trigger and make CLI output `unchanged/not_due` successful rather than fetching early.

- [ ] **Step 5: Run tests and commit**

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_cryptocraft.py -q`

Expected: PASS.

```bash
git add quant-worker/smart_insights/scheduling.py quant-worker/collect_smart_insights.py scripts/run-smart-insights.ps1 quant-worker/tests/test_smart_insights_cryptocraft.py README.md
git commit -m "feat: schedule CryptoCraft event refreshes"
```

---

### Task 4: Collect official Macro series and CFTC positioning

**Files:**

- Create: `quant-worker/smart_insights/macro_registry.py`
- Create: `quant-worker/smart_insights/collectors/fred.py`
- Create: `quant-worker/smart_insights/collectors/cftc.py`
- Create: `quant-worker/tests/test_smart_insights_macro_collectors.py`
- Create: `quant-worker/tests/fixtures/smart_insights/macro/fred-observations.json`
- Create: `quant-worker/tests/fixtures/smart_insights/macro/cftc-legacy.json`
- Create: `quant-worker/tests/fixtures/smart_insights/macro/cftc-disaggregated.json`
- Modify: `.env.example`

**Interfaces:**

- Produces: `FredCollector.collect(series, start, end)`, `CftcCollector.collect(source, report_date_from)`, `FRED_SERIES`, and `CFTC_MARKETS`.

- [ ] **Step 1: Write failing registry and adapter tests**

```python
assert FRED_SERIES["DFII10"].metric_code == "macro.real_yield.10y_pct"
assert FRED_SERIES["DFII10"].direction == -1
batch = FredCollector(transport=fake_json("fred-observations.json"), api_key="test").collect(
    FRED_SERIES["DGS10"], START, END
)
assert batch.observations[-1].value == Decimal("4.32")
```

For CFTC, query official Futures Only datasets only. Assert `Legacy_All` identifier `srt6-5q2f` parses Bitcoin code `133741`, USD Index `098662`, E-mini S&P 500 `13874A`, and Nasdaq-100 Mini `209742` as non-commercial positions. Assert Disaggregated Futures Only identifier `72hh-3qpy` parses Gold code `088691` as managed-money positions. No collector may double-count combined rows.

- [ ] **Step 2: Run tests and verify RED**

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_macro_collectors.py -q`

Expected: FAIL because registry/adapters are missing.

- [ ] **Step 3: Implement the allow-listed FRED registry**

Register exact series IDs and units:

```python
FRED_SERIES = {
    "DGS2": series("macro.yield.2y_pct", "%", direction=-1),
    "DGS10": series("macro.yield.10y_pct", "%", direction=-1),
    "DFII10": series("macro.real_yield.10y_pct", "%", direction=-1),
    "DFF": series("macro.fed_funds_pct", "%", direction=-1),
    "SOFR": series("macro.sofr_pct", "%", direction=-1),
    "WALCL": series("macro.fed_balance_sheet_musd", "USD million", direction=1),
    "RRPONTSYD": series("macro.reverse_repo_busd", "USD billion", direction=-1),
    "WTREGEN": series("macro.tga_busd", "USD billion", direction=-1),
    "DTWEXBGS": series("macro.usd_broad_index", "index", direction=-1),
    "CPIAUCSL": series("macro.cpi_index", "index", direction=0),
    "CPILFESL": series("macro.core_cpi_index", "index", direction=0),
    "PCEPI": series("macro.pce_index", "index", direction=0),
    "PAYEMS": series("macro.payroll_thousands", "thousand", direction=1),
    "UNRATE": series("macro.unemployment_pct", "%", direction=-1),
    "GDP": series("macro.gdp_busd", "USD billion", direction=1),
}
```

Do not accept arbitrary series IDs. Treat `.` as missing, retain official observation date, and store source series metadata. Require `FRED_API_KEY` for live collection.

- [ ] **Step 4: Freeze the CFTC market/report mapping**

```python
CFTC_MARKETS = {
    "BTC": cftc_market("cftc-legacy", "133741", classification="noncommercial"),
    "USD_INDEX": cftc_market("cftc-legacy", "098662", classification="noncommercial"),
    "SP500_EMINI": cftc_market("cftc-legacy", "13874A", classification="noncommercial"),
    "NASDAQ100_MINI": cftc_market("cftc-legacy", "209742", classification="noncommercial"),
    "GOLD": cftc_market("cftc-disaggregated", "088691", classification="managed_money"),
}
```

- [ ] **Step 5: Implement bounded CFTC PRE queries**

Call only `https://publicreporting.cftc.gov/resource/srt6-5q2f.json` or `https://publicreporting.cftc.gov/resource/72hh-3qpy.json`, selected by the registry row, with code-owned `$select`, `$where`, `$order`, and `$limit<=5000`. Normalize report date, contract code/name, open interest, selected classification long/short, and net position. Use report date as effective time and request time as observed time; store dataset ID and classification in dimensions.

- [ ] **Step 6: Add environment config, run tests, and commit**

```dotenv
FRED_API_KEY=
SMART_INSIGHTS_FRED_OVERLAP_DAYS=14
SMART_INSIGHTS_CFTC_OVERLAP_WEEKS=8
```

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_macro_collectors.py -q`

Expected: PASS.

```bash
git add quant-worker/smart_insights/macro_registry.py quant-worker/smart_insights/collectors/fred.py quant-worker/smart_insights/collectors/cftc.py quant-worker/tests/test_smart_insights_macro_collectors.py quant-worker/tests/fixtures/smart_insights/macro .env.example
git commit -m "feat: collect official macro observations"
```

---

### Task 5: Compute event surprise, Event Risk, and Macro regime

**Files:**

- Create: `quant-worker/smart_insights/metrics/macro.py`
- Create: `quant-worker/smart_insights/macro_pipeline.py`
- Create: `quant-worker/tests/test_smart_insights_macro_metrics.py`
- Create: `quant-worker/tests/test_smart_insights_macro_pipeline_integration.py`
- Modify: `quant-worker/collect_smart_insights.py`
- Modify: `quant-worker/smart_insights/sources.py`

**Interfaces:**

- Produces: `parse_release_number`, `release_surprise`, `surprise_z_score`, `event_risk_score`, `calculate_macro_snapshot`, and `run_macro_pipeline`.

- [ ] **Step 1: Write failing golden tests**

```python
def test_event_risk_uses_impact_time_and_portfolio_sensitivity() -> None:
    score = event_risk_score(
        impact="high", event_at=NOW + timedelta(hours=12), now=NOW,
        portfolio_sensitivity=Decimal("0.8"),
    )
    assert score == Decimal("80")

def test_surprise_requires_same_series_history() -> None:
    assert release_surprise(Decimal("0.2"), Decimal("0.3")) == Decimal("-0.1")
    assert surprise_z_score(Decimal("-0.1"), prior_surprises=SEVEN_ROWS) is None

def test_macro_replay_ignores_later_event_revision(repository) -> None:
    seed_event_revision(repository, revision=1, actual="0.2%", observed_at="2026-08-13T12:31:00Z")
    first = calculate_macro_snapshot(repository, as_of=at("2026-08-13T13:00:00Z"))
    seed_event_revision(repository, revision=2, actual="0.3%", observed_at="2026-08-13T14:00:00Z")
    replay = calculate_macro_snapshot(repository, as_of=at("2026-08-13T13:00:00Z"))
    assert replay.fingerprint == first.fingerprint
    assert replay.input_ids == first.input_ids
```

Also test percent/K/M/B suffixes, decimal comma rejection unless source declares it, previous-value revisions, eight-release minimum, source conflict, and Event Risk windows 24h/3d/7d.

- [ ] **Step 2: Run tests and verify RED**

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_macro_metrics.py quant-worker/tests/test_smart_insights_macro_pipeline_integration.py -q`

Expected: FAIL because Macro metrics/pipeline are missing.

- [ ] **Step 3: Implement release parsing and surprise history**

Parse actual/forecast into a source-declared unit; never compare mismatched units. Surprise is actual minus forecast. Surprise z-score uses only earlier releases of the same normalized event series and remains unavailable before eight prior valid surprises.

- [ ] **Step 4: Implement Event Risk exactly**

Base severity is high 100, medium 60, low 25. Time factor is 1.0 inside 24 hours, 0.7 inside three days, 0.4 inside seven days, otherwise zero. Multiply by sensitivity constrained to `[0.5, 1.0]`. Rows without an exact `eventAt` are visible but excluded from timed Event Risk. The market Event Risk is the maximum event score, not a sum.

- [ ] **Step 5: Implement Macro score groups**

```python
MACRO_GROUP_WEIGHTS = {
    "liquidity": Decimal("0.30"),
    "rates_real_yields": Decimal("0.25"),
    "usd_pressure": Decimal("0.20"),
    "growth_inflation_surprise": Decimal("0.15"),
    "positioning": Decimal("0.10"),
}
```

Freeze the v1 component contract:

```python
MACRO_GROUP_COMPONENTS = {
    "liquidity": ("macro.fed_balance_sheet_change_4w", "macro.reverse_repo_change_4w", "macro.tga_change_4w"),
    "rates_real_yields": ("macro.yield.2y_pct", "macro.yield.10y_pct", "macro.real_yield.10y_pct"),
    "usd_pressure": ("macro.usd_broad_index",),
    "growth_inflation_surprise": ("macro.growth_surprise", "macro.inflation_surprise"),
    "positioning": ("macro.cftc.btc_net_oi", "macro.cftc.usd_index_net_oi", "macro.cftc.sp500_net_oi", "macro.cftc.nasdaq100_net_oi"),
}
```

Within each group, configured component weight is equal. Fed balance-sheet change and positive growth surprise support risk assets. Reverse-repo/TGA increases, yields/real yield, USD broad index, positive inflation surprise, and USD Index net positioning oppose risk assets. BTC/S&P 500/Nasdaq-100 net positioning supports risk assets. CFTC net positions are divided by same-row open interest before percentile scoring.

`macro_registry.py` owns the exact CryptoCraft surprise map: growth includes GDP, retail sales, payroll/employment change, unemployment/claim releases (negative direction), and PMI; inflation includes CPI, Core CPI, PCE/Core PCE, PPI/Core PPI, and inflation expectations (negative direction). Normalize `m/m`, `q/q`, `y/y`, country, and currency as part of series identity; an unmapped event remains visible in the calendar but cannot enter a directional surprise component.

Require 60% fresh weight coverage, calculate Data Confidence, keep Event Risk separate, and publish methodology `macro-risk-asset-regime-v1` with source observation/event IDs.

- [ ] **Step 6: Register schedules and live smoke**

Add daily FRED, weekly CFTC, and CryptoCraft schedules. A CryptoCraft live smoke must parse current page timezone and at least one current event through the production parser. Keep the source disabled if `robots.txt`, Firecrawl, or structure blocks validation.

- [ ] **Step 7: Run full Macro verification and commit**

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_cryptocraft.py quant-worker/tests/test_smart_insights_macro_collectors.py quant-worker/tests/test_smart_insights_macro_metrics.py quant-worker/tests/test_smart_insights_macro_pipeline_integration.py -q`

Expected: PASS.

```bash
git add quant-worker/smart_insights/metrics/macro.py quant-worker/smart_insights/macro_pipeline.py quant-worker/tests/test_smart_insights_macro_metrics.py quant-worker/tests/test_smart_insights_macro_pipeline_integration.py quant-worker/collect_smart_insights.py quant-worker/smart_insights/sources.py
git commit -m "feat: publish macro event and regime signals"
```

---

## Plan 3 Completion Gate

- CryptoCraft current/next/detail collection follows the approved cadence and retains revisions.
- The visible calendar contains no seed event and never fabricates an actual value.
- FRED series and CFTC contracts are code-owned and bounded.
- Surprise history is same-series and point-in-time; Event Risk is separate from direction.
- Macro Risk-Asset Regime is deterministic, confidence-gated, and replayable.
- Every enabled live source has passed its production parser and validation smoke.
