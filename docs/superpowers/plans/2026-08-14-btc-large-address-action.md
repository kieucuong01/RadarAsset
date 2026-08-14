# BTC Large-Address Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a BTC-only daily large-address activity module backed by a reviewed Top-100 cohort, confirmed mempool.space address transactions, deterministic metrics and confidence, and chart-first Smart Insights UI.

**Architecture:** Extend the existing Smart Insights collector and immutable observation pipeline. Scrapling/BitInfoCharts owns cohort discovery, a new bounded mempool.space collector verifies daily address state and direct reviewed-exchange flows, a focused calculator publishes the `large_address_action` signal, and the existing Crypto Market Pulse read model exposes the observations and signal to a new UI panel. Reuse the existing Prisma tables; no schema migration is required.

**Tech Stack:** Python 3.12-compatible standard library, `Decimal`, existing psycopg repository and pytest suite, Next.js 16, React 19, TypeScript, Prisma 7, Zod 4, Recharts, Vitest.

## Global Constraints

- BTC only; one closed UTC daily snapshot.
- Discovery accepts BitInfoCharts ranks 1-100 and balances of at least 1,000 BTC.
- Exclude known exchanges, custodians, miners, governments, and special entities; unresolved addresses remain `unknown`.
- BitInfoCharts and `mempool-btc-large-addresses` remain disabled until their own bounded live smoke and database publication smoke pass.
- Common-cohort balance changes exclude entrants and exits.
- Direct exchange flows use only `verified` or `reviewed` registry labels and at least six confirmations.
- Score is unavailable before 30 valid days, flagged `CALIBRATING` through day 89, and hidden below confidence 60.
- Sample UI data is labelled `Dữ liệu mẫu` and never enters backend observations, signals, or live charts.
- Preserve all existing Smart Insights blocks and styles.
- Use the existing `MetricObservation`, `InsightRawSnapshot`, and `SignalSnapshot` tables; do not add a Prisma migration.

## File structure

- `quant-worker/smart_insights/exchange_labels.py`: immutable reviewed-address registry and lookup API.
- `quant-worker/smart_insights/collectors/mempool_large_addresses.py`: bounded address and transaction collection with conservative attribution.
- `quant-worker/smart_insights/large_address_metrics.py`: common-cohort horizons, breadth, concentration, robust normalization, confidence, and signal construction.
- `quant-worker/smart_insights/sources.py`: disabled source registration and URL metadata.
- `quant-worker/smart_insights/metrics/crypto.py`: raw and derived metric definitions.
- `quant-worker/collect_smart_insights.py`: watchlist loading, collector construction, and post-publication signal calculation.
- `src/lib/backend/crypto-market-pulse.ts`: database-backed read model.
- `src/lib/crypto-market-pulse-client.ts`: Zod client contract.
- `src/components/smart-insights/CryptoLargeAddressPanel.tsx`: chart-first, table-backed UI with isolated sample state.
- `src/components/smart-insights/LegacyMarketPulse.tsx`: compose the new panel without changing existing blocks.
- Existing Python and TypeScript test files receive focused regression coverage; new fixtures contain provider-shaped JSON only.

---

### Task 1: Enforce the discovery universe and register the verification source

**Files:**
- Modify: `quant-worker/smart_insights/collectors/bitinfocharts.py`
- Modify: `quant-worker/smart_insights/sources.py`
- Modify: `quant-worker/smart_insights/metrics/crypto.py`
- Modify: `quant-worker/tests/test_smart_insights_crypto_collectors.py`
- Modify: `quant-worker/tests/test_smart_insights_foundation.py`

**Interfaces:**
- Produces: source code `mempool-btc-large-addresses`, disabled by default.
- Produces: BitInfoCharts observations containing `rank`, `cohort_version`, `label_status`, and only non-excluded addresses with `balance >= 1000` BTC.
- Produces metric codes used by later tasks: `crypto.large_address.confirmed_balance_btc`, `net_accumulation_btc`, `accumulation_breadth`, `distribution_breadth`, `to_exchange_btc`, `from_exchange_btc`, `exchange_flow_pressure_btc`, `dormant_to_exchange_btc`, `dormant_from_exchange_btc`, `top10_concentration`, `address_coverage`, `transaction_coverage`, and `flow_label_coverage`.

- [ ] **Step 1: Write failing discovery and registry tests**

Add a fixture row below 1,000 BTC and assertions equivalent to:

```python
batch = BitInfoChartsCollector(crawler=FakeCrawler(markdown)).collect(NOW)
addresses = {
    row.dimensions["address"]: row
    for row in batch.observations
    if row.metric_code == "crypto.large_address.address_balance_btc"
}
assert low_balance_address not in addresses
assert all(1 <= int(row.dimensions["rank"]) <= 100 for row in addresses.values())
assert all(row.dimensions["cohort_version"] for row in addresses.values())

source = source_for_code("mempool-btc-large-addresses")
assert source.collection_mode == CollectionMode.API
assert source.schedule == "daily"
assert source.enabled is False
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```powershell
..\.venv\Scripts\python.exe -m pytest quant-worker\tests\test_smart_insights_crypto_collectors.py::test_bitinfocharts_applies_rank_and_balance_floor quant-worker\tests\test_smart_insights_foundation.py -q
```

Expected: FAIL because the balance floor, dimensions, new source, and metric definitions do not exist.

- [ ] **Step 3: Implement minimal discovery and registry changes**

In `_parse_rows`, skip accepted table rows whose parsed balance is less than `Decimal("1000")`. Compute one deterministic cohort version from the sorted accepted address, rank, balance, label-status, and exclusion records. Attach rank and cohort version to each published address row.

Register:

```python
(
    "mempool-btc-large-addresses",
    "mempool.space BTC Large Addresses",
    Market.CRYPTO,
    CollectionMode.API,
    ("https://mempool.space/api/address/",),
    "daily",
    "mempool-btc-large-addresses-v1",
    2_880,
    "community_api",
    "https://mempool.space/about",
)
```

Do not add the code to `ENABLED_SOURCE_CODES`. Add exact metric definitions with `evidence_only=True`, daily frequency, BTC units or ratio units, a 2,880-minute SLA, and the new source metadata.

- [ ] **Step 4: Run focused tests**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit the discovery contract**

```powershell
git add quant-worker/smart_insights/collectors/bitinfocharts.py quant-worker/smart_insights/sources.py quant-worker/smart_insights/metrics/crypto.py quant-worker/tests/test_smart_insights_crypto_collectors.py quant-worker/tests/test_smart_insights_foundation.py quant-worker/tests/fixtures/smart_insights/crypto/bitinfocharts.md
git commit -m "feat: define BTC large-address universe"
```

### Task 2: Collect confirmed address state and conservative direct flows

**Files:**
- Create: `quant-worker/smart_insights/exchange_labels.py`
- Create: `quant-worker/smart_insights/collectors/mempool_large_addresses.py`
- Create: `quant-worker/tests/fixtures/smart_insights/crypto/mempool-large-address-summary.json`
- Create: `quant-worker/tests/fixtures/smart_insights/crypto/mempool-large-address-transactions.json`
- Create: `quant-worker/tests/test_smart_insights_large_address_collector.py`

**Interfaces:**
- Produces: `AddressWatch(address: str, rank: int, discovery_balance_btc: Decimal, label_status: str, cohort_version: str)`.
- Produces: `ExchangeLabel(address: str, entity_name: str, entity_type: str, source_url: str, reviewed_at: date, registry_version: str, confidence: str)`.
- Produces: `MempoolLargeAddressCollector.collect(as_of: datetime, *, watchlist: Sequence[AddressWatch], previous_cutoff: datetime | None, balance_history: Mapping[date, Mapping[str, Decimal]], last_outgoing: Mapping[str, datetime]) -> CollectionBatch`.
- Consumes: an injected transport with `fetch(url, timeout_seconds, max_bytes) -> HttpResponse`.

- [ ] **Step 1: Write failing collector tests**

Cover summary normalization, six-confirmation filtering, cutoff pagination, transaction-ID deduplication, partial-address failure, and direct reviewed exchange attribution:

```python
batch = MempoolLargeAddressCollector(
    transport=RoutingTransport(payloads),
    labels={exchange_address: reviewed_exchange_label},
).collect(NOW, watchlist=WATCHLIST, previous_cutoff=PREVIOUS_DAY)

assert metric(batch, "crypto.large_address.confirmed_balance_btc").value == Decimal("1200")
assert metric(batch, "crypto.large_address.to_exchange_btc").value == Decimal("25")
assert metric(batch, "crypto.large_address.from_exchange_btc").value == Decimal("10")
assert metric(batch, "crypto.large_address.exchange_flow_pressure_btc").value == Decimal("15")
assert all(row.dimensions.get("counterparty") != unknown_address for row in batch.observations)
```

Also assert that unknown external value is counted only in coverage denominators, a 5-confirmation transaction does not enter confirmed flow, the same `txid` is aggregated once, and an unreachable address lowers coverage without copying its prior balance.

- [ ] **Step 2: Run tests and verify failure**

```powershell
..\.venv\Scripts\python.exe -m pytest quant-worker\tests\test_smart_insights_large_address_collector.py -q
```

Expected: FAIL because the registry and collector modules do not exist.

- [ ] **Step 3: Implement the reviewed registry**

Create frozen dataclasses, validate Bitcoin address strings and HTTPS evidence URLs at import time, allow only `verified`, `reviewed`, or `heuristic`, and expose:

```python
def exchange_labels_by_address() -> Mapping[str, ExchangeLabel]: ...
def reviewed_exchange(address: str) -> ExchangeLabel | None: ...
```

Begin with only addresses already supported by evidence stored in the repository or fixture tests. An empty production registry is valid and yields zero labelled flow with explicit coverage; do not invent labels to make tests pass.

- [ ] **Step 4: Implement bounded collection and attribution**

Use `/api/address/{address}`, `/api/address/{address}/txs`, and `/api/address/{address}/txs/chain/{last_txid}`. Parse integer satoshis using `Decimal(value) / Decimal(100_000_000)`. Stop pagination at `previous_cutoff`, a repeated `txid`, 20 pages per address, or the run deadline.

For each transaction, derive tracked-address net change. Attribute direct flow as:

```python
to_exchange = min(tracked_net_decrease, reviewed_exchange_outputs)
from_exchange = min(tracked_net_increase, reviewed_exchange_inputs)
```

Aggregate once per `txid`; leave multi-entity and unresolved residual value unknown. Publish per-address confirmed balance plus per-transaction confirmed incoming/outgoing rows with address, `txid`, counterparty classification, block time, and confirmation count dimensions. Use the injected balance history to publish common-cohort 1D/7D/30D net accumulation and breadth, concentration, and entrant/exit observations in the same immutable provider batch. Use `last_outgoing` only when it proves at least 180 days of history; otherwise dormant eligibility is unavailable. Return `MISSING_WATCHLIST` for an empty watchlist and `PARTIAL_ADDRESS_COVERAGE` as a quality flag when fewer than 90% of addresses succeed.

- [ ] **Step 5: Run collector tests**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 6: Commit the collector**

```powershell
git add quant-worker/smart_insights/exchange_labels.py quant-worker/smart_insights/collectors/mempool_large_addresses.py quant-worker/tests/test_smart_insights_large_address_collector.py quant-worker/tests/fixtures/smart_insights/crypto/mempool-large-address-summary.json quant-worker/tests/fixtures/smart_insights/crypto/mempool-large-address-transactions.json
git commit -m "feat: collect confirmed BTC large-address flows"
```

### Task 3: Calculate common-cohort metrics, confidence, and action score

**Files:**
- Create: `quant-worker/smart_insights/large_address_metrics.py`
- Create: `quant-worker/tests/test_smart_insights_large_address_metrics.py`
- Modify: `quant-worker/smart_insights/crypto_pipeline.py`
- Modify: `quant-worker/tests/test_smart_insights_crypto_pipeline_integration.py`

**Interfaces:**
- Produces: `calculate_large_address_snapshot(repository: CryptoRepository, *, as_of: datetime) -> SignalSnapshotInput`.
- Produces signal type `large_address_action`, methodology `btc-large-address-action-v1`, labels `accumulation`, `neutral`, `distribution`, `calibrating`, or `unavailable`.
- Consumes existing `CryptoRepository.metric_observations`, `upsert_metric_definitions`, and `publish_signal_snapshot`.

- [ ] **Step 1: Write failing deterministic metric tests**

Use an in-memory repository containing daily address rows and flow rows. Assert common-cohort isolation and exact thresholds:

```python
metrics = calculate_large_address_metrics(repository, as_of=DAY_31)
assert metrics["net_accumulation_1d"] == Decimal("20")
assert metrics["entrant_count"] == Decimal("1")
assert metrics["accumulation_breadth_1d"] == Decimal("0.5000")
assert metrics["top10_concentration"] == expected_top10 / expected_cohort
```

Add tests for 7D/30D endpoint absence, `max(10 BTC, 0.1%)`, dormant history eligibility, robust median/MAD with standard-deviation fallback, 29/30/89/90 valid-day calibration boundaries, score weights, confidence below 60, stale universe, and zero-transfer label coverage.

- [ ] **Step 2: Run tests and verify failure**

```powershell
..\.venv\Scripts\python.exe -m pytest quant-worker\tests\test_smart_insights_large_address_metrics.py quant-worker\tests\test_smart_insights_crypto_pipeline_integration.py -q
```

Expected: FAIL because the metric calculator and second signal do not exist.

- [ ] **Step 3: Implement focused pure functions**

Create pure helpers for daily address maps, common-cohort delta, breadth, concentration, robust component mapping, and confidence. Use `Decimal` throughout. The composite is:

```python
score = Decimal("100") * (
    Decimal("0.35") * accumulation_component
    + Decimal("0.30") * exchange_flow_component
    + Decimal("0.20") * breadth_component
    + Decimal("0.15") * dormant_component
)
```

Clamp to `[-100, 100]`. Exchange flow is sign-inverted. Unknown dormant flow contributes zero. With fewer than 30 valid days or confidence below 60, publish `score=None` and the correct non-directional label.

- [ ] **Step 4: Publish the second signal from the Crypto pipeline**

Keep the existing Crypto regime snapshot unchanged. After publishing it, calculate and publish `large_address_action` as a second idempotent `SignalSnapshotInput`. If address observations are absent, publish an unavailable signal without affecting the regime result or its candidates.

- [ ] **Step 5: Run metric and pipeline tests**

Run the command from Step 2. Expected: PASS, including unchanged existing regime assertions.

- [ ] **Step 6: Commit the calculation pipeline**

```powershell
git add quant-worker/smart_insights/large_address_metrics.py quant-worker/smart_insights/crypto_pipeline.py quant-worker/tests/test_smart_insights_large_address_metrics.py quant-worker/tests/test_smart_insights_crypto_pipeline_integration.py
git commit -m "feat: calculate BTC large-address action score"
```

### Task 4: Wire watchlist collection, publication, and source health

**Files:**
- Modify: `quant-worker/collect_smart_insights.py`
- Modify: `quant-worker/tests/test_smart_insights_foundation.py`
- Modify: `src/lib/backend/smart-insights-data-health.ts`
- Modify: `src/lib/backend/smart-insights-data-health.test.ts`
- Modify: `docs/operations/smart-insights-runbook.md`

**Interfaces:**
- Produces: `_latest_large_address_watchlist(repository, as_of) -> tuple[AddressWatch, ...]` and `_large_address_history(repository, as_of) -> LargeAddressHistory`.
- Produces a batch collector mapped under `mempool-btc-large-addresses`.
- Preserves `--live-smoke --source CODE` as a write-free production-parser smoke.

- [ ] **Step 1: Write failing wiring tests**

Assert that the latest accepted BitInfoCharts effective day becomes the watchlist, future or stale revisions are excluded by the existing repository point-in-time query, an empty repository returns `MISSING_WATCHLIST`, and the source-health response contains the new disabled source with parser version and no false successful run.

- [ ] **Step 2: Run focused tests and verify failure**

```powershell
..\.venv\Scripts\python.exe -m pytest quant-worker\tests\test_smart_insights_foundation.py -q
npm test -- src/lib/backend/smart-insights-data-health.test.ts
```

Expected: FAIL because the collector mapping and health definition are missing.

- [ ] **Step 3: Implement CLI composition**

Load the newest accepted `crypto.large_address.address_balance_btc` cohort at or before `as_of`, map dimensions into `AddressWatch`, and compute the previous accepted cutoff. Load up to 90 accepted daily `confirmed_balance_btc` address maps and the latest accepted outgoing time per address, while retaining a boolean proving whether 180-day dormant history is complete. Construct `MempoolLargeAddressCollector` with the standard transport and registry. Add it to `build_batch_collectors` without enabling the source.

Keep the existing live-smoke contract: it invokes the production collector, validator, and current repository watchlist, writes no artifact or database rows, and prints only code, status, record count, effective time, and error code.

- [ ] **Step 4: Update data-health metadata and runbook**

Add `mempool-btc-large-addresses` to the TypeScript source metadata as `api`, daily, parser version `mempool-btc-large-addresses-v1`. Document that the source stays disabled until a valid watchlist exists and the live and publication smokes pass. Preserve the recorded BitInfoCharts 403/timeout result.

- [ ] **Step 5: Run focused tests**

Run both commands from Step 2. Expected: PASS.

- [ ] **Step 6: Commit wiring and health**

```powershell
git add quant-worker/collect_smart_insights.py quant-worker/tests src/lib/backend/smart-insights-data-health.ts src/lib/backend/smart-insights-data-health.test.ts docs/operations/smart-insights-runbook.md
git commit -m "feat: wire BTC large-address daily collection"
```

### Task 5: Extend the Crypto Market Pulse API and client contract

**Files:**
- Modify: `src/lib/backend/crypto-market-pulse.ts`
- Modify: `src/lib/backend/crypto-market-pulse.test.ts`
- Modify: `src/lib/crypto-market-pulse-client.ts`
- Modify: `src/lib/crypto-market-pulse-client.test.ts`
- Modify: `src/app/api/smart-insights/crypto-market-pulse/route.test.ts`

**Interfaces:**
- Produces: `CryptoMarketPulseResponse.largeAddressActivity` on the current server response.
- Produces backward-compatible optional client type `CryptoMarketPulseModel["largeAddressActivity"]` so a temporarily older API response does not break the preserved blocks.
- Consumes accepted latest-revision metric observations and the latest `signalSnapshot` where `signalType="large_address_action"` and `asset.symbol="BTC"`.

- [ ] **Step 1: Write failing read-model tests**

Extend the Prisma mock with `signalSnapshot.findFirst`. Provide 90 days of metric rows and a signal row. Assert:

```typescript
expect(result.largeAddressActivity.status).toBe("system");
expect(result.largeAddressActivity.score).toBe(42.5);
expect(result.largeAddressActivity.state).toBe("accumulation");
expect(result.largeAddressActivity.horizons.thirtyDay.netAccumulationBtc).toBe(1250);
expect(result.largeAddressActivity.exchangeFlows.at(-1)?.pressureBtc).toBe(-80);
expect(result.largeAddressActivity.notableActivity[0]?.counterparty).toBe("unknown");
```

Add no-observation and low-confidence cases; they return `unavailable` or `partial` with `score: null`, never backend sample rows.

- [ ] **Step 2: Run read-model tests and verify failure**

```powershell
npm test -- src/lib/backend/crypto-market-pulse.test.ts src/lib/crypto-market-pulse-client.test.ts src/app/api/smart-insights/crypto-market-pulse/route.test.ts
```

Expected: FAIL because the new object and Prisma signal query do not exist.

- [ ] **Step 3: Implement the optional read model**

Query 90 days of only the new metric codes plus the latest action signal. Deduplicate by natural key and revision using the existing helper. Build:

```typescript
largeAddressActivity: {
  status: "system" | "partial" | "unavailable";
  sourceCodes: string[];
  effectiveAt: string | null;
  universeObservedAt: string | null;
  score: number | null;
  state: "accumulation" | "neutral" | "distribution" | "calibrating" | "unavailable";
  confidence: number | null;
  calibrationStatus: "calibrating" | "calibrated" | "unavailable";
  horizons: { oneDay: Horizon; sevenDay: Horizon; thirtyDay: Horizon };
  exchangeFlows: ExchangeFlowPoint[];
  concentrationSeries: ConcentrationPoint[];
  breadthSeries: BreadthPoint[];
  notableActivity: ActivityRow[];
  entrantsExits: EntrantExitSummary | null;
  qualityFlags: string[];
  sources: SourceReference[];
}
```

If the optional module fails to find accepted data, return the unavailable object while preserving Fear & Greed, ETF, and CoinShares data.

- [ ] **Step 4: Add the exact Zod contract**

Mirror the server union values, nullable fields, arrays, and non-negative confidence bounds. Mark the complete object optional at the outer schema boundary, reject `score` outside `[-100, 100]`, and reject confidence outside `[0, 100]`.

- [ ] **Step 5: Run API and contract tests**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 6: Commit the API slice**

```powershell
git add src/lib/backend/crypto-market-pulse.ts src/lib/backend/crypto-market-pulse.test.ts src/lib/crypto-market-pulse-client.ts src/lib/crypto-market-pulse-client.test.ts src/app/api/smart-insights/crypto-market-pulse/route.test.ts
git commit -m "feat: expose BTC large-address activity"
```

### Task 6: Add the chart-first Smart Insights panel

**Files:**
- Create: `src/components/smart-insights/CryptoLargeAddressPanel.tsx`
- Modify: `src/components/smart-insights/LegacyMarketPulse.tsx`
- Modify: `src/components/smart-insights/source-guard.test.ts`

**Interfaces:**
- Consumes: `data: CryptoMarketPulseModel["largeAddressActivity"] | null`, `mode: CryptoPanelMode`, and `locale: "vi" | "en"`.
- Produces: `CryptoLargeAddressPanel` rendered after CoinShares and before the existing on-chain/metric grid.

- [ ] **Step 1: Write failing UI guard tests**

Require these tokens in the Smart Insights source tree:

```typescript
for (const token of [
  "CryptoLargeAddressPanel",
  "Whale Action Score",
  "large-address proxy",
  "Net Accumulation",
  "Exchange Flow Pressure",
  "Top 10 / tracked Top 100",
  "Dữ liệu mẫu",
  "unknown",
  "BarChart",
  "LineChart",
]) expect(source).toContain(token);
```

Assert the backend file does not contain the UI-only sample constant `BTC_LARGE_ADDRESS_SAMPLE`.

- [ ] **Step 2: Run UI tests and verify failure**

```powershell
npm test -- src/components/smart-insights/source-guard.test.ts src/lib/crypto-market-pulse-client.test.ts
```

Expected: FAIL because the new component is absent.

- [ ] **Step 3: Implement summary and charts**

Use existing `rounded-2xl border bg-card`, `DataStatusBadge`, `cn`, Recharts, and tabular-number conventions. Include:

- horizontally scrollable mobile KPI cards for score, state, confidence, and update times;
- 30D/90D control and net-accumulation bars with breadth line;
- green exchange-to-large bars, red large-to-exchange bars, pressure line;
- concentration line and accumulating/distributing/unchanged counts;
- explicit `Live`, `Delayed`, `Stale`, `Dữ liệu mẫu`, and `Unavailable` messaging.

The sample constant lives only in the component and every sample surface shows `DataStatusBadge status="SAMPLE"` plus `Dữ liệu mẫu`.

- [ ] **Step 4: Implement the activity table and mobile cards**

Show shortened address, balance change, action, reviewed counterparty or `unknown`, dormant days, confirmed time, source, and explorer link. Use `target="_blank" rel="noreferrer"`; do not construct links from unvalidated schemes.

- [ ] **Step 5: Compose without disturbing old blocks**

Import the component in `LegacyMarketPulse.tsx`. Derive its mode independently: loading while the Crypto request loads, sample when the request fails or the new module is unavailable, system/partial from the live module otherwise. Keep the existing Fear & Greed, ETF, CoinShares, on-chain pulse, metric grid, macro/gold tabs, and ticker code unchanged.

- [ ] **Step 6: Run UI tests, lint, and build**

```powershell
npm test -- src/components/smart-insights/source-guard.test.ts src/lib/crypto-market-pulse-client.test.ts
npm run lint
npm run build
```

Expected: all commands PASS.

- [ ] **Step 7: Commit the panel**

```powershell
git add src/components/smart-insights/CryptoLargeAddressPanel.tsx src/components/smart-insights/LegacyMarketPulse.tsx src/components/smart-insights/source-guard.test.ts
git commit -m "feat: visualize BTC large-address activity"
```

### Task 7: Full regression, live qualification, and local UI verification

**Files:**
- Modify: `docs/operations/smart-insights-runbook.md` only if actual smoke evidence or commands differ from Task 4.

**Interfaces:**
- Consumes the complete feature.
- Produces exact evidence for test status, source enablement, local services, API response, and rendered UI.

- [ ] **Step 1: Run the complete deterministic suites**

```powershell
..\.venv\Scripts\python.exe -m pytest quant-worker\tests -q
npm test
npm run lint
npm run build
```

Expected: all existing and new tests PASS. Fix any failure at its owning task boundary and rerun the failing focused command before rerunning the full suite.

- [ ] **Step 2: Confirm migration state without creating a migration**

```powershell
npx prisma migrate status
```

Expected: existing migrations are applied. If the database is behind, apply the repository's existing migration workflow; do not generate an empty feature migration.

- [ ] **Step 3: Run bounded live smokes while sources remain disabled**

```powershell
..\.venv\Scripts\python.exe quant-worker\collect_smart_insights.py daily --source bitinfocharts-top-addresses --live-smoke --env-file .env.local
..\.venv\Scripts\python.exe quant-worker\collect_smart_insights.py daily --source mempool-btc-large-addresses --live-smoke --env-file .env.local
```

Expected success gate for each source: current effective period, non-empty validated observations, production parser, provenance, no write, and no raw provider body printed. If either source fails, leave only that source disabled and record the exact error in the runbook.

- [ ] **Step 4: Conditionally enable and publish each successful source**

For each source whose own Step 3 smoke passes, add only that code to `ENABLED_SOURCE_CODES`, rerun its registry tests, then run its normal daily collection once. Read the resulting provider run, snapshot, and metric observations back through the database. Do not enable a source from the other source's success.

- [ ] **Step 5: Restart and verify the local stack**

Use the repository's existing local launcher. Verify independently:

```text
http://127.0.0.1:3100 -> HTTP 200
http://127.0.0.1:8100/healthz -> HTTP 200
/api/smart-insights/crypto-market-pulse -> authenticated response containing largeAddressActivity
```

- [ ] **Step 6: Perform rendered UI QA**

Open Smart Insights in the available authenticated browser. Verify desktop and mobile widths, old-block preservation, chart tooltips, 30D/90D control, activity table/cards, source/explorer links, and live/sample/stale/unavailable badges. If browser control is unavailable, report that limitation and do not claim visual QA.

- [ ] **Step 7: Commit only qualification-derived changes**

If source enablement or the runbook changed:

```powershell
git add quant-worker/smart_insights/sources.py docs/operations/smart-insights-runbook.md
git commit -m "chore: qualify BTC large-address sources"
```

If neither changed, create no empty commit.

- [ ] **Step 8: Verify delivery state**

```powershell
git status --short --branch
git log --oneline --decorate -8
```

Report the exact local branch/SHA, remote divergence, tests, migration status, live-smoke result per source, enabled-source list, service health, API truth, and browser truth separately. Do not push unless the user has requested push for this implementation.
