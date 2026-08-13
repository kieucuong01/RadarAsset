# Smart Insights Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the immutable observation, source-policy, Firecrawl, publication, scheduling, and Data Health foundation required by every Smart Insights market vertical.

**Architecture:** Reuse PostgreSQL `DataProvider` identity and the Python worker's psycopg patterns. A private Firecrawl REST client and direct-API transport write bounded raw artifacts, then one transaction publishes validated metric observations and source-run state; Next.js exposes read-only source health under the existing tenant research permission.

**Tech Stack:** Next.js 16 App Router, TypeScript 5.8, Zod 4, Prisma 7, PostgreSQL, Python 3.12-compatible standard library, psycopg 3, pytest, Vitest, PowerShell scheduler wrapper, self-hosted Firecrawl REST API.

## Global Constraints

- Smart Insights is non-commercial research; every provider remains explicitly licensed or marked `research_only`.
- Only code-owned allow-listed HTTPS source URLs may reach direct transports or Firecrawl.
- Never bypass login, captcha, paywall, access controls, or `robots.txt`.
- Raw provider bodies stay private; browser APIs expose normalized observations, provenance, and bounded errors only.
- An invalid or late source cannot replace the last validated observation.
- Store `effectiveAt`, `publishedAt`, and `observedAt` as separate timestamps.
- Jobs must be idempotent and protected against concurrent publication.
- Production runtime must never fall back to seed/sample market values.
- Preserve the existing `next-env.d.ts` working-tree change and stage only files named by each task.
- Node.js remains `>=20.9.0`; do not add a UI library.

---

## File Structure

### Persistence

- `prisma/schema.prisma`: observation, snapshot, signal, preference, briefing, and briefing-item relations.
- `prisma/migrations/202608130001_smart_insights_foundation/migration.sql`: tables, checks, uniqueness, and indexes.
- `src/lib/backend/tenant-isolation.integration.test.ts`: user preference and briefing tenant isolation.

### Worker foundation

- `quant-worker/smart_insights/__init__.py`: package boundary.
- `quant-worker/smart_insights/contracts.py`: enums and immutable dataclasses shared by all collectors.
- `quant-worker/smart_insights/sources.py`: source registry and fixed URL allow-list.
- `quant-worker/smart_insights/http.py`: bounded redirect-rejecting direct HTTP transport.
- `quant-worker/smart_insights/firecrawl.py`: private Firecrawl `/v2/scrape` client.
- `quant-worker/smart_insights/artifacts.py`: atomic gzip artifact persistence and checksum verification.
- `quant-worker/smart_insights/validation.py`: common observation validation and typed failures.
- `quant-worker/smart_insights/repository.py`: PostgreSQL run, snapshot, and observation publication.
- `quant-worker/collect_smart_insights.py`: bounded CLI used by platform schedulers.
- `quant-worker/tests/test_smart_insights_foundation.py`: contracts, registry, transport, artifact, and validation tests.
- `quant-worker/tests/test_smart_insights_repository_integration.py`: transactional publication tests.

### Web health boundary

- `src/lib/backend/smart-insights-types.ts`: strict public health types.
- `src/lib/backend/smart-insights-data-health.ts`: source-health query and freshness mapping.
- `src/app/api/smart-insights/data-health/route.ts`: tenant-protected read route.
- `src/app/api/tenant-routes.test.ts`: authorization and bounded response test.
- `.env.example`: Firecrawl, artifact, and scheduler configuration.
- `scripts/run-smart-insights.ps1`: scheduler entry point.
- `README.md`: local service and scheduler commands.

---

### Task 1: Add durable Smart Insights persistence

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608130001_smart_insights_foundation/migration.sql`
- Modify: `src/lib/backend/tenant-isolation.integration.test.ts`

**Interfaces:**

- Consumes: existing `AppUser`, `Organization`, `Asset`, `DataProvider`, `ResearchRun`, `AiInsight`, and `EvidenceItem`.
- Produces: Prisma models `InsightRawSnapshot`, `MetricDefinition`, `MetricObservation`, `SignalSnapshot`, `UserInsightPreference`, `DailyBriefing`, and `DailyBriefingItem`.

- [ ] **Step 1: Write failing two-tenant persistence tests**

Create one preference and one briefing per organization, then assert isolation and cascade behavior:

```ts
const visibleToA = await prisma.dailyBriefing.findMany({
  where: { organizationId: fixtures.organizationAId, userId: fixtures.userAId },
  include: { items: true },
});
expect(visibleToA).toHaveLength(1);
expect(visibleToA[0]?.organizationId).toBe(fixtures.organizationAId);

await prisma.organization.delete({ where: { id: fixtures.organizationAId } });
expect(await prisma.dailyBriefing.count({
  where: { organizationId: fixtures.organizationBId },
})).toBe(1);
```

Also assert that duplicate raw `(providerId, sourceUrl, contentHash)`, metric `(code)`, canonical observation revision, signal idempotency key, preference `(organizationId, userId)`, and briefing item `(dailyBriefingId, rank)` are rejected.

- [ ] **Step 2: Run the isolated integration test and verify RED**

Run: `npm run test:integration -- src/lib/backend/tenant-isolation.integration.test.ts`

Expected: FAIL because the new Prisma models do not exist.

- [ ] **Step 3: Add Prisma relations and models**

Add these collection fields to the existing models before adding the new models:

```prisma
// AppUser
insightPreferences UserInsightPreference[]
dailyBriefings     DailyBriefing[]

// Organization
insightPreferences UserInsightPreference[]
dailyBriefings     DailyBriefing[]

// Asset
metricObservations MetricObservation[]
signalSnapshots    SignalSnapshot[]

// DataProvider
rawInsightSnapshots InsightRawSnapshot[]
metricObservations  MetricObservation[]

// ResearchRun
dailyBriefings DailyBriefing[]

// AiInsight
dailyBriefingItems DailyBriefingItem[]

// ProviderRun: add telemetry fields to the existing model
errorCode  String? @map("error_code")
retryCount Int     @default(0) @map("retry_count")
durationMs Int?    @map("duration_ms")
metadata   Json    @default("{}")
```

Then add these model contracts using existing UUID/timestamp conventions:

```prisma
model InsightRawSnapshot {
  id             String              @id @default(uuid()) @db.Uuid
  providerId     String              @map("provider_id") @db.Uuid
  sourceUrl      String              @map("source_url") @db.Text
  effectiveAt    DateTime?           @map("effective_at") @db.Timestamptz(3)
  publishedAt    DateTime?           @map("published_at") @db.Timestamptz(3)
  observedAt     DateTime            @map("observed_at") @db.Timestamptz(3)
  contentHash    String              @map("content_hash")
  contentType    String              @map("content_type")
  storageLocator String              @map("storage_locator") @db.Text
  parserVersion  String              @map("parser_version")
  status         String
  errorCode      String?             @map("error_code")
  metadata       Json                @default("{}")
  provider       DataProvider        @relation(fields: [providerId], references: [id], onDelete: Restrict)
  observations   MetricObservation[]

  @@unique([providerId, sourceUrl, contentHash])
  @@index([providerId, observedAt(sort: Desc)])
  @@index([status, observedAt])
  @@map("insight_raw_snapshots")
}

model MetricDefinition {
  id                  String              @id @default(uuid()) @db.Uuid
  code                String              @unique
  market              String
  name                String
  unit                String
  frequency           String
  direction           Int                 @default(1)
  methodologyVersion  String              @map("methodology_version")
  freshnessSlaMinutes Int                 @map("freshness_sla_minutes")
  metadata            Json                @default("{}")
  createdAt           DateTime            @default(now()) @map("created_at")
  updatedAt           DateTime            @updatedAt @map("updated_at")
  observations        MetricObservation[]

  @@index([market, code])
  @@map("metric_definitions")
}

model MetricObservation {
  id                 String             @id @default(uuid()) @db.Uuid
  metricDefinitionId String             @map("metric_definition_id") @db.Uuid
  providerId         String             @map("provider_id") @db.Uuid
  assetId            String?            @map("asset_id") @db.Uuid
  rawSnapshotId      String             @map("raw_snapshot_id") @db.Uuid
  effectiveAt        DateTime           @map("effective_at") @db.Timestamptz(3)
  effectiveStart     DateTime?          @map("effective_start") @db.Timestamptz(3)
  effectiveEnd       DateTime?          @map("effective_end") @db.Timestamptz(3)
  publishedAt        DateTime?          @map("published_at") @db.Timestamptz(3)
  observedAt         DateTime           @map("observed_at") @db.Timestamptz(3)
  revision           Int                @default(1)
  value              Decimal            @db.Decimal(30, 10)
  naturalKey         String             @map("natural_key")
  dimensionKey       String             @map("dimension_key")
  dimensions         Json               @default("{}")
  qualityStatus      String             @map("quality_status")
  qualityFlags       Json               @default("[]") @map("quality_flags")
  metricDefinition   MetricDefinition   @relation(fields: [metricDefinitionId], references: [id], onDelete: Restrict)
  provider           DataProvider       @relation(fields: [providerId], references: [id], onDelete: Restrict)
  asset              Asset?             @relation(fields: [assetId], references: [id], onDelete: Restrict)
  rawSnapshot        InsightRawSnapshot @relation(fields: [rawSnapshotId], references: [id], onDelete: Restrict)

  @@unique([naturalKey, revision])
  @@index([metricDefinitionId, assetId, effectiveAt(sort: Desc)])
  @@index([rawSnapshotId])
  @@map("metric_observations")
}

model SignalSnapshot {
  id                 String              @id @default(uuid()) @db.Uuid
  market             String
  assetId            String?             @map("asset_id") @db.Uuid
  effectiveAt        DateTime            @map("effective_at") @db.Timestamptz(3)
  methodologyVersion String              @map("methodology_version")
  signalType         String              @map("signal_type")
  score              Decimal?            @db.Decimal(8, 4)
  label              String
  dataConfidence     Decimal             @map("data_confidence") @db.Decimal(5, 2)
  coverage           Decimal             @db.Decimal(5, 4)
  inputs             Json                @default("{}")
  status             String
  idempotencyKey     String              @unique @map("idempotency_key")
  createdAt          DateTime            @default(now()) @map("created_at")
  asset              Asset?              @relation(fields: [assetId], references: [id], onDelete: Restrict)
  briefingItems      DailyBriefingItem[]

  @@index([market, assetId, effectiveAt(sort: Desc)])
  @@index([status, effectiveAt(sort: Desc)])
  @@map("signal_snapshots")
}

model UserInsightPreference {
  id                String       @id @default(uuid()) @db.Uuid
  organizationId    String       @map("organization_id") @db.Uuid
  userId            String       @map("user_id") @db.Uuid
  markets           Json         @default("[]")
  assets            Json         @default("[]")
  locale            String       @default("vi")
  baseCurrency      String       @default("USD") @map("base_currency")
  investmentHorizon String       @map("investment_horizon")
  riskTolerance     String       @map("risk_tolerance")
  alertPreferences  Json         @default("{}") @map("alert_preferences")
  createdAt         DateTime     @default(now()) @map("created_at")
  updatedAt         DateTime     @updatedAt @map("updated_at")
  organization      Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user              AppUser      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([organizationId, userId])
  @@index([userId])
  @@map("user_insight_preferences")
}

model DailyBriefing {
  id                 String              @id @default(uuid()) @db.Uuid
  organizationId     String              @map("organization_id") @db.Uuid
  userId             String              @map("user_id") @db.Uuid
  researchRunId      String              @unique @map("research_run_id") @db.Uuid
  effectiveDate      DateTime            @map("effective_date") @db.Date
  effectiveAt        DateTime            @map("effective_at") @db.Timestamptz(3)
  timezone           String
  revision           Int
  fingerprint        String
  modelName          String?             @map("model_name")
  promptVersion      String              @map("prompt_version")
  methodologyVersion String              @map("methodology_version")
  status             String
  marketSummary      Json                @default("{}") @map("market_summary")
  dataConfidence     Decimal             @map("data_confidence") @db.Decimal(5, 2)
  portfolioSnapshot  Json                @default("{}") @map("portfolio_snapshot")
  preferenceSnapshot Json                @default("{}") @map("preference_snapshot")
  createdAt          DateTime            @default(now()) @map("created_at")
  organization       Organization        @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user               AppUser             @relation(fields: [userId], references: [id], onDelete: Cascade)
  researchRun        ResearchRun         @relation(fields: [researchRunId], references: [id], onDelete: Cascade)
  items              DailyBriefingItem[]

  @@unique([organizationId, userId, effectiveDate, revision])
  @@index([organizationId, userId, effectiveDate, revision(sort: Desc)])
  @@map("daily_briefings")
}

model DailyBriefingItem {
  id                       String         @id @default(uuid()) @db.Uuid
  dailyBriefingId          String         @map("daily_briefing_id") @db.Uuid
  signalSnapshotId         String         @map("signal_snapshot_id") @db.Uuid
  aiInsightId              String?        @map("ai_insight_id") @db.Uuid
  rank                     Int
  section                  String
  relevanceScore           Decimal        @map("relevance_score") @db.Decimal(5, 2)
  relevanceComponents      Json           @default("{}") @map("relevance_components")
  supportingEvidenceIds    Json           @default("[]") @map("supporting_evidence_ids")
  contradictingEvidenceIds Json           @default("[]") @map("contradicting_evidence_ids")
  affectedAssets           Json           @default("[]") @map("affected_assets")
  timeHorizon              String         @map("time_horizon")
  riskScenarios            Json           @default("[]") @map("risk_scenarios")
  suggestedCheckTemplate   String         @map("suggested_check_template")
  explanationStatus        String         @map("explanation_status")
  confidence               Decimal        @db.Decimal(5, 2)
  outcomes                 Json           @default("{}")
  createdAt                DateTime       @default(now()) @map("created_at")
  dailyBriefing            DailyBriefing  @relation(fields: [dailyBriefingId], references: [id], onDelete: Cascade)
  signalSnapshot           SignalSnapshot @relation(fields: [signalSnapshotId], references: [id], onDelete: Restrict)
  aiInsight                AiInsight?     @relation(fields: [aiInsightId], references: [id], onDelete: Restrict)

  @@unique([dailyBriefingId, rank])
  @@index([signalSnapshotId])
  @@index([aiInsightId])
  @@map("daily_briefing_items")
}
```

For source-period facts, `effectiveAt` is the canonical period end used by point-in-time queries; `effectiveStart` and `effectiveEnd` retain the reported range. Point facts leave the range nullable and APIs map both display boundaries to `effectiveAt`. `naturalKey` is SHA-256 over canonical metric code, provider code, asset ID or the literal `GLOBAL`, UTC effective time, and `dimensionKey`; using a non-null hash avoids PostgreSQL nullable-unique gaps for global observations.

- [ ] **Step 4: Add database-only checks and indexes**

Append exact checks to the generated SQL:

```sql
ALTER TABLE insight_raw_snapshots
  ADD CONSTRAINT insight_raw_snapshot_status_check
  CHECK (status IN ('fetched', 'validated', 'quarantined'));

ALTER TABLE metric_definitions
  ADD CONSTRAINT metric_definition_market_check CHECK (market IN ('crypto', 'macro', 'gold')),
  ADD CONSTRAINT metric_definition_direction_check CHECK (direction IN (-1, 0, 1)),
  ADD CONSTRAINT metric_definition_freshness_check CHECK (freshness_sla_minutes > 0);

ALTER TABLE metric_observations
  ADD CONSTRAINT metric_observation_quality_check
  CHECK (quality_status IN ('passed', 'warning', 'conflicting')),
  ADD CONSTRAINT metric_observation_revision_check CHECK (revision > 0),
  ADD CONSTRAINT metric_observation_period_check CHECK (
    (effective_start IS NULL AND effective_end IS NULL)
    OR (effective_start IS NOT NULL AND effective_end IS NOT NULL
        AND effective_start <= effective_at AND effective_at = effective_end)
  );

ALTER TABLE provider_runs
  ADD CONSTRAINT provider_run_status_check CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'quarantined')),
  ADD CONSTRAINT provider_run_retry_count_check CHECK (retry_count >= 0),
  ADD CONSTRAINT provider_run_duration_check CHECK (duration_ms IS NULL OR duration_ms >= 0);

ALTER TABLE signal_snapshots
  ADD CONSTRAINT signal_snapshot_market_check CHECK (market IN ('crypto', 'macro', 'gold')),
  ADD CONSTRAINT signal_snapshot_confidence_check CHECK (data_confidence BETWEEN 0 AND 100),
  ADD CONSTRAINT signal_snapshot_coverage_check CHECK (coverage BETWEEN 0 AND 1),
  ADD CONSTRAINT signal_snapshot_status_check CHECK (status IN ('active', 'stale', 'conflicting', 'unavailable'));

ALTER TABLE user_insight_preferences
  ADD CONSTRAINT user_insight_preference_locale_check CHECK (locale IN ('vi', 'en'));

ALTER TABLE daily_briefings
  ADD CONSTRAINT daily_briefing_revision_check CHECK (revision > 0),
  ADD CONSTRAINT daily_briefing_confidence_check CHECK (data_confidence BETWEEN 0 AND 100),
  ADD CONSTRAINT daily_briefing_status_check CHECK (status IN ('complete', 'partial', 'quant_only'));

ALTER TABLE daily_briefing_items
  ADD CONSTRAINT daily_briefing_item_section_check
  CHECK (section IN ('primary_change', 'risk_alert')),
  ADD CONSTRAINT daily_briefing_item_rank_check CHECK (rank BETWEEN 1 AND 5),
  ADD CONSTRAINT daily_briefing_item_confidence_check CHECK (confidence BETWEEN 0 AND 100),
  ADD CONSTRAINT daily_briefing_item_explanation_check
  CHECK (explanation_status IN ('accepted', 'unavailable', 'rejected'));
```

Create a partial index that makes the latest observation lookup fast:

```sql
CREATE INDEX metric_observations_latest_lookup
ON metric_observations (metric_definition_id, asset_id, effective_at DESC, revision DESC)
WHERE quality_status IN ('passed', 'warning');
```

- [ ] **Step 5: Apply migration and verify Prisma**

Run: `npx prisma migrate dev --name smart_insights_foundation`

Run: `npx prisma validate`

Expected: migration applies and schema validation succeeds.

- [ ] **Step 6: Run tenant integration test and commit**

Run: `npm run test:integration -- src/lib/backend/tenant-isolation.integration.test.ts`

Expected: PASS.

```bash
git add prisma/schema.prisma prisma/migrations/202608130001_smart_insights_foundation/migration.sql src/lib/backend/tenant-isolation.integration.test.ts
git commit -m "feat: add smart insights persistence"
```

---

### Task 2: Define source contracts and the code-owned registry

**Files:**

- Create: `quant-worker/smart_insights/__init__.py`
- Create: `quant-worker/smart_insights/contracts.py`
- Create: `quant-worker/smart_insights/sources.py`
- Create: `quant-worker/tests/test_smart_insights_foundation.py`

**Interfaces:**

- Produces: `SourceDefinition`, `RawSnapshot`, `ObservationInput`, `SourceRunResult`, `source_for_code(code)`, and `sources_for_schedule(schedule)`.

- [ ] **Step 1: Write failing contract and registry tests**

```python
def test_registry_rejects_unknown_and_non_https_sources() -> None:
    assert source_for_code("alternative-fng").collection_mode is CollectionMode.API
    with pytest.raises(KeyError):
        source_for_code("user-supplied")
    with pytest.raises(ValueError, match="HTTPS"):
        SourceDefinition(
            code="bad", name="Bad", market=Market.CRYPTO,
            collection_mode=CollectionMode.API,
            license_scope=LicenseScope.RESEARCH_ONLY,
            urls=("http://example.test",), schedule="daily",
            freshness_sla_minutes=1440, parser_version="1",
            quality_tier=Decimal("1"),
        )

def test_dimension_key_is_canonical() -> None:
    row = ObservationInput(metric_code="crypto.etf.net_flow_usd", value=Decimal("10"),
        effective_at=NOW, dimensions={"fund": "IBIT", "asset": "BTC"})
    assert row.dimension_key == '{"asset":"BTC","fund":"IBIT"}'
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_foundation.py -q`

Expected: FAIL because `smart_insights` does not exist.

- [ ] **Step 3: Implement immutable contracts**

```python
class Market(StrEnum):
    CRYPTO = "crypto"
    MACRO = "macro"
    GOLD = "gold"

class CollectionMode(StrEnum):
    API = "api"
    FIRECRAWL = "firecrawl"
    MANUAL = "manual"
    DISABLED = "disabled"

@dataclass(frozen=True)
class ObservationInput:
    metric_code: str
    value: Decimal
    effective_at: datetime
    effective_start: datetime | None = None
    effective_end: datetime | None = None
    published_at: datetime | None = None
    asset_symbol: str | None = None
    dimensions: Mapping[str, str] = field(default_factory=dict)
    quality_status: str = "passed"
    quality_flags: tuple[str, ...] = ()

    @property
    def dimension_key(self) -> str:
        return json.dumps(dict(sorted(self.dimensions.items())), separators=(",", ":"))
```

Define `RawSnapshot(content: bytes, content_type, source_url, effective_at, published_at, observed_at, metadata)` and `SourceRunResult(source_code, status, records_fetched, error_code, retry_count, started_at, finished_at)` with timezone-aware timestamp validation. `ObservationInput.effective_at` is always the point time or reported period end; when a source reports a range, both optional boundaries must be present and contain `effective_at`.

- [ ] **Step 4: Implement the initial registry**

Register these exact source codes and code-owned URLs, all with `enabled=False` until their vertical plan's live smoke succeeds:

```python
SOURCE_ROWS = (
    # code, mode, URLs, schedule, parser, SLA minutes, quality tier
    ("alternative-fng", CollectionMode.API, ("https://api.alternative.me/fng/?limit=0&format=json",), "daily", "alternative-fng-v1", 2880, "community_api"),
    ("farside-btc-etf", CollectionMode.FIRECRAWL, ("https://farside.co.uk/btc/",), "daily", "farside-btc-v1", 2880, "firecrawl_table"),
    ("farside-eth-etf", CollectionMode.FIRECRAWL, ("https://farside.co.uk/eth/",), "daily", "farside-eth-v1", 2880, "firecrawl_table"),
    ("farside-sol-etf", CollectionMode.FIRECRAWL, ("https://farside.co.uk/sol/",), "daily", "farside-sol-v1", 2880, "firecrawl_table"),
    ("coinmetrics-community", CollectionMode.API, ("https://community-api.coinmetrics.io/v4/timeseries/asset-metrics",), "daily", "coinmetrics-v1", 2880, "community_api"),
    ("mempool-space", CollectionMode.API, ("https://mempool.space/api/v1/fees/recommended", "https://mempool.space/api/mempool", "https://mempool.space/api/v1/mining/hashrate/3y"), "daily", "mempool-v1", 1440, "community_api"),
    ("defillama-stablecoins", CollectionMode.API, ("https://stablecoins.llama.fi/stablecoincharts/all",), "daily", "defillama-stablecoins-v1", 2880, "community_api"),
    ("defillama-chains", CollectionMode.API, ("https://api.llama.fi/v2/chains",), "daily", "defillama-chains-v1", 1440, "community_api"),
    ("deribit-public", CollectionMode.API, ("https://www.deribit.com/api/v2/public/get_volatility_index_data", "https://www.deribit.com/api/v2/public/ticker"), "daily", "deribit-v1", 1440, "direct_api"),
    ("coinshares-weekly", CollectionMode.FIRECRAWL, ("https://coinshares.com/insights/research-data/",), "weekly", "coinshares-v1", 10080, "firecrawl_table"),
    ("bitinfocharts-top-addresses", CollectionMode.FIRECRAWL, ("https://bitinfocharts.com/top-100-richest-bitcoin-addresses.html",), "daily", "bitinfocharts-v1", 2880, "heuristic"),
    ("cryptocraft", CollectionMode.FIRECRAWL, ("https://www.cryptocraft.com/calendar?week=this", "https://www.cryptocraft.com/calendar?week=next"), "calendar", "cryptocraft-v1", 120, "firecrawl_table"),
    ("fred", CollectionMode.API, ("https://api.stlouisfed.org/fred/series/observations",), "daily", "fred-v1", 4320, "official_api"),
    ("cftc-legacy", CollectionMode.API, ("https://publicreporting.cftc.gov/resource/srt6-5q2f.json",), "weekly", "cftc-legacy-v1", 14400, "official_api"),
    ("cftc-disaggregated", CollectionMode.API, ("https://publicreporting.cftc.gov/resource/72hh-3qpy.json",), "weekly", "cftc-disaggregated-v1", 14400, "official_api"),
    ("wgc-gold-etf", CollectionMode.FIRECRAWL, ("https://www.gold.org/goldhub/data/gold-etfs-holdings-and-flows",), "source_period", "wgc-etf-v1", 20160, "firecrawl_table"),
    ("wgc-central-bank", CollectionMode.FIRECRAWL, ("https://www.gold.org/goldhub/data/gold-reserves-by-country",), "source_period", "wgc-central-bank-v1", 172800, "firecrawl_table"),
)
```

`cryptocraft` may additionally follow event-detail URLs only when the parsed link remains on `www.cryptocraft.com` under `/calendar/`; `coinshares-weekly` may follow the newest `/insights/research-data/fund-flows-*/` link discovered on its registered index; each `wgc-*` source may download an `.xlsx` link discovered on its own registered landing page only when it remains on `www.gold.org` under `/download/file/`. Redirects and every other discovered link are rejected. Store terms/attribution URL and license scope per row: FRED/CFTC are `public_official`; all other new rows are `research_only`. `source_for_code` returns only registered definitions; `sources_for_schedule` returns enabled sources sorted by code. Do not accept a URL from CLI or HTTP input.

- [ ] **Step 5: Run tests and commit**

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_foundation.py -q`

Expected: PASS.

```bash
git add quant-worker/smart_insights quant-worker/tests/test_smart_insights_foundation.py
git commit -m "feat: define smart insights source contracts"
```

---

### Task 3: Add bounded HTTP, Firecrawl, and artifact storage

**Files:**

- Create: `quant-worker/smart_insights/http.py`
- Create: `quant-worker/smart_insights/firecrawl.py`
- Create: `quant-worker/smart_insights/artifacts.py`
- Modify: `quant-worker/tests/test_smart_insights_foundation.py`
- Modify: `.env.example`

**Interfaces:**

- Consumes: `SourceDefinition`, code-owned source URLs.
- Produces: `UrllibTransport.fetch(url, *, timeout_seconds, max_bytes) -> HttpResponse`, `FirecrawlClient.scrape(source, url) -> RawSnapshot`, and `ArtifactStore.write(snapshot, source_code) -> StoredArtifact`.

- [ ] **Step 1: Write failing boundary tests**

Use fake openers and a temporary directory:

```python
def test_firecrawl_rejects_url_outside_source_allowlist() -> None:
    client = FirecrawlClient("http://127.0.0.1:3002", transport=FakeTransport())
    with pytest.raises(ValueError, match="allow-listed"):
        client.scrape(source_for_code("farside-btc-etf"), "https://evil.invalid")

def test_artifact_store_is_atomic_and_content_addressed(tmp_path: Path) -> None:
    stored = ArtifactStore(tmp_path).write(snapshot(b"payload"), "farside-btc-etf")
    assert stored.content_hash == hashlib.sha256(b"payload").hexdigest()
    assert ArtifactStore(tmp_path).read(stored.locator) == b"payload"
    assert not list(tmp_path.rglob("*.tmp"))
```

Also test redirect rejection, `429` mapping, response-size cap, invalid JSON, timeout, locator traversal rejection, and hash mismatch on read.

- [ ] **Step 2: Run tests and verify RED**

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_foundation.py -q`

Expected: FAIL because clients are missing.

- [ ] **Step 3: Implement the transport and Firecrawl client**

`UrllibTransport` uses a no-redirect handler, three attempts for `429/5xx`, bounded exponential backoff, `Retry-After` capped at 60 seconds, a 20 MB response cap, and sanitized `SourceFetchError(code)` exceptions.

Firecrawl request contract:

```python
payload = {
    "url": url,
    "onlyMainContent": True,
    "timeout": 30_000,
    "formats": ["markdown", "rawHtml"],
}
response = transport.post_json(
    f"{base_url}/v2/scrape", payload,
    headers={"Authorization": f"Bearer {api_key}"} if api_key else {},
    timeout_seconds=45, max_bytes=20_000_000,
)
```

Require `success is True`, a matching final `sourceURL`, and at least one of Markdown/raw HTML. Convert the bounded JSON response into a `RawSnapshot` without logging provider content.

- [ ] **Step 4: Implement atomic gzip artifacts**

Use standard-library `gzip`, `tempfile.NamedTemporaryFile(delete=False, dir=target.parent)`, `os.replace`, and SHA-256. The relative locator is:

```text
<source-code>/<YYYY>/<MM>/<content-hash>.json.gz
```

Resolve every read under the configured root and reject paths that escape it.

- [ ] **Step 5: Add exact environment configuration**

```dotenv
FIRECRAWL_API_URL=http://127.0.0.1:3002
# FIRECRAWL_API_KEY=only-when-the-private-instance-enables-auth
SMART_INSIGHTS_ARTIFACT_ROOT=.local-data/smart-insights
SMART_INSIGHTS_HTTP_TIMEOUT_SECONDS=30
SMART_INSIGHTS_MAX_RESPONSE_BYTES=20000000
SMART_INSIGHTS_TIMEZONE=Asia/Bangkok
```

- [ ] **Step 6: Run tests and commit**

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_foundation.py -q`

Expected: PASS.

```bash
git add quant-worker/smart_insights/http.py quant-worker/smart_insights/firecrawl.py quant-worker/smart_insights/artifacts.py quant-worker/tests/test_smart_insights_foundation.py .env.example
git commit -m "feat: add bounded smart insights collection"
```

---

### Task 4: Publish snapshots and observations transactionally

**Files:**

- Create: `quant-worker/smart_insights/validation.py`
- Create: `quant-worker/smart_insights/repository.py`
- Create: `quant-worker/tests/test_smart_insights_repository_integration.py`

**Interfaces:**

- Consumes: `SourceDefinition`, `StoredArtifact`, and `Sequence[ObservationInput]`.
- Produces: `validate_observations(source, rows) -> tuple[ObservationInput, ...]` and `PostgresInsightRepository.publish(source, snapshot, artifact, rows) -> PublicationResult`.

- [ ] **Step 1: Write failing validation and transaction tests**

```python
def test_validation_rejects_naive_time_and_non_finite_value() -> None:
    with pytest.raises(ObservationValidationError) as error:
        validate_observations(SOURCE, [ObservationInput(
            metric_code="crypto.test", value=Decimal("NaN"),
            effective_at=datetime(2026, 8, 13),
        )])
    assert error.value.code == "INVALID_TIMESTAMP"

def test_publication_revision_is_idempotent(repository) -> None:
    first = repository.publish(SOURCE, SNAPSHOT, ARTIFACT, ROWS)
    second = repository.publish(SOURCE, SNAPSHOT, ARTIFACT, ROWS)
    assert first.snapshot_id == second.snapshot_id
    assert second.status == "unchanged"
```

Also assert rollback when one metric is unknown, revised content creates revision 2, quarantined publication leaves the previous active revision queryable, and advisory locking prevents concurrent source/effective-period publication.

- [ ] **Step 2: Run tests and verify RED**

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_repository_integration.py -q`

Expected: FAIL because repository functions do not exist.

- [ ] **Step 3: Implement common validation**

Require aware UTC-normalizable timestamps, finite Decimal values, known metric codes, canonical dimensions, unique natural keys, quality status in `passed/warning/conflicting`, and source-specific maximum row count. Raise only these stable public codes: `INVALID_RESPONSE`, `MISSING_REQUIRED_FIELD`, `INVALID_UNIT`, `INVALID_TIMESTAMP`, `DUPLICATE_CONFLICT`, and `RECONCILIATION_FAILED`.

- [ ] **Step 4: Implement repository publication**

Inside one transaction:

1. Acquire `pg_try_advisory_xact_lock(hashtextextended('smart-insights:' || source.code || ':' || effective-day, 0))`.
2. Upsert `DataProvider` policy metadata without weakening an existing license scope.
3. Insert or locate `InsightRawSnapshot` by content hash.
4. Resolve every `MetricDefinition` and optional asset.
5. Calculate the canonical non-null `naturalKey`, compare its latest observation, and allocate revision `latest + 1` only when value or source revision changed.
6. Insert all observations or roll back all.
7. Mark the snapshot `validated` and insert a `ProviderRun` with `researchRunId=null`, `provider=source.code`, status, records, retry count, error code, start/finish, duration, and sanitized metadata.
8. Return counts and the provider-run ID.

Quarantine uses a separate method that records snapshot/error state plus a `ProviderRun(status='quarantined')` but inserts no observations. A transport/configuration failure without a body still inserts `ProviderRun(status='failed')` and no raw snapshot. Add repository queries `last_source_run(source_code)`, `last_successful_source_run(source_code)`, and `source_health_rows()`; all order by `(finished_at DESC NULLS LAST, created_at DESC)`.

- [ ] **Step 5: Run integration tests and commit**

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_repository_integration.py -q`

Expected: PASS against the configured test PostgreSQL database.

```bash
git add quant-worker/smart_insights/validation.py quant-worker/smart_insights/repository.py quant-worker/tests/test_smart_insights_repository_integration.py
git commit -m "feat: publish immutable insight observations"
```

---

### Task 5: Add scheduler CLI and tenant-protected Data Health

**Files:**

- Create: `quant-worker/collect_smart_insights.py`
- Create: `scripts/run-smart-insights.ps1`
- Create: `src/lib/backend/smart-insights-types.ts`
- Create: `src/lib/backend/smart-insights-data-health.ts`
- Create: `src/app/api/smart-insights/data-health/route.ts`
- Modify: `src/app/api/tenant-routes.test.ts`
- Modify: `README.md`

**Interfaces:**

- Produces: CLI `collect_smart_insights.py <schedule> [--source CODE] [--dry-run]`, `loadSmartInsightsDataHealth() -> Promise<SmartInsightsDataHealthResponse>`, and `GET /api/smart-insights/data-health`.

- [ ] **Step 1: Write failing CLI and route tests**

```python
def test_cli_selection_never_accepts_a_url() -> None:
    assert select_sources("daily", source_code="alternative-fng") == (
        source_for_code("alternative-fng"),
    )
    with pytest.raises(ValueError, match="registered"):
        select_sources("daily", source_code="https://evil.invalid")
```

Add a route assertion:

```ts
const response = await smartInsightsDataHealthGet();
expect(mocks.requireTenantCapability).toHaveBeenCalledWith(viewerContext, "research", "read");
expect(mocks.loadSmartInsightsDataHealth).toHaveBeenCalledOnce();
expect(response.status).toBe(200);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_foundation.py -q`

Run: `npm test -- src/app/api/tenant-routes.test.ts`

Expected: both fail because CLI/route are missing.

- [ ] **Step 3: Implement the CLI orchestration boundary**

Supported schedule values are `daily`, `weekly`, `monthly`, `calendar-current`, `calendar-next`, and `calendar-event`. The CLI loads `.env.local`, resolves registered sources, emits one sanitized JSON line per source plus a summary, returns 0 only when every selected source succeeded/unchanged, and returns 1 for partial failure or 2 for configuration error. Collector implementations are injected by source code; a source with no collector returns `SOURCE_NOT_IMPLEMENTED` and remains disabled.

- [ ] **Step 4: Add the PowerShell scheduler wrapper**

The wrapper resolves the repo root, `.env.local`, Python executable, and invokes only the code-owned CLI:

```powershell
param(
    [ValidateSet("daily", "weekly", "monthly", "calendar-current", "calendar-next", "calendar-event")]
    [string]$Schedule = "daily",
    [string]$PythonExecutable = "python",
    [switch]$DryRun
)
```

Use a task-specific temporary runtime directory and return the child exit code. Do not register a Windows scheduled task automatically.

- [ ] **Step 5: Implement Data Health query and route**

Public response contract:

```ts
export type SmartInsightSourceHealth = {
  sourceCode: string;
  sourceName: string;
  market: "crypto" | "macro" | "gold";
  collectionMode: "api" | "firecrawl" | "manual" | "disabled";
  parserVersion: string;
  lastEffectiveAt: string | null;
  lastObservedAt: string | null;
  lastStatus: "validated" | "quarantined" | "unavailable";
  lastErrorCode: string | null;
  freshness: "FRESH" | "STALE" | "UNAVAILABLE";
};
```

`loadSmartInsightsDataHealth` joins the code-owned registry with the latest `ProviderRun`, latest accepted observation, and latest quarantined snapshot. A disabled or never-run source returns `UNAVAILABLE`; a failed latest run reports its typed error while freshness is calculated from the last accepted observation and metric SLA. The route calls `requireTenantContext`, enforces `research/read`, accepts no organization query parameter, and returns no artifact locator, raw payload, provider response, or storage path.

- [ ] **Step 6: Document exact local commands**

Document Firecrawl as a separately operated private service and add:

```powershell
powershell.exe -NoProfile -File scripts/run-smart-insights.ps1 -Schedule daily -DryRun
powershell.exe -NoProfile -File scripts/run-smart-insights.ps1 -Schedule daily
```

- [ ] **Step 7: Run verification and commit**

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_foundation.py quant-worker/tests/test_smart_insights_repository_integration.py -q`

Run: `npm test -- src/app/api/tenant-routes.test.ts`

Run: `npm run lint`

Expected: all pass.

```bash
git add quant-worker/collect_smart_insights.py scripts/run-smart-insights.ps1 src/lib/backend/smart-insights-types.ts src/lib/backend/smart-insights-data-health.ts src/app/api/smart-insights/data-health/route.ts src/app/api/tenant-routes.test.ts README.md
git commit -m "feat: operate smart insights source health"
```

---

## Plan 1 Completion Gate

- Prisma migration and tenant integration tests pass.
- Firecrawl cannot receive a user-supplied URL.
- Raw artifacts are bounded, atomic, content-addressed, and private.
- Publication is idempotent, transactional, revision-aware, and quarantine-safe.
- Scheduler CLI and Data Health return sanitized typed states.
- No market collector is considered enabled until its later vertical plan adds a live smoke and production parser.
