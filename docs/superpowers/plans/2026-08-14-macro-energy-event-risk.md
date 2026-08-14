# Macro Energy and Event Risk Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add independently implemented global-event, energy, and BIS intelligence to Smart Insights, with deterministic Macro Event Risk and Oil Shock metrics and no WorldMonitor AGPL code, assets, UI, formulas, or branding.

**Architecture:** New Python collectors normalize upstream public data into provider observations and deduplicated event clusters. Versioned metric calculators publish only when at least 60% of fresh component weight is present. PostgreSQL remains the audit store; authenticated Next.js APIs return read-only view models; the current Smart Insights visual system gains tabbed Macro views with charts, cards, and compact evidence tables.

**Tech Stack:** Python 3.12, pytest, Prisma/PostgreSQL, Next.js 15, React 19, TypeScript, Vitest, Recharts, shadcn Tabs.

**Dependency:** Approved design at `docs/superpowers/specs/2026-08-14-worldmonitor-quant-intelligence-design.md`.

**License rule:** Treat WorldMonitor documentation as research only. Do not add a WorldMonitor dependency, source file, asset, CSS, component, generated client, text copy, or visual replica.

---

## File Map

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608140007_macro_energy_event_risk/migration.sql`
- Create: `quant-worker/smart_insights/event_contracts.py`
- Create: `quant-worker/smart_insights/event_normalization.py`
- Create: `quant-worker/smart_insights/event_deduplication.py`
- Create: `quant-worker/smart_insights/metrics/event_risk.py`
- Create: `quant-worker/smart_insights/metrics/energy.py`
- Create: `quant-worker/smart_insights/event_repository.py`
- Modify: `quant-worker/smart_insights/sources.py`
- Modify: `quant-worker/smart_insights/collectors/__init__.py`
- Create: `quant-worker/smart_insights/collectors/gdelt.py`
- Create: `quant-worker/smart_insights/collectors/gdacs.py`
- Create: `quant-worker/smart_insights/collectors/usgs.py`
- Create: `quant-worker/smart_insights/collectors/eonet.py`
- Create: `quant-worker/smart_insights/collectors/eia.py`
- Create: `quant-worker/smart_insights/collectors/bis.py`
- Modify: `quant-worker/collect_smart_insights.py`
- Create: `src/lib/backend/smart-insights-macro.ts`
- Modify: `src/lib/backend/smart-insights-types.ts`
- Modify: `src/lib/smart-insights-client.ts`
- Create: `src/app/api/smart-insights/macro/events/route.ts`
- Create: `src/app/api/smart-insights/macro/energy/route.ts`
- Create: `src/components/smart-insights/MacroQuantPulseTabs.tsx`
- Create: `src/components/smart-insights/EventRiskPanel.tsx`
- Create: `src/components/smart-insights/EnergyPulsePanel.tsx`
- Modify: `src/components/smart-insights/LegacyMarketPulse.tsx`
- Test: `quant-worker/tests/test_smart_insights_event_*.py`
- Test: `quant-worker/tests/test_smart_insights_energy_metrics.py`
- Test: `src/lib/backend/smart-insights-macro.test.ts`
- Test: `src/app/api/smart-insights/macro/**/route.test.ts`
- Test: `src/components/smart-insights/MacroQuantPulseTabs.test.tsx`

### Task 1: Remove rejected integration references without deleting generic research infrastructure

**Files:**

- Modify: `prisma/seed.ts`
- Modify: `quant-worker/research_import.py`
- Modify: `quant-worker/README.md`
- Modify: `src/lib/i18n/dictionary.ts`
- Modify: `src/lib/backend/investor-intelligence.test.ts`
- Modify: `README.md`
- Create: `prisma/migrations/202608140007_macro_energy_event_risk/migration.sql`
- Create: `quant-worker/tests/test_research_import.py`

- [ ] **Step 1: Add a failing default-import regression test**

Assert that the generic research importer remains usable but its default payload no longer names `last30days`, `ai-berkshire`, or `daily_stock_analysis`.

```python
payload = default_payload("BTC")
serialized = json.dumps(payload).casefold()
assert payload["source"] == "local-automation"
assert "last30days" not in serialized
assert "ai-berkshire" not in serialized
assert "daily_stock_analysis" not in serialized
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_research_import.py -q`

- [ ] **Step 3: Remove only rejected defaults, labels, copy, and seed entries**

Keep `ResearchRun`, `EvidenceItem`, `ForecastPoint`, `ModelEvaluation`, and the normalized import path intact. Replace rejected names in investor-intelligence test fixtures with neutral provider names so the domain tests still prove the same scoring behavior.

- [ ] **Step 4: Add scoped cleanup SQL to the migration**

```sql
DELETE FROM research_runs
WHERE lower(source) IN ('last30days', 'ai-berkshire', 'daily_stock_analysis')
   OR EXISTS (
     SELECT 1
     FROM jsonb_array_elements_text(
       CASE
         WHEN jsonb_typeof(parameters->'adapters') = 'array' THEN parameters->'adapters'
         ELSE '[]'::jsonb
       END
     ) AS adapter(value)
     WHERE lower(adapter.value) IN ('last30days', 'ai-berkshire', 'daily_stock_analysis')
   );
```

- [ ] **Step 5: Re-run the focused test**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_research_import.py -q`
Run: `npm test -- src/lib/backend/investor-intelligence.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add prisma/seed.ts prisma/migrations/202608140007_macro_energy_event_risk/migration.sql quant-worker/research_import.py quant-worker/README.md quant-worker/tests/test_research_import.py src/lib/i18n/dictionary.ts src/lib/backend/investor-intelligence.test.ts README.md
git commit -m "chore: remove rejected research integrations"
```

### Task 2: Add event observation, cluster, and rolling-baseline storage

**Files:**

- Modify: `prisma/schema.prisma`
- Modify: `prisma/migrations/202608140007_macro_energy_event_risk/migration.sql`
- Test: `src/lib/backend/smart-insights-schema.test.ts`

- [ ] **Step 1: Add a failing schema contract test**

```ts
const schema = readFileSync("prisma/schema.prisma", "utf8")
expect(schema).toContain("model GlobalEventObservation")
expect(schema).toContain("model GlobalEventCluster")
expect(schema).toContain("model EventBaselineState")
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- src/lib/backend/smart-insights-schema.test.ts`

- [ ] **Step 3: Add Prisma models and matching SQL**

```prisma
model GlobalEventObservation {
  id                 String   @id @default(uuid()) @db.Uuid
  providerId         String   @db.Uuid
  rawSnapshotId      String?  @db.Uuid
  providerEventKey   String
  category           String
  subcategory        String?
  title              String
  country             String?
  region              String?
  latitude            Decimal? @db.Decimal(10, 6)
  longitude           Decimal? @db.Decimal(10, 6)
  occurredAt          DateTime @db.Timestamptz(6)
  firstObservedAt     DateTime @db.Timestamptz(6)
  lastObservedAt      DateTime @db.Timestamptz(6)
  normalizedSeverity Decimal  @db.Decimal(8, 4)
  providerSeverity   Decimal? @db.Decimal(8, 4)
  affectedCount      Int?
  fatalities         Int?
  sourceUrl           String?
  contentHash         String
  parserVersion       String
  qualityStatus       String
  qualityFlags        Json
  dimensions          Json
  createdAt           DateTime @default(now()) @db.Timestamptz(6)
  clusterMember       GlobalEventClusterMember?

  @@unique([providerId, providerEventKey])
  @@index([occurredAt])
  @@index([category, country, occurredAt])
  @@map("global_event_observations")
}

model GlobalEventCluster {
  id                   String   @id @default(uuid()) @db.Uuid
  clusterKey           String   @unique
  category             String
  subcategory          String?
  title                String
  country              String?
  region               String?
  latitude             Decimal? @db.Decimal(10, 6)
  longitude            Decimal? @db.Decimal(10, 6)
  occurredAt           DateTime @db.Timestamptz(6)
  normalizedSeverity   Decimal  @db.Decimal(8, 4)
  corroborationCount   Int
  status               String
  qualityFlags         Json
  members              GlobalEventClusterMember[]
  createdAt            DateTime @default(now()) @db.Timestamptz(6)
  updatedAt            DateTime @updatedAt @db.Timestamptz(6)

  @@index([occurredAt])
  @@index([category, occurredAt])
  @@map("global_event_clusters")
}

model GlobalEventClusterMember {
  id            String @id @default(uuid()) @db.Uuid
  clusterId     String @db.Uuid
  observationId String @unique @db.Uuid
  matchScore    Decimal @db.Decimal(8, 4)
  cluster       GlobalEventCluster @relation(fields: [clusterId], references: [id], onDelete: Cascade)
  observation   GlobalEventObservation @relation(fields: [observationId], references: [id], onDelete: Cascade)

  @@index([clusterId])
  @@map("global_event_cluster_members")
}

model EventBaselineState {
  id            String   @id @default(uuid()) @db.Uuid
  baselineKey   String   @unique
  eventCategory String
  region        String
  weekday       Int
  month         Int
  count         Int
  mean          Decimal  @db.Decimal(20, 8)
  m2            Decimal  @db.Decimal(28, 8)
  updatedAt     DateTime @updatedAt @db.Timestamptz(6)

  @@map("event_baseline_states")
}
```

- [ ] **Step 4: Generate Prisma client and validate schema**

Run: `npx prisma format`
Run: `npx prisma validate`

- [ ] **Step 5: Re-run the schema test**

Run: `npm test -- src/lib/backend/smart-insights-schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add prisma/schema.prisma prisma/migrations/202608140007_macro_energy_event_risk/migration.sql src/lib/backend/smart-insights-schema.test.ts
git commit -m "feat: add global event storage contracts"
```

### Task 3: Define event contracts and deterministic normalization

**Files:**

- Create: `quant-worker/smart_insights/event_contracts.py`
- Create: `quant-worker/smart_insights/event_normalization.py`
- Create: `quant-worker/tests/test_smart_insights_event_normalization.py`

- [ ] **Step 1: Write failing normalization tests**

Cover timezone-aware timestamps, category mapping, coordinates, severity clamping, parser metadata, content hash stability, and rejection of naive timestamps.

```python
with pytest.raises(ValueError, match="timezone-aware"):
    normalize_event(raw_event, observed_at=datetime(2026, 8, 14))

event = normalize_event(raw_event, observed_at=UTC_NOW)
assert 0.0 <= event.normalized_severity <= 100.0
assert event.content_hash == normalize_event(raw_event, UTC_NOW).content_hash
```

- [ ] **Step 2: Run the tests and confirm failure**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_smart_insights_event_normalization.py -q`

- [ ] **Step 3: Implement immutable event contracts**

```python
@dataclass(frozen=True)
class EventObservation:
    source_code: str
    source_event_key: str
    category: str
    subcategory: str | None
    title: str
    occurred_at: datetime
    first_observed_at: datetime
    last_observed_at: datetime
    normalized_severity: float
    country: str | None
    region: str | None
    latitude: float | None
    longitude: float | None
    source_url: str | None
    parser_version: str
    quality_flags: tuple[str, ...]
    dimensions: Mapping[str, JsonValue]
    content_hash: str
```

Use explicit per-provider severity adapters. Do not infer fatalities, affected population, location, or severity fields that the provider did not supply.

- [ ] **Step 4: Re-run tests**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_smart_insights_event_normalization.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add quant-worker/smart_insights/event_contracts.py quant-worker/smart_insights/event_normalization.py quant-worker/tests/test_smart_insights_event_normalization.py
git commit -m "feat: normalize global event observations"
```

### Task 4: Add disabled source definitions and phase-one public collectors

**Files:**

- Modify: `quant-worker/smart_insights/sources.py`
- Modify: `quant-worker/smart_insights/collectors/__init__.py`
- Create: `quant-worker/smart_insights/collectors/gdelt.py`
- Create: `quant-worker/smart_insights/collectors/gdacs.py`
- Create: `quant-worker/smart_insights/collectors/usgs.py`
- Create: `quant-worker/smart_insights/collectors/eonet.py`
- Create: `quant-worker/tests/fixtures/smart_insights/events/*.json`
- Create: `quant-worker/tests/test_smart_insights_event_collectors.py`
- Modify: `quant-worker/tests/test_smart_insights_foundation.py`

- [ ] **Step 1: Write fixture-driven failing tests**

Each collector must prove bounded URL construction, explicit timeout, provider ID preservation, UTC parsing, raw-body hashing, and all-or-nothing schema validation.

```python
batch = GdeltCollector(http=fake_http).collect(observed_at=UTC_NOW)
assert batch.source_code == "gdelt-events"
assert batch.events
assert all(event.occurred_at.tzinfo is not None for event in batch.events)
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_smart_insights_event_collectors.py -q`

- [ ] **Step 3: Register sources as disabled**

```python
("gdelt-events", "GDELT Events", Market.MACRO, CollectionMode.API,
 ("https://api.gdeltproject.org/api/v2/doc/doc",), "daily", "gdelt-events-v1", 360,
 "direct_api", "https://www.gdeltproject.org/about.html")
("gdacs-events", "GDACS Events", Market.MACRO, CollectionMode.API,
 ("https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH",), "daily", "gdacs-events-v1", 360,
 "official_api", "https://www.gdacs.org/About/legal.aspx")
("usgs-earthquakes", "USGS Earthquakes", Market.MACRO, CollectionMode.API,
 ("https://earthquake.usgs.gov/fdsnws/event/1/query",), "daily", "usgs-earthquakes-v1", 360,
 "official_api", "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits")
("nasa-eonet", "NASA EONET", Market.MACRO, CollectionMode.API,
 ("https://eonet.gsfc.nasa.gov/api/v3/events",), "daily", "nasa-eonet-v1", 360,
 "official_api", "https://www.nasa.gov/nasa-brand-center/images-and-media/")
```

Append these rows to `SOURCE_ROWS`, update the explicit public-official license set for GDACS/USGS/EONET, and leave every new code absent from `ENABLED_SOURCE_CODES`. Do not enable any source in this task.

- [ ] **Step 4: Implement provider-specific collectors**

Use official public APIs/feeds only. Persist the unmodified response body as the raw artifact before normalization. Reject a response whose schema cannot be validated completely.

- [ ] **Step 5: Re-run focused tests and registry tests**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_smart_insights_event_collectors.py quant-worker/tests/test_smart_insights_foundation.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add quant-worker/smart_insights/sources.py quant-worker/smart_insights/collectors quant-worker/tests/fixtures/smart_insights/events quant-worker/tests/test_smart_insights_event_collectors.py quant-worker/tests/test_smart_insights_foundation.py
git commit -m "feat: add disabled public event collectors"
```

### Task 5: Deduplicate events and update rolling baselines

**Files:**

- Create: `quant-worker/smart_insights/event_deduplication.py`
- Create: `quant-worker/smart_insights/event_repository.py`
- Create: `quant-worker/tests/test_smart_insights_event_deduplication.py`
- Create: `quant-worker/tests/test_smart_insights_event_repository.py`

- [ ] **Step 1: Write failing deduplication tests**

Test same event across two sources, two nearby but distinct events, uncertain similarity, idempotent replay, and Welford mean/variance updates.

```python
assert match_score(same_place_same_time_same_category) >= 0.82
assert match_score(same_title_different_country) < 0.82
assert update_baseline(BaselineState.empty(), 10.0).mean == 10.0
```

- [ ] **Step 2: Run and confirm failure**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_smart_insights_event_deduplication.py quant-worker/tests/test_smart_insights_event_repository.py -q`

- [ ] **Step 3: Implement deterministic matching**

```python
def event_match_score(left: EventObservation, right: EventObservation) -> float:
    if left.category != right.category:
        return 0.0
    return (
        0.35 * geographic_similarity(left, right)
        + 0.30 * temporal_similarity(left, right)
        + 0.25 * title_similarity(left.title, right.title)
        + 0.10 * entity_similarity(left.dimensions, right.dimensions)
    )
```

Cluster only when the score reaches the versioned threshold. Store borderline scores as review flags; do not silently merge them.

- [ ] **Step 4: Implement transactional upsert and Welford state update**

One transaction must persist the observation, cluster membership, cluster aggregate, and baseline update. Replay of the same provider event must not increment corroboration or baseline counts.

- [ ] **Step 5: Re-run tests**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_smart_insights_event_deduplication.py quant-worker/tests/test_smart_insights_event_repository.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add quant-worker/smart_insights/event_deduplication.py quant-worker/smart_insights/event_repository.py quant-worker/tests/test_smart_insights_event_deduplication.py quant-worker/tests/test_smart_insights_event_repository.py
git commit -m "feat: deduplicate events and maintain baselines"
```

### Task 6: Implement Macro Event Risk with a hard freshness gate

**Files:**

- Create: `quant-worker/smart_insights/metrics/event_risk.py`
- Create: `quant-worker/tests/test_smart_insights_event_risk_metrics.py`
- Modify: `quant-worker/smart_insights/macro_registry.py`
- Modify: `quant-worker/smart_insights/metrics/macro.py`

- [ ] **Step 1: Write failing score and coverage tests**

```python
assert calculate_event_risk(all_fresh).value == pytest.approx(71.5)
assert calculate_event_risk(only_55_percent_fresh).status == "UNAVAILABLE"
assert calculate_event_risk(only_55_percent_fresh).value is None
```

- [ ] **Step 2: Run and confirm failure**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_smart_insights_event_risk_metrics.py -q`

- [ ] **Step 3: Implement the versioned deterministic calculation**

```python
EVENT_RISK_V1 = {
    "severity": 0.30,
    "frequency_anomaly": 0.25,
    "corroboration": 0.20,
    "strategic_relevance": 0.15,
    "market_stress": 0.10,
}

def calculate_event_risk(inputs: EventRiskInputs) -> MetricResult:
    coverage = sum(weight for name, weight in EVENT_RISK_V1.items() if inputs.is_fresh(name))
    if coverage < 0.60:
        return MetricResult.unavailable("INSUFFICIENT_FRESH_WEIGHT", coverage=coverage)
    value = sum(EVENT_RISK_V1[name] * inputs.value(name) for name in EVENT_RISK_V1)
    return MetricResult.available(value=value, methodology="macro-event-risk-v1", coverage=coverage)
```

Do not renormalize missing components. The risk score is stress intensity, not direction.

- [ ] **Step 4: Register component metrics and composite methodology**

Each observation must carry source evidence, as-of time, freshness, units, and version.

- [ ] **Step 5: Re-run tests**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_smart_insights_event_risk_metrics.py quant-worker/tests/test_smart_insights_macro_metrics.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add quant-worker/smart_insights/metrics/event_risk.py quant-worker/smart_insights/metrics/macro.py quant-worker/smart_insights/macro_registry.py quant-worker/tests/test_smart_insights_event_risk_metrics.py
git commit -m "feat: calculate macro event risk"
```

### Task 7: Add disabled EIA and BIS collectors and calculate Oil Shock

**Files:**

- Modify: `quant-worker/smart_insights/sources.py`
- Create: `quant-worker/smart_insights/collectors/eia.py`
- Create: `quant-worker/smart_insights/collectors/bis.py`
- Create: `quant-worker/smart_insights/metrics/energy.py`
- Create: `quant-worker/tests/fixtures/smart_insights/macro/eia-*.json`
- Create: `quant-worker/tests/fixtures/smart_insights/macro/bis-*.csv`
- Create: `quant-worker/tests/test_smart_insights_energy_collectors.py`
- Create: `quant-worker/tests/test_smart_insights_energy_metrics.py`

- [ ] **Step 1: Write failing fixture and metric tests**

Cover units, weekly timestamps, series IDs, missing EIA key, missing forecast fallback, 20-day realized volatility, 90-day z-scores, and 60% fresh-weight withholding.

- [ ] **Step 2: Run and confirm failure**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_smart_insights_energy_collectors.py quant-worker/tests/test_smart_insights_energy_metrics.py -q`

- [ ] **Step 3: Add disabled sources and bounded collectors**

```python
("eia-energy", "U.S. EIA Energy", Market.MACRO, CollectionMode.API,
 ("https://api.eia.gov/v2/",), "daily", "eia-energy-v1", 11520,
 "official_api", "https://www.eia.gov/about/copyrights_reuse.php")
("bis-statistics", "BIS Statistics", Market.MACRO, CollectionMode.API,
 ("https://stats.bis.org/api/v1/data",), "weekly", "bis-statistics-v1", 20160,
 "official_api", "https://www.bis.org/terms_conditions.htm")
```

Append these rows to `SOURCE_ROWS`, classify both as public-official, and keep them absent from `ENABLED_SOURCE_CODES`. `EIA_API_KEY` absence must produce a disabled/not-configured status without an HTTP request. BIS is contextual evidence only in this delivery.

- [ ] **Step 4: Implement Oil Shock v1**

```python
OIL_SHOCK_V1 = {
    "oil_return_7d_z": 0.35,
    "oil_volatility_z": 0.25,
    "inventory_surprise_or_change_z": 0.25,
    "brent_wti_spread_z": 0.15,
}
```

Use inventory-change anomaly when no comparable forecast exists; label which branch was used. Publish no value below 60% fresh-weight coverage.

- [ ] **Step 5: Re-run tests**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_smart_insights_energy_collectors.py quant-worker/tests/test_smart_insights_energy_metrics.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add quant-worker/smart_insights/sources.py quant-worker/smart_insights/collectors/eia.py quant-worker/smart_insights/collectors/bis.py quant-worker/smart_insights/metrics/energy.py quant-worker/tests/fixtures/smart_insights/macro quant-worker/tests/test_smart_insights_energy_collectors.py quant-worker/tests/test_smart_insights_energy_metrics.py
git commit -m "feat: add energy and BIS intelligence"
```

### Task 8: Wire collection, persistence, health, and CLI dry-run behavior

**Files:**

- Modify: `quant-worker/collect_smart_insights.py`
- Modify: `quant-worker/smart_insights/repository.py`
- Modify: `quant-worker/smart_insights/macro_pipeline.py`
- Create: `quant-worker/tests/test_smart_insights_event_pipeline_integration.py`

- [ ] **Step 1: Write a failing collector-to-signal integration test**

Prove raw artifact -> normalized observation -> deduplicated cluster -> metric observation -> signal snapshot -> source health. Also prove disabled sources are never called.

- [ ] **Step 2: Run and confirm failure**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_smart_insights_event_pipeline_integration.py -q`

- [ ] **Step 3: Add pipeline handlers and CLI selection**

```python
EVENT_SOURCE_CODES = {"gdelt-events", "gdacs-events", "usgs-earthquakes", "nasa-eonet"}
ENERGY_SOURCE_CODES = {"eia-energy", "bis-statistics"}
```

`--source` may select a disabled source only with the existing explicit live-smoke/dry-run flag. Normal scheduled runs must continue to use the enabled registry only.

- [ ] **Step 4: Re-run integration and existing regressions**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_smart_insights_event_pipeline_integration.py quant-worker/tests/test_smart_insights_macro_pipeline_integration.py quant-worker/tests/test_smart_insights_foundation.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add quant-worker/collect_smart_insights.py quant-worker/smart_insights/repository.py quant-worker/smart_insights/macro_pipeline.py quant-worker/tests/test_smart_insights_event_pipeline_integration.py
git commit -m "feat: wire macro event and energy pipelines"
```

### Task 9: Add authenticated macro event and energy APIs

**Files:**

- Modify: `src/lib/backend/smart-insights-types.ts`
- Modify: `src/lib/smart-insights-client.ts`
- Create: `src/lib/backend/smart-insights-macro.ts`
- Create: `src/app/api/smart-insights/macro/events/route.ts`
- Create: `src/app/api/smart-insights/macro/energy/route.ts`
- Create: `src/lib/backend/smart-insights-macro.test.ts`
- Create: `src/app/api/smart-insights/macro/events/route.test.ts`
- Create: `src/app/api/smart-insights/macro/energy/route.test.ts`

- [ ] **Step 1: Write failing backend and route tests**

Test tenant authentication, research-read capability, valid view-model shape, status propagation, bounded date range, source evidence, and no credential/raw-payload leakage.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- src/lib/backend/smart-insights-macro.test.ts src/app/api/smart-insights/macro/events/route.test.ts src/app/api/smart-insights/macro/energy/route.test.ts`

- [ ] **Step 3: Implement explicit client contracts**

```ts
export type Availability = "AVAILABLE" | "STALE" | "LIMITED_DATA" | "UNAVAILABLE"

export interface MacroEventRiskView {
  methodology: "macro-event-risk-v1"
  status: Availability
  score: number | null
  freshWeight: number
  asOf: string
  components: Array<{ code: string; value: number | null; weight: number; fresh: boolean }>
  timeline: Array<{ ts: string; score: number; category: string }>
  events: MacroEventRow[]
}

export interface EnergyPulseView {
  methodology: "energy-oil-shock-v1"
  status: Availability
  cards: EnergyCard[]
  priceSeries: EnergySeriesPoint[]
  inventoryProduction: EnergyBarPoint[]
  evidence: EnergyEvidenceRow[]
}
```

- [ ] **Step 4: Implement organization-scoped loaders and routes**

Use the existing `requireTenantContext`, research-read capability, Zod validation, backend loader, and `apiError` patterns. Clamp user date ranges server-side.

- [ ] **Step 5: Re-run tests**

Run: `npm test -- src/lib/backend/smart-insights-macro.test.ts src/app/api/smart-insights/macro/events/route.test.ts src/app/api/smart-insights/macro/energy/route.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/backend/smart-insights-types.ts src/lib/smart-insights-client.ts src/lib/backend/smart-insights-macro.ts src/lib/backend/smart-insights-macro.test.ts src/app/api/smart-insights/macro
git commit -m "feat: expose macro event and energy views"
```

### Task 10: Add Macro Quant Pulse tabs in the existing style

**Files:**

- Create: `src/components/smart-insights/MacroQuantPulseTabs.tsx`
- Create: `src/components/smart-insights/EventRiskPanel.tsx`
- Create: `src/components/smart-insights/EnergyPulsePanel.tsx`
- Modify: `src/components/smart-insights/LegacyMarketPulse.tsx`
- Create: `src/components/smart-insights/MacroQuantPulseTabs.test.tsx`

- [ ] **Step 1: Write failing component tests**

Assert the existing Macro content remains, new tabs are keyboard-accessible, each tab has at most four cards, status labels accompany color, charts expose units/as-of/methodology, unavailable data is not replaced with seed values, and compact evidence rows render on mobile.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- src/components/smart-insights/MacroQuantPulseTabs.test.tsx`

- [ ] **Step 3: Implement tab shell and view hierarchy**

```tsx
<Tabs defaultValue="regime">
  <TabsList className="w-full justify-start overflow-x-auto">
    <TabsTrigger value="regime">Regime</TabsTrigger>
    <TabsTrigger value="events">Event Risk</TabsTrigger>
    <TabsTrigger value="energy">Energy</TabsTrigger>
  </TabsList>
  <TabsContent value="regime">{existingMacroView}</TabsContent>
  <TabsContent value="events"><EventRiskPanel data={events} /></TabsContent>
  <TabsContent value="energy"><EnergyPulsePanel data={energy} /></TabsContent>
</Tabs>
```

Use existing card, typography, spacing, freshness badge, and chart tooltip components. Set Recharts animation off for continuously updated series. Tables become labeled stacked rows below the existing mobile breakpoint.

- [ ] **Step 4: Re-run component tests**

Run: `npm test -- src/components/smart-insights/MacroQuantPulseTabs.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run type, lint, and build gates**

Run: `npm run lint`
Run: `npm run build`

- [ ] **Step 6: Commit**

```powershell
git add src/components/smart-insights/MacroQuantPulseTabs.tsx src/components/smart-insights/EventRiskPanel.tsx src/components/smart-insights/EnergyPulsePanel.tsx src/components/smart-insights/LegacyMarketPulse.tsx src/components/smart-insights/MacroQuantPulseTabs.test.tsx
git commit -m "feat: add macro event and energy pulse tabs"
```

### Task 11: Apply migration, live-smoke sources individually, and enable only passing sources

**Files:**

- Modify only after evidence: `quant-worker/smart_insights/sources.py`
- Create: `docs/smart-insights/source-smoke-2026-08-14.md`

- [ ] **Step 1: Verify the exact database target before mutation**

Run: `npx prisma migrate status`

Record the database host/name without secrets. Stop if it is not the intended local/deployment database.

- [ ] **Step 2: Apply the migration**

Run: `npx prisma migrate deploy`

- [ ] **Step 3: Smoke one disabled source at a time**

For each source, run the bounded live-smoke command supported by `collect_smart_insights.py`. Validate HTTP status, schema, timestamps, units, record count, freshness, persisted observation, read-back, and source-health status.

- [ ] **Step 4: Document objective smoke evidence**

Use a table with source, timestamp, environment, record count, newest observation, parser version, persistence/read-back, health, and decision. Never include credentials or raw tokens.

- [ ] **Step 5: Enable only passing sources**

Change `enabled=False` to `enabled=True` only for sources whose complete smoke row is `PASS`. EIA remains disabled when `EIA_API_KEY` is absent. A failed source remains disabled and the UI shows unavailable/stale states.

- [ ] **Step 6: Run the registry and pipeline gates again**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_smart_insights_foundation.py quant-worker/tests/test_smart_insights_event_pipeline_integration.py -q`

- [ ] **Step 7: Commit evidence and gated enablement**

```powershell
git add quant-worker/smart_insights/sources.py docs/smart-insights/source-smoke-2026-08-14.md
git commit -m "ops: gate macro sources with live smoke evidence"
```

### Task 12: Final regression and browser verification

**Files:**

- Modify only if a verified defect is found.

- [ ] **Step 1: Run the Python Smart Insights suite**

Run: `$env:PYTHONPATH='quant-worker'; python -m pytest quant-worker/tests/test_smart_insights_*.py -q`

- [ ] **Step 2: Run frontend tests, lint, and build**

Run: `npm test`
Run: `npm run lint`
Run: `npm run build`

- [ ] **Step 3: Start the canonical local stack and verify health**

Run: `npm run dev:local`

Verify web `http://localhost:3100` and worker health `http://localhost:8100/healthz` before browser QA.

- [ ] **Step 4: Browser QA Smart Insights**

Check desktop, tablet, and mobile: original blocks remain; Macro tabs work; chart tooltips and timezones are readable; mobile evidence rows are not clipped; no fast animations; source status is explicit; there is no seed/live ambiguity; no WorldMonitor branding or copied UI appears.

- [ ] **Step 5: Inspect the final diff and license boundary**

Run: `git diff --check`
Run: `git status --short`
Run: `rg -n -i "worldmonitor|last30days|ai[-_ ]berkshire|daily[_ ]stock[_ ]analysis" --glob '!docs/superpowers/**' .`

Expected: no runtime WorldMonitor code/reference and no rejected integration reference except intentional migration cleanup or test assertions.

- [ ] **Step 6: Commit any test-only corrections, then request code review**

Do not merge or push until the implementation diff, test evidence, migration target, and live-smoke decisions have been reviewed.
