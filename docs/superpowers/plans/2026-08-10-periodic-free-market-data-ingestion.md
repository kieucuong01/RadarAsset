# Periodic Free Market Data Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace active research fixtures with scheduled, observable, research-only `1h` and `1d` ingestion for Binance BTC/USDT, Vnstock FPT, and Dukascopy-backed XAU/USD while preserving the last known-good dataset on every failure.

**Architecture:** A standalone Python CLI is invoked by Windows Task Scheduler, cron, or a hosting scheduler. Provider adapters return bounded normalized bars; an orchestrator merges a recent overlap with the active immutable snapshot, compares checksums, and publishes each asset/timeframe independently under a PostgreSQL advisory lock. Prisma exposes global ingestion health through a tenant-authenticated API, and Quant Lab renders the real provider/freshness state.

**Tech Stack:** Python 3.12, urllib, Vnstock v4, psycopg 3, PostgreSQL advisory locks, Prisma 7/PostgreSQL, Next.js 16 App Router, TypeScript, Zod, Vitest, pytest.

## Global Constraints

- Support exactly `FPT`, `BTC`, and `XAU` on `1h` and `1d`; do not add discovery or arbitrary provider URLs.
- Use direct Binance public Spot klines for `BTCUSDT`, Vnstock equity `FPT`, and Vnstock commodity `XAUUSD` with Dukascopy recorded as upstream.
- Normalize all timestamps to UTC and publish only closed bars.
- Keep all provider data `research_only`; do not imply commercial redistribution rights.
- Never fall back to fixtures from the scheduled/live ingestion entrypoint.
- Keep the last active dataset version unchanged on provider, validation, or database failure.
- Process and commit every asset/timeframe independently; one failed feed must not roll back another.
- Do not add Redis, Celery, APScheduler, Parquet, object storage, paid providers, or another permanently running service.
- Endpoint hosts, symbols, timeframes, page counts, row counts, timeouts, and retries must be code-owned and bounded.
- Do not store response bodies, environment values, connection strings, secrets, or stack traces in logs or `MarketIngestionRun`.

---

### Task 1: Persist an operational ingestion run ledger

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608100004_market_ingestion_runs/migration.sql`
- Create: `quant-worker/tests/test_ingestion_repository_integration.py`

**Interfaces:**
- Produces table `market_ingestion_runs` and Prisma model `MarketIngestionRun`.
- Produces optional `DatasetVersion.ingestionRuns` relation.
- Status values remain strings constrained by application code: `running`, `succeeded`, `unchanged`, `skipped`, `failed`, `unavailable`.

- [ ] **Step 1: Write the failing migrated-database test**

Create a test that uses `TEST_DATABASE_URL`, inserts one run with parameterized SQL, verifies every persisted field, links a temporary dataset version, and deletes only rows carrying its UUID suffix:

```python
def test_market_ingestion_run_records_terminal_publication(test_database_url: str) -> None:
    run_id = str(uuid.uuid4())
    with psycopg.connect(test_database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                INSERT INTO market_ingestion_runs (
                    id, provider_code, asset_symbol, timeframe, scheduled_at,
                    started_at, status, attempt_count, fetched_row_count, metadata
                ) VALUES (%s, 'qa-provider', 'QA', '1h', NOW(), NOW(),
                          'running', 1, 0, '{}'::jsonb)
                RETURNING id, status, attempt_count
                """,
                (run_id,),
            )
            assert cursor.fetchone() == {
                "id": UUID(run_id),
                "status": "running",
                "attempt_count": 1,
            }
            cursor.execute(
                "DELETE FROM market_ingestion_runs WHERE id = %s",
                (run_id,),
            )
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```powershell
$env:DATABASE_URL=$env:TEST_DATABASE_URL
python -m pytest quant-worker/tests/test_ingestion_repository_integration.py -q
```

Expected: fail with PostgreSQL `relation "market_ingestion_runs" does not exist`.

- [ ] **Step 3: Add the Prisma model and SQL migration**

Add this model and the inverse relation:

```prisma
model MarketIngestionRun {
  id               String          @id @default(uuid()) @db.Uuid
  providerCode     String          @map("provider_code")
  assetSymbol      String          @map("asset_symbol")
  timeframe        String
  scheduledAt      DateTime        @map("scheduled_at") @db.Timestamptz(3)
  startedAt        DateTime        @default(now()) @map("started_at") @db.Timestamptz(3)
  finishedAt       DateTime?       @map("finished_at") @db.Timestamptz(3)
  status           String
  attemptCount     Int             @default(0) @map("attempt_count")
  fetchedRowCount  Int             @default(0) @map("fetched_row_count")
  datasetVersionId String?         @map("dataset_version_id") @db.Uuid
  errorCode        String?         @map("error_code")
  errorMessage     String?         @map("error_message")
  metadata         Json            @default("{}")
  datasetVersion   DatasetVersion? @relation(fields: [datasetVersionId], references: [id], onDelete: SetNull)

  @@index([assetSymbol, timeframe, startedAt(sort: Desc)])
  @@index([status, startedAt])
  @@index([datasetVersionId])
  @@map("market_ingestion_runs")
}
```

The SQL migration must use `TIMESTAMPTZ(3)`, create the three indexes, and add the `ON DELETE SET NULL` foreign key to `dataset_versions(id)`.

- [ ] **Step 4: Migrate the isolated test database and verify GREEN**

Run:

```powershell
$env:DATABASE_URL=$env:TEST_DATABASE_URL
npx prisma migrate deploy
npx prisma validate
npx prisma generate
python -m pytest quant-worker/tests/test_ingestion_repository_integration.py -q
```

Expected: Prisma commands exit `0`; the integration test passes.

- [ ] **Step 5: Commit the schema slice**

```powershell
git add prisma/schema.prisma prisma/migrations/202608100004_market_ingestion_runs/migration.sql quant-worker/tests/test_ingestion_repository_integration.py
git commit -m "feat: add market ingestion run ledger"
```

---

### Task 2: Harden and correct provider adapters

**Files:**
- Create: `quant-worker/backtest/catalog.py`
- Modify: `quant-worker/backtest/providers.py`
- Modify: `quant-worker/tests/test_providers.py`
- Modify: `quant-worker/bootstrap_research_datasets.py`

**Interfaces:**
- Produces immutable `AssetFeed` and `FEEDS: dict[str, AssetFeed]` for `FPT`, `BTC`, `XAU`.
- Produces `ProviderUnavailableError(code: str, message: str)`.
- Produces `HttpJsonResponse(status: int, headers: Mapping[str, str], payload: object)` and injectable `HttpJsonTransport.get_json(url, timeout_seconds)`.
- `BinanceSpotAdapter.fetch(*, symbol: str, asset: str, timeframe: str, start: datetime, end: datetime, now: datetime | None = None) -> list[Bar]` paginates and retries.
- `VnstockAdapter.fetch(*, symbol: str, asset: str, timeframe: str, start: datetime, end: datetime, now: datetime | None = None) -> list[Bar]` uses injected `market_factory` and feed-specific naive timezone.

- [ ] **Step 1: Write failing provider contract tests**

Add focused tests with fake transports/factories:

```python
def test_binance_paginates_and_drops_open_bar() -> None:
    transport = SequenceTransport([
        HttpJsonResponse(200, {}, [kline(0), kline(3_600_000)]),
        HttpJsonResponse(200, {}, [kline(7_200_000)]),
    ])
    rows = BinanceSpotAdapter(transport=transport, max_pages=3).fetch(
        symbol="BTCUSDT",
        asset="BTC",
        timeframe="1h",
        start=utc(1970, 1, 1),
        end=utc(1970, 1, 1, 3),
        now=utc(1970, 1, 1, 2, 30),
    )
    assert [row.timestamp.hour for row in rows] == [0, 1]
    assert len(transport.urls) == 2


def test_binance_honors_retry_after_before_success() -> None:
    sleeps: list[float] = []
    transport = SequenceTransport([
        HttpJsonResponse(429, {"Retry-After": "2"}, {"code": -1003}),
        HttpJsonResponse(200, {}, [kline(0)]),
    ])
    BinanceSpotAdapter(transport=transport, sleep=sleeps.append, jitter=lambda: 0).fetch(
        symbol="BTCUSDT", asset="BTC", timeframe="1h",
        start=utc(1970, 1, 1), end=utc(1970, 1, 1, 1), now=utc(1970, 1, 1, 2),
    )
    assert sleeps == [2.0]


def test_vnstock_routes_xauusd_and_uses_utc_for_naive_commodity_time() -> None:
    market = FakeMarket(records=[{"time": "2026-08-10 12:00:00", "open": 1, "high": 2,
                                  "low": 1, "close": 2, "volume": None}])
    rows = VnstockAdapter(market_factory=lambda: market).fetch(
        symbol="XAUUSD", asset="XAU", timeframe="1h",
        start=utc(2026, 8, 10), end=utc(2026, 8, 11), now=utc(2026, 8, 11),
    )
    assert market.commodity_symbols == ["XAUUSD"]
    assert rows[0].timestamp == utc(2026, 8, 10, 12)
    assert rows[0].source == "dukascopy-via-vnstock"
```

Also cover malformed pages, non-monotonic Binance pagination, three-attempt exhaustion, redirects/non-200 responses, maximum pages/rows, FPT `Asia/Ho_Chi_Minh` conversion, missing frame columns, and a provider exception mapped to `ProviderUnavailableError("provider_unavailable", "Provider request failed.")`.

- [ ] **Step 2: Run the provider tests to verify RED**

Run:

```powershell
python -m pytest quant-worker/tests/test_providers.py -q
```

Expected: fail because the catalog, transport injection, pagination, retry handling, and `XAUUSD` routing do not exist.

- [ ] **Step 3: Implement the code-owned feed catalog**

Create `AssetFeed` with the existing publication fields plus provenance:

```python
@dataclass(frozen=True)
class AssetFeed:
    symbol: str
    market: str
    canonical_key: str
    asset_name: str
    currency: str
    venue: str
    timezone_name: str
    maximum_leverage: Decimal
    provider_code: str
    provider_name: str
    provider_symbol: str
    terms_url: str
    client_provider: str
    upstream_provider: str
    naive_timezone: str


FEEDS = {
    "FPT": AssetFeed("FPT", "vn_equity", "VN:HOSE:FPT", "FPT Corporation", "VND",
                     "HOSE", "Asia/Ho_Chi_Minh", Decimal("2"), "vnstock-vci-free",
                     "Vnstock VCI Free", "FPT", "https://vnstocks.com/docs/vnstock",
                     "vnstock", "vci", "Asia/Ho_Chi_Minh"),
    "BTC": AssetFeed("BTC", "crypto_spot", "CRYPTO:BINANCE:BTCUSDT", "Bitcoin / Tether",
                     "USDT", "BINANCE", "UTC", Decimal("1"), "binance-public",
                     "Binance Public Spot", "BTCUSDT",
                     "https://developers.binance.com/en/docs/products/spot/rest-api",
                     "binance", "binance", "UTC"),
    "XAU": AssetFeed("XAU", "metal_spot", "METAL:OTC:XAUUSD", "Gold Spot / US Dollar",
                     "USD", "OTC", "UTC", Decimal("1"), "dukascopy-via-vnstock",
                     "Dukascopy via Vnstock", "XAUUSD",
                     "https://vnstocks.com/docs/vnstock-data/market-layer-v3",
                     "vnstock", "dukascopy", "UTC"),
}
```

Move bootstrap metadata to this catalog while keeping fixture-only `base_price` values in `bootstrap_research_datasets.py`.

- [ ] **Step 4: Implement bounded Binance HTTP and Vnstock normalization**

Use a fixed base URL, `timeout_seconds=15`, `max_pages=128`, `max_rows=100_000`, `limit=1000`, three total attempts, redirect rejection in the default urllib handler, and a stable user agent. Advance `startTime` to `last_open_time + interval_ms`; reject a page whose last timestamp does not advance. Filter with:

```python
INTERVALS = {"1h": timedelta(hours=1), "1d": timedelta(days=1)}


def only_closed_bars(rows: Iterable[Bar], *, timeframe: str, now: datetime) -> list[Bar]:
    duration = INTERVALS[timeframe]
    return [row for row in rows if row.timestamp + duration <= now]
```

Vnstock must select `market.equity("FPT", source="VCI")` or `market.commodity("XAUUSD")`, enforce required columns `time/open/high/low/close`, cap converted records, and map free-source/capability errors to sanitized stable codes.

- [ ] **Step 5: Verify GREEN and regression coverage**

Run:

```powershell
python -m pytest quant-worker/tests/test_providers.py quant-worker/tests/test_quality.py quant-worker/tests/test_publication.py -q
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit provider hardening**

```powershell
git add quant-worker/backtest/catalog.py quant-worker/backtest/providers.py quant-worker/tests/test_providers.py quant-worker/bootstrap_research_datasets.py
git commit -m "feat: harden free market data adapters"
```

---

### Task 3: Merge immutable snapshots and skip duplicate publications

**Files:**
- Create: `quant-worker/backtest/snapshots.py`
- Modify: `quant-worker/backtest/publication.py`
- Create: `quant-worker/tests/test_snapshots.py`
- Modify: `quant-worker/tests/test_publication.py`
- Modify: `quant-worker/tests/test_publication_integration.py`

**Interfaces:**
- Produces `ActiveSnapshot(dataset_id, dataset_version_id, checksum, source_metadata, rows)` with an `is_fixture` property derived from metadata and bar sources.
- Produces `merge_snapshot(active_rows, incoming_rows, overlap_start) -> list[Bar]`.
- Produces `PostgresDatasetPublisher.load_active(asset, timeframe) -> ActiveSnapshot | None`.
- Produces `PostgresDatasetPublisher.publish_if_changed(prepared) -> PublicationResult` where `PublicationResult.status` is `succeeded` or `unchanged`.

- [ ] **Step 1: Write failing merge and idempotence tests**

```python
def test_merge_snapshot_keeps_history_and_replaces_matching_timestamp() -> None:
    old = [bar(hour=0, close="10"), bar(hour=1, close="11")]
    incoming = [bar(hour=1, close="12"), bar(hour=2, close="13")]
    merged = merge_snapshot(old, incoming, overlap_start=utc(2026, 8, 10, 1))
    assert [(row.timestamp.hour, row.close) for row in merged] == [
        (0, Decimal("10")), (1, Decimal("12")), (2, Decimal("13")),
    ]


def test_publish_if_changed_does_not_create_another_version() -> None:
    publisher = FakePublisher(active_checksum="a" * 64)
    prepared = replace(prepared_dataset(), checksum="a" * 64)
    result = publisher.publish_if_changed(prepared)
    assert result.status == "unchanged"
    assert publisher.inserted_versions == 0
```

The PostgreSQL test must publish the same prepared snapshot twice, assert one `dataset_versions` row, then publish a corrected overlap and assert version `2` is the sole active row.

Add a fixture-transition test: when the active version has `source_metadata.mode == "fixture"` or any bar source is `research_fixture`, the live candidate uses only the provider backfill and contains zero fixture bars.

- [ ] **Step 2: Run the tests to verify RED**

```powershell
python -m pytest quant-worker/tests/test_snapshots.py quant-worker/tests/test_publication.py -q
```

Expected: fail because snapshot loading/merging and `publish_if_changed` are undefined.

- [ ] **Step 3: Implement deterministic snapshot merging**

```python
def merge_snapshot(active_rows: Iterable[Bar], incoming_rows: Iterable[Bar], *,
                   overlap_start: datetime) -> list[Bar]:
    merged = {row.timestamp: row for row in active_rows}
    for row in incoming_rows:
        if row.timestamp >= overlap_start:
            merged[row.timestamp] = row
    return normalize_bars(merged.values())
```

Validate that every row has the same asset/timeframe before returning. Empty incoming data is an error, not an unchanged run.

- [ ] **Step 4: Add active snapshot loading and checksum short-circuit**

Load the active version, `source_metadata`, and bars ordered by `ts`; reconstruct `Bar` using stored decimals/source. Lock the dataset row before comparing and publishing. Return this exact shape:

```python
@dataclass(frozen=True)
class PublicationResult:
    status: Literal["succeeded", "unchanged"]
    dataset_version_id: str
    version: int
    checksum: str
    row_count: int
    missing_bar_count: int
    quality_status: str
```

Do not create bars or deactivate the current version when `prepared.checksum` matches.

- [ ] **Step 5: Verify unit and PostgreSQL integration GREEN**

```powershell
python -m pytest quant-worker/tests/test_snapshots.py quant-worker/tests/test_publication.py -q
$env:DATABASE_URL=$env:TEST_DATABASE_URL
python -m pytest quant-worker/tests/test_publication_integration.py -q
```

Expected: all tests pass and only the corrected publication increments the version.

- [ ] **Step 6: Commit snapshot publication**

```powershell
git add quant-worker/backtest/snapshots.py quant-worker/backtest/publication.py quant-worker/tests/test_snapshots.py quant-worker/tests/test_publication.py quant-worker/tests/test_publication_integration.py
git commit -m "feat: publish changed market snapshots only"
```

---

### Task 4: Orchestrate independent ingestion runs under advisory locks

**Files:**
- Create: `quant-worker/backtest/ingestion.py`
- Create: `quant-worker/backtest/ingestion_repository.py`
- Create: `quant-worker/ingest_market_data.py`
- Create: `quant-worker/tests/test_ingestion.py`
- Expand: `quant-worker/tests/test_ingestion_repository_integration.py`

**Interfaces:**
- Produces `IngestionSelection(asset: Literal["FPT", "BTC", "XAU"], timeframe: Literal["1h", "1d"])`.
- Produces `IngestionOutcome(asset, timeframe, status, fetched_row_count, dataset_version_id, error_code)`.
- Produces `run_ingestion(selections, repository, provider_factory, now, dry_run=False) -> tuple[list[IngestionOutcome], int]`.
- Produces CLI commands `all`, `hourly`, `daily`, plus `--asset`, `--timeframe`, `--dry-run`, and `--env-file`.

- [ ] **Step 1: Write failing orchestrator behavior tests**

```python
def test_failure_preserves_active_version_and_other_feed_succeeds() -> None:
    repository = FakeRepository(active={"BTC:1h": snapshot("old")})
    providers = FakeProviders({"BTC:1h": ProviderUnavailableError("rate_limited", "unavailable"),
                               "XAU:1h": [bar(asset="XAU")]})
    outcomes, exit_code = run_ingestion(
        [selection("BTC", "1h"), selection("XAU", "1h")],
        repository=repository, provider_factory=providers, now=NOW,
    )
    assert [item.status for item in outcomes] == ["unavailable", "succeeded"]
    assert exit_code == 2
    assert repository.active_version("BTC", "1h") == "old"


def test_busy_advisory_lock_skips_without_fetching() -> None:
    repository = FakeRepository(lock_available=False)
    providers = FakeProviders({})
    outcomes, exit_code = run_ingestion(
        [selection("BTC", "1h")], repository=repository,
        provider_factory=providers, now=NOW,
    )
    assert outcomes[0].status == "skipped"
    assert exit_code == 0
    assert providers.calls == []
```

Also prove backfill windows of 730/60 days, overlap windows of 10/3 days, `dry_run` never mutates the repository, empty provider rows fail, stale `running` rows become `failed` with `stale_run`, stored errors are capped and sanitized, and selection validation rejects every symbol/timeframe outside the catalog.

- [ ] **Step 2: Run the unit tests to verify RED**

```powershell
python -m pytest quant-worker/tests/test_ingestion.py -q
```

Expected: fail because ingestion orchestration does not exist.

- [ ] **Step 3: Implement the orchestration state machine**

Use the following status mapping and always release the session lock in `finally`:

```python
if dry_run:
    feed = FEEDS[selection.asset]
    window = ingestion_window(selection.timeframe, now=now, active=None)
    incoming = provider_factory(selection.asset).fetch(
        symbol=feed.provider_symbol, asset=feed.symbol, timeframe=selection.timeframe,
        start=window.fetch_start, end=window.fetch_end, now=now,
    )
    prepare_for_feed(FEEDS[selection.asset], selection.timeframe, incoming)
    return IngestionOutcome(selection.asset, selection.timeframe, "succeeded",
                            len(incoming), None, None)

run_id: str | None = None
locked = False
try:
    locked = repository.try_lock(selection)
    if not locked:
        return repository.record_skipped(selection, now, "already_running")
    run_id = repository.start_run(selection, now)
    active = repository.load_active(selection)
    window = ingestion_window(selection.timeframe, now=now, active=active)
    incoming = provider_factory(selection.asset).fetch(
        symbol=FEEDS[selection.asset].provider_symbol,
        asset=selection.asset,
        timeframe=selection.timeframe,
        start=window.fetch_start,
        end=window.fetch_end,
        now=now,
    )
    active_rows = () if active is None or active.is_fixture else active.rows
    merged = merge_snapshot(active_rows, incoming, overlap_start=window.overlap_start)
    prepared = prepare_for_feed(FEEDS[selection.asset], selection.timeframe, merged)
    return repository.publish_and_finish(run_id, prepared, len(incoming))
except ProviderUnavailableError as error:
    if run_id is None:
        raise
    return repository.finish_unavailable(run_id, error.code, sanitize(error))
except Exception as error:
    if run_id is None:
        raise
    return repository.finish_failed(run_id, stable_error_code(error), sanitize(error))
finally:
    if locked:
        repository.unlock(selection)
```

`dry_run` performs provider fetch, closed-bar filtering, and quality preparation without creating a run, acquiring a database connection, or publishing. Provider exceptions in dry-run mode are converted directly into sanitized outcomes without calling repository methods. A fixture active snapshot always selects the initial 730/60-day backfill window and contributes no rows to the live snapshot.

- [ ] **Step 4: Implement parameterized PostgreSQL repository operations**

Use session advisory locks keyed only from code-owned values:

```sql
SELECT pg_try_advisory_lock(hashtextextended(%s, 0)) AS acquired;
SELECT pg_advisory_unlock(hashtextextended(%s, 0));
```

Insert the `running` row before provider I/O. Wrap `publish_if_changed` plus the terminal run update in one `connection.transaction()` block. Failure methods update only the exact run ID and never touch `dataset_versions.is_active`. Mark runs older than two hours with `status='running'` as `failed`, `error_code='stale_run'`, and a generic error message.

- [ ] **Step 5: Implement the strict CLI and environment loader**

The CLI defaults to `all`, accepts only argparse choices, emits one JSON object per feed plus a final summary, and returns the orchestrator exit code. A small `ArgumentParser` subclass raises `CliUsageError`; `main()` catches it, prints a generic usage error, and returns `1` so invalid configuration matches the design instead of argparse's default exit `2`. `--env-file` defaults to `.env.local` and reads only `DATABASE_URL` when it is absent from the process environment; it does not expand variables or print the value. Parse `MARKET_INGEST_MAX_PAGES` in `[1, 512]` and `MARKET_INGEST_MAX_ROWS` in `[100, 250000]`, using defaults `128` and `100000`; invalid values are fatal configuration errors.

```python
parser.add_argument("command", nargs="?", choices=("all", "hourly", "daily"), default="all")
parser.add_argument("--asset", choices=tuple(FEEDS))
parser.add_argument("--timeframe", choices=("1h", "1d"))
parser.add_argument("--dry-run", action="store_true")
parser.add_argument("--env-file", default=".env.local")
```

Require `--asset` and `--timeframe` together. `hourly` selects all `1h` feeds; `daily` selects all `1d` feeds.

- [ ] **Step 6: Verify unit and integration GREEN**

```powershell
python -m pytest quant-worker/tests/test_ingestion.py -q
$env:DATABASE_URL=$env:TEST_DATABASE_URL
python -m pytest quant-worker/tests/test_ingestion_repository_integration.py -q
```

Expected: all tests pass, including advisory-lock exclusion and active-version preservation.

- [ ] **Step 7: Commit the orchestration slice**

```powershell
git add quant-worker/backtest/ingestion.py quant-worker/backtest/ingestion_repository.py quant-worker/ingest_market_data.py quant-worker/tests/test_ingestion.py quant-worker/tests/test_ingestion_repository_integration.py
git commit -m "feat: schedule resilient market ingestion runs"
```

---

### Task 5: Expose authenticated data health

**Files:**
- Modify: `src/lib/backend/types.ts`
- Modify: `src/lib/backend/db.ts`
- Create: `src/lib/market-data/health.ts`
- Create: `src/lib/market-data/health.test.ts`
- Create: `src/app/api/market/data-health/route.ts`
- Modify: `src/app/api/tenant-routes.test.ts`

**Interfaces:**
- Produces `MarketDataFreshness = "fresh" | "stale" | "unavailable" | "fixture"`.
- Produces `MarketDataHealthItem` with symbol, timeframe, provider/upstream, version manifest, last ingestion status/error code, and freshness.
- Produces `loadMarketDataHealth(now?: Date) -> Promise<MarketDataHealthItem[]>`.
- Produces authenticated `GET /api/market/data-health` returning `{ data: MarketDataHealthItem[] }`.

- [ ] **Step 1: Write failing freshness and route authorization tests**

```typescript
it("labels fixture data explicitly even when recently published", () => {
  expect(
    calculateFreshness({
      market: "crypto_spot",
      timeframe: "1h",
      coverageEnd: new Date("2026-08-10T11:00:00Z"),
      source: "research_fixture",
      lastStatus: "succeeded",
      now: new Date("2026-08-10T12:00:00Z"),
    }),
  ).toBe("fixture");
});

it("allows viewer data-health reads through the exact tenant capability", async () => {
  const response = await marketDataHealthGet();
  expect(response.status).toBe(200);
  expect(mocks.requireTenantCapability).toHaveBeenCalledWith(viewerContext, "quant", "read");
  expect(mocks.loadMarketDataHealth).toHaveBeenCalledOnce();
});
```

Also cover a two-bar lag for `1h` as stale, a two-session lag for `1d`, weekend roll-back for Vietnamese equities and XAU, last status `unavailable`, missing active version, and a `401` response without a session.

- [ ] **Step 2: Run Vitest to verify RED**

```powershell
npm test -- src/lib/market-data/health.test.ts src/app/api/tenant-routes.test.ts
```

Expected: fail because health contracts, loader, and route are missing.

- [ ] **Step 3: Implement freshness as a pure bounded function**

```typescript
export function calculateFreshness(input: FreshnessInput): MarketDataFreshness {
  if (input.source === "research_fixture") return "fixture";
  if (!input.coverageEnd || input.lastStatus === "unavailable") return "unavailable";
  const expected = expectedClosedBarOpen(input.market, input.timeframe, input.now);
  const thresholdMs = input.timeframe === "1h" ? 90 * 60_000 : 36 * 60 * 60_000;
  const lagMs = Math.max(0, expected.getTime() - input.coverageEnd.getTime());
  return lagMs <= thresholdMs ? "fresh" : "stale";
}
```

`expectedClosedBarOpen` uses UTC continuous boundaries for crypto, the existing FPT session opens (`02:00`, `03:00`, `04:00`, `06:00`, `07:00` UTC) on Monday-Friday, and weekday hourly/daily boundaries for XAU. It rolls backward over weekends before calculating lag. Clamp negative lag to zero so minor clock skew does not create a false stale result.

- [ ] **Step 4: Implement the global read model and authenticated route**

Query only the three allow-listed assets and two timeframes. Select the active version, provider, version `sourceMetadata`, first/last bar source, and latest ingestion run; never return `errorMessage` or run metadata to clients. Determine fixture state from `sourceMetadata.mode === "fixture"` or a `research_fixture` bar, and return only stable `errorCode`. Require tenant context and `requireTenantCapability(context, "quant", "read")` even though market datasets are global.

```typescript
export async function GET() {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "quant", "read");
    return NextResponse.json({ data: await loadMarketDataHealth() });
  } catch (error) {
    return apiError(error);
  }
}
```

- [ ] **Step 5: Verify GREEN**

```powershell
npm test -- src/lib/market-data/health.test.ts src/app/api/tenant-routes.test.ts
npx tsc --noEmit
```

Expected: focused tests and TypeScript pass.

- [ ] **Step 6: Commit the data-health API**

```powershell
git add src/lib/backend/types.ts src/lib/backend/db.ts src/lib/market-data/health.ts src/lib/market-data/health.test.ts src/app/api/market/data-health/route.ts src/app/api/tenant-routes.test.ts
git commit -m "feat: expose market data ingestion health"
```

---

### Task 6: Show real source status and document scheduler invocation

**Files:**
- Create: `src/lib/market-data/client.ts`
- Create: `src/lib/market-data/client.test.ts`
- Create: `src/components/MarketDataHealthPanel.tsx`
- Modify: `src/components/BacktestWorkbench.tsx`
- Create: `scripts/run-market-ingestion.ps1`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `quant-worker/README.md`

**Interfaces:**
- Produces `getMarketDataHealth(fetcher?, signal?)` with Zod validation.
- Produces `<MarketDataHealthPanel timeframe="1h" | "1d" />`.
- Produces `npm run market:ingest -- hourly` and `scripts/run-market-ingestion.ps1 -Command hourly`.

- [ ] **Step 1: Write the failing client contract tests**

```typescript
it("accepts the bounded data-health response", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ data: [validHealthItem] }), { status: 200 }),
  );
  await expect(getMarketDataHealth(fetcher)).resolves.toEqual([validHealthItem]);
});

it("rejects provider metadata outside the response contract", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ data: [{ ...validHealthItem, freshness: "pretend-live" }] })),
  );
  await expect(getMarketDataHealth(fetcher)).rejects.toThrow("Invalid market data health response");
});
```

- [ ] **Step 2: Run the client test to verify RED**

```powershell
npm test -- src/lib/market-data/client.test.ts
```

Expected: fail because the client does not exist.

- [ ] **Step 3: Implement the validated client and focused UI panel**

The panel fetches on mount, cancels on unmount, filters by selected timeframe, and renders one row per FPT/BTC/XAU. Map status copy exactly:

```typescript
const STATUS_COPY = {
  fresh: { label: "LIVE DATA", tone: "live" },
  stale: { label: "STALE", tone: "warning" },
  unavailable: { label: "UNAVAILABLE", tone: "warning" },
  fixture: { label: "FIXTURE", tone: "demo" },
} as const;
```

Show provider, upstream when different, coverage end, version, and row count. On fetch failure show a compact unavailable message without blocking the rest of Quant Lab. Replace the workbench's generic `SYSTEM` badge with the panel; do not change strategy controls or run artifacts.

- [ ] **Step 4: Add scheduler-safe command wrappers and documentation**

Add:

```json
"market:ingest": "python quant-worker/ingest_market_data.py"
```

The PowerShell wrapper resolves the repository root from `$PSScriptRoot`, accepts only `all/hourly/daily`, and invokes Python with `--env-file <root>/.env.local`. It does not print environment contents and propagates Python's exit code.

Document these Task Scheduler actions without registering OS tasks automatically. The hourly trigger runs at minute `10`; the daily trigger runs at `01:15 UTC`:

```text
Hourly trigger: powershell.exe -NoProfile -File scripts/run-market-ingestion.ps1 -Command hourly
Daily trigger:  powershell.exe -NoProfile -File scripts/run-market-ingestion.ps1 -Command daily
Start in:       <repository root>
```

Add optional non-secret `.env.example` limits `MARKET_INGEST_MAX_PAGES=128` and `MARKET_INGEST_MAX_ROWS=100000`; validate bounds in Python and keep code defaults when absent.

- [ ] **Step 5: Verify UI/client and script behavior GREEN**

```powershell
npm test -- src/lib/market-data/client.test.ts src/lib/market-data/health.test.ts
npx tsc --noEmit
powershell -NoProfile -File scripts/run-market-ingestion.ps1 -Command invalid
```

Expected: tests/typecheck pass; invalid scheduler command exits non-zero before Python/provider access.

- [ ] **Step 6: Commit product status and scheduler docs**

```powershell
git add src/lib/market-data/client.ts src/lib/market-data/client.test.ts src/components/MarketDataHealthPanel.tsx src/components/BacktestWorkbench.tsx scripts/run-market-ingestion.ps1 package.json .env.example README.md quant-worker/README.md
git commit -m "feat: surface scheduled market data health"
```

---

### Task 7: Run live smoke, full verification, and readiness review

**Files:**
- Modify only if verification finds an ingestion-scope defect.
- Evidence commands cover the complete changed surface; do not commit logs, fetched payloads, `.env.local`, or database dumps.

**Interfaces:**
- Consumes the CLI, migration, API, and UI created in Tasks 1-6.
- Produces verified local database versions and an honest provider-by-provider readiness report.

- [ ] **Step 1: Run provider-only dry smoke without database mutation**

```powershell
python quant-worker/ingest_market_data.py all --dry-run --env-file .env.local
```

Expected: one sanitized JSON outcome for every FPT/BTC/XAU `1h`/`1d` selection. FPT `1h` may be `unavailable`; no fixture row or provider response body appears.

- [ ] **Step 2: Apply the development migration and publish bounded live feeds**

```powershell
npx prisma migrate deploy
python quant-worker/ingest_market_data.py all --env-file .env.local
```

Expected: successful/unchanged feeds point to non-fixture active versions. Any unavailable feed retains its previous active version and has a terminal ingestion run with a stable error code. Exit `2` is acceptable only when the per-feed report names the unavailable free-source capability.

- [ ] **Step 3: Verify database truth**

Query the six dataset manifests and latest run rows with parameterized/read-only SQL. Confirm:

```text
exactly one active version per dataset
source != research_fixture for every successful live feed
XAU provider_symbol = XAUUSD
XAU upstream_provider = dukascopy
no running row older than two hours
failed/unavailable feeds retained the prior dataset_version_id
```

- [ ] **Step 4: Run the complete automated gate**

```powershell
python -m pytest quant-worker/tests -q
npm run test:integration
npm test
npx tsc --noEmit
npm run lint
npm run build
npm audit --audit-level=high
```

Expected: Python, migrated-database integration, Vitest, TypeScript, ESLint, and production build pass. `npm audit` has no reachable high/critical production vulnerability; document any dev-only deferral with package/path evidence.

- [ ] **Step 5: Run local API and browser verification**

Restart the local server from the implemented tree, sign in, open `/quant-lab`, switch between `1d` and `1h`, and verify:

```text
FPT, BTC, XAU each show provider and freshness
fixture/stale/unavailable is visually explicit
XAU displays Dukascopy via Vnstock
no horizontal overflow at 390px viewport
browser console has no new errors
GET /api/market/data-health returns 401 signed out and 200 signed in
```

- [ ] **Step 6: Review the final diff and commit verification-only fixes**

```powershell
git status --short
git diff --check
git diff --stat main...HEAD
```

If verification required code fixes, repeat the relevant RED/GREEN cycle and commit only those scoped files:

```powershell
git commit -m "fix: close market ingestion verification gaps"
```

Do not claim scheduled production operation until the deployment platform's scheduler has been configured and at least one scheduled run is observed there.
