# Smart Insights Crypto Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver validated daily Crypto observations, deterministic metrics, regime scores, signals, and source-health evidence for BTC, ETH, and SOL.

**Architecture:** Collect API sources directly and Farside/CoinShares/BitInfoCharts through the approved Firecrawl boundary from Plan 1. Normalize all external facts into immutable metric observations, combine them with active Binance datasets, then compute point-in-time Crypto metric and signal snapshots without LLM involvement.

**Tech Stack:** Python 3.12-compatible standard library, Decimal, statistics, psycopg 3, existing immutable Binance datasets, Firecrawl REST, Alternative.me, Farside, Coin Metrics Community, mempool.space, DefiLlama, Deribit, CoinShares, BitInfoCharts, pytest.

## Global Constraints

- Requires the completed `2026-08-13-smart-insights-data-foundation.md` plan.
- Crypto ETF BTC/ETH/SOL flows have one canonical observation per source trading date.
- Fear & Greed and on-chain metrics have one canonical observation per closed UTC calendar day.
- CoinShares remains weekly and is never copied into a daily effective period.
- A Bitcoin address is not an investor; the product label is `Large-address balance change`, never `whale buy/sell`.
- Every collector uses fixed registry URLs, bounded responses, immutable snapshots, and a deterministic parser.
- Community/API/Farside data remain `research_only` or attribution-required according to the source registry.
- A source must pass a bounded live smoke before `enabled=true` outside tests.
- Production runtime must never fall back to sample market values.
- Preserve unrelated working-tree changes and commit only task files.

---

## File Structure

- `quant-worker/smart_insights/metrics/common.py`: point-in-time returns, z-scores, percentiles, volatility, drawdown, score aggregation, and confidence.
- `quant-worker/smart_insights/metrics/crypto.py`: Crypto metric definitions and Crypto Regime Score.
- `quant-worker/smart_insights/signals.py`: deterministic signal conditions and deduplication keys.
- `quant-worker/smart_insights/collectors/alternative_fng.py`: Alternative.me daily API adapter.
- `quant-worker/smart_insights/collectors/farside.py`: BTC/ETH/SOL ETF Firecrawl adapters.
- `quant-worker/smart_insights/collectors/coinmetrics.py`: daily Coin Metrics Community adapter.
- `quant-worker/smart_insights/collectors/mempool.py`: BTC network adapter.
- `quant-worker/smart_insights/collectors/defillama.py`: stablecoin and DeFi adapter.
- `quant-worker/smart_insights/collectors/deribit.py`: DVOL/funding/OI adapter.
- `quant-worker/smart_insights/collectors/coinshares.py`: weekly fund-flow parser.
- `quant-worker/smart_insights/collectors/bitinfocharts.py`: large-address proxy parser.
- `quant-worker/smart_insights/parsers/markdown_table.py`: bounded Markdown-table parser shared by Firecrawl sources.
- `quant-worker/smart_insights/crypto_pipeline.py`: source collection, observation publication, metric calculation, and signal publication.
- `quant-worker/tests/fixtures/smart_insights/crypto/`: recorded representative provider fixtures.
- `quant-worker/tests/test_smart_insights_crypto_metrics.py`: golden quant tests.
- `quant-worker/tests/test_smart_insights_crypto_collectors.py`: parser/adapter tests.
- `quant-worker/tests/test_smart_insights_crypto_pipeline_integration.py`: point-in-time publication and replay.
- `quant-worker/collect_smart_insights.py`: registers completed Crypto collectors.

---

### Task 1: Implement reusable point-in-time metric math

**Files:**

- Create: `quant-worker/smart_insights/metrics/__init__.py`
- Create: `quant-worker/smart_insights/metrics/common.py`
- Create: `quant-worker/smart_insights/signals.py`
- Create: `quant-worker/tests/test_smart_insights_crypto_metrics.py`

**Interfaces:**

- Produces: `simple_return`, `annualized_volatility`, `drawdown`, `rolling_z_score`, `empirical_percentile`, `signed_percentile_score`, `weighted_score`, `data_confidence`, `detect_signals`, and `SignalCandidate`.

- [ ] **Step 1: Write failing golden tests**

```python
def test_percentile_score_and_missing_coverage_are_deterministic() -> None:
    history = tuple(Decimal(value) for value in ("1", "2", "3", "4", "5"))
    assert empirical_percentile(history, Decimal("5")) == Decimal("1")
    assert signed_percentile_score(Decimal("1"), direction=-1) == Decimal("-100")
    with pytest.raises(InsufficientCoverageError):
        weighted_score({"flow": None, "momentum": Decimal("50")},
            {"flow": Decimal("0.8"), "momentum": Decimal("0.2")},
            minimum_coverage=Decimal("0.6"))

def test_signal_thresholds_do_not_fire_twice() -> None:
    first = detect_signals(metric("flow", z="2.1", percentile="0.98", value="5"), previous=None)
    second = detect_signals(metric("flow", z="2.2", percentile="0.99", value="6"), previous=metric("flow", z="2.1", percentile="0.98", value="5"))
    assert [row.kind for row in first] == ["zscore_extreme", "percentile_extreme"]
    assert second == ()
```

Also cover zero-variance z-score unavailable, no future revision in an as-of query, crypto 365-day annualization, invalid/empty rolling windows, flow sign change with one-standard-deviation magnitude, regime-label change, and source-conflict signal.

- [ ] **Step 2: Run tests and verify RED**

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_crypto_metrics.py -q`

Expected: FAIL because metric modules do not exist.

- [ ] **Step 3: Implement exact common transforms**

```python
def rolling_z_score(values: Sequence[Decimal], current: Decimal) -> Decimal | None:
    if len(values) < 2:
        return None
    mean = sum(values, Decimal("0")) / Decimal(len(values))
    variance = sum(((value - mean) ** 2 for value in values), Decimal("0")) / Decimal(len(values) - 1)
    deviation = variance.sqrt()
    if deviation == 0:
        return None
    return ((current - mean) / deviation).quantize(Decimal("0.000001"))

def signed_percentile_score(percentile: Decimal, direction: int) -> Decimal:
    if direction not in {-1, 0, 1} or not Decimal("0") <= percentile <= Decimal("1"):
        raise ValueError("Invalid score input.")
    return max(Decimal("-100"), min(Decimal("100"),
        Decimal(direction) * (Decimal("2") * percentile - Decimal("1")) * Decimal("100")))
```

Use `decimal.localcontext(prec=34)` for transforms and quantize only public outputs. Use daily log returns for volatility, simple close-to-close return for UI, `close/running_peak-1` for drawdown, empirical rank `count(value <= current) / count(values)` including current, and no forward fill. Percentile/z-score windows are code-owned by frequency: daily/observed-daily uses the latest 365 accepted periods with at least 60; weekly uses 156 with at least 26; monthly/source-month uses 120 with at least 24. A raw metric remains visible when history is shorter, but its score input is unavailable.

- [ ] **Step 4: Implement coverage and confidence**

`weighted_score` renormalizes valid weights only at configured coverage `>= 0.60`. `data_confidence` uses quality tiers 1.0 official/direct API, 0.85 reviewed community API, 0.70 deterministic Firecrawl, 0.50 heuristic/address-labelled. For age between zero and SLA, `freshness_factor = 1 - 0.5 * age / SLA`; it is zero after SLA and a future/negative age is invalid. Validation factor is 1.0 passed, 0.7 warning, and zero quarantined/conflicting. Market Data Confidence is the configured-weighted mean of valid input confidence multiplied by fresh configured-weight coverage, scaled and quantized to `[0, 100]`.

- [ ] **Step 5: Implement deterministic signal candidates**

Create signals only for `abs(z)>=2`, percentile `<=0.05` or `>=0.95`, first flow sign change with magnitude `>= trailing standard deviation`, regime-label change, accepted-source conflict, and visible-score freshness transition. The idempotency key is SHA-256 of canonical metric/market/asset/effective-time/kind/methodology JSON.

- [ ] **Step 6: Run tests and commit**

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_crypto_metrics.py -q`

Expected: PASS.

```bash
git add quant-worker/smart_insights/metrics quant-worker/smart_insights/signals.py quant-worker/tests/test_smart_insights_crypto_metrics.py
git commit -m "feat: add deterministic insight metrics"
```

---

### Task 2: Collect daily Fear & Greed and Crypto ETF flows

**Files:**

- Create: `quant-worker/smart_insights/parsers/__init__.py`
- Create: `quant-worker/smart_insights/parsers/markdown_table.py`
- Create: `quant-worker/smart_insights/collectors/__init__.py`
- Create: `quant-worker/smart_insights/collectors/alternative_fng.py`
- Create: `quant-worker/smart_insights/collectors/farside.py`
- Create: `quant-worker/tests/test_smart_insights_crypto_collectors.py`
- Create: `quant-worker/tests/fixtures/smart_insights/crypto/alternative-fng.json`
- Create: `quant-worker/tests/fixtures/smart_insights/crypto/farside-btc.md`
- Create: `quant-worker/tests/fixtures/smart_insights/crypto/farside-eth.md`
- Create: `quant-worker/tests/fixtures/smart_insights/crypto/farside-sol.md`

**Interfaces:**

- Produces: `AlternativeFearGreedCollector.collect(as_of)`, `FarsideEtfCollector.collect(as_of)`, and `parse_markdown_table(markdown, required_headers)` returning `CollectionBatch` objects.

- [ ] **Step 1: Record bounded fixtures and write failing parser tests**

The Farside fixture includes date, fund columns, total, `-`, parentheses negatives, commas, and one revised row. Assert:

```python
batch = FarsideEtfCollector("BTC", firecrawl=fake_firecrawl("farside-btc.md")).collect(NOW)
totals = [row for row in batch.observations if row.metric_code == "crypto.etf.net_flow_usd" and row.dimensions == {"asset": "BTC", "fund": "TOTAL"}]
assert totals[0].effective_at == datetime(2026, 8, 12, tzinfo=timezone.utc)
assert totals[0].value == Decimal("842000000")
assert sum(row.value for row in batch.observations if row.dimensions.get("fund") != "TOTAL") == totals[0].value
```

Alternative test asserts integer value 0-100, provider timestamp conversion, history ordering, and attribution metadata.

- [ ] **Step 2: Run collector tests and verify RED**

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_crypto_collectors.py -q`

Expected: FAIL because collectors are missing.

- [ ] **Step 3: Implement the bounded Markdown table parser**

Accept one table with required headers, cap at 500 rows and 100 columns, trim Markdown formatting, preserve raw cell text, reject duplicate required headers, and raise `SCHEMA_DRIFT` when the expected table is absent. It must not interpret numbers; source collectors own units.

- [ ] **Step 4: Implement Alternative.me parsing**

Use the registered endpoint `https://api.alternative.me/fng/?limit=0&format=json`. Reject values outside 0-100, invalid Unix timestamps, non-daily duplicate timestamps, and missing attribution metadata. Publish `crypto.fear_greed.index` once per provider date.

- [ ] **Step 5: Implement Farside parsing and reconciliation**

Map `BTC/ETH/SOL` to the three registered pages. Parse millions-of-USD cells to absolute USD Decimal, publish one row per fund plus `TOTAL`, and require the rounded sum of fund rows to match the reported total within USD 100,000. A mismatch returns `RECONCILIATION_FAILED` and activates no row for that date.

- [ ] **Step 6: Run tests and commit**

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_crypto_collectors.py -q`

Expected: PASS.

```bash
git add quant-worker/smart_insights/parsers quant-worker/smart_insights/collectors/alternative_fng.py quant-worker/smart_insights/collectors/farside.py quant-worker/tests/test_smart_insights_crypto_collectors.py quant-worker/tests/fixtures/smart_insights/crypto
git commit -m "feat: collect daily crypto sentiment and ETF flows"
```

---

### Task 3: Collect closed-day on-chain and liquidity observations

**Files:**

- Create: `quant-worker/smart_insights/collectors/coinmetrics.py`
- Create: `quant-worker/smart_insights/collectors/mempool.py`
- Create: `quant-worker/smart_insights/collectors/defillama.py`
- Modify: `quant-worker/tests/test_smart_insights_crypto_collectors.py`
- Create: `quant-worker/tests/fixtures/smart_insights/crypto/coinmetrics.json`
- Create: `quant-worker/tests/fixtures/smart_insights/crypto/mempool.json`
- Create: `quant-worker/tests/fixtures/smart_insights/crypto/defillama-stablecoins.json`
- Create: `quant-worker/tests/fixtures/smart_insights/crypto/defillama-chains.json`

**Interfaces:**

- Produces daily `CollectionBatch` rows for adjusted transfer, active addresses, MVRV/NVT/SOPR/NUPL, network state, stablecoin supply, and the two declared DefiLlama metrics.

- [ ] **Step 1: Write failing closed-day and unit tests**

```python
batch = CoinMetricsCollector(transport=fake_json("coinmetrics.json")).collect(NOW)
assert {row.effective_at.hour for row in batch.observations} == {0}
assert all(row.effective_at < NOW.replace(hour=0, minute=0, second=0, microsecond=0)
           for row in batch.observations)
assert metric(batch, "crypto.onchain.mvrv").value == Decimal("2.11")
```

Assert Coin Metrics paging cannot move backward, mempool intraday snapshots are reduced to the declared observation time instead of labelled as a closed daily series, and DefiLlama totals reject negative or duplicate series.

- [ ] **Step 2: Run tests and verify RED**

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_crypto_collectors.py -q`

Expected: FAIL on missing collectors.

- [ ] **Step 3: Implement Coin Metrics Community adapter**

Call the registered Community v4 asset-metrics endpoint with code-owned BTC metrics, `frequency=1d`, `start_time/end_time` bounded to the required overlap, and page size/cursor caps. Accept only fully closed UTC dates. Normalize all numeric strings with Decimal and publish provider metric names in snapshot metadata.

- [ ] **Step 4: Implement mempool.space adapter**

Use registered endpoints for recommended fees, mempool state, and hashrate/difficulty history. Publish instantaneous network metrics with their actual `observedAt`; derive a daily network observation only from a provider daily/history row, never by pretending one intraday request is a closed daily aggregate.

- [ ] **Step 5: Implement DefiLlama adapters**

Normalize only `stablecoincharts/all` into total stablecoin supply by UTC date and `v2/chains` into a daily observed chain-TVL snapshot in this phase. Do not enable any other DefiLlama endpoint and do not scrape Pro downloads.

- [ ] **Step 6: Run tests and commit**

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_crypto_collectors.py -q`

Expected: PASS.

```bash
git add quant-worker/smart_insights/collectors/coinmetrics.py quant-worker/smart_insights/collectors/mempool.py quant-worker/smart_insights/collectors/defillama.py quant-worker/tests/test_smart_insights_crypto_collectors.py quant-worker/tests/fixtures/smart_insights/crypto
git commit -m "feat: collect daily crypto onchain data"
```

---

### Task 4: Collect derivatives, weekly fund flows, and large-address proxies

**Files:**

- Create: `quant-worker/smart_insights/collectors/deribit.py`
- Create: `quant-worker/smart_insights/collectors/coinshares.py`
- Create: `quant-worker/smart_insights/collectors/bitinfocharts.py`
- Modify: `quant-worker/tests/test_smart_insights_crypto_collectors.py`
- Create: `quant-worker/tests/fixtures/smart_insights/crypto/deribit.json`
- Create: `quant-worker/tests/fixtures/smart_insights/crypto/coinshares.md`
- Create: `quant-worker/tests/fixtures/smart_insights/crypto/bitinfocharts.md`

**Interfaces:**

- Produces: BTC/ETH DVOL/funding/OI observations, weekly CoinShares rows, and heuristic large-address cohort rows with coverage/confidence dimensions.

- [ ] **Step 1: Write failing source-specific tests**

Assert Deribit rejects unknown instruments; CoinShares stores report-period end separate from crawl time; BitInfoCharts excludes labelled exchange/custodian rows and reports label coverage:

```python
batch = BitInfoChartsCollector(firecrawl=fake_firecrawl("bitinfocharts.md")).collect(NOW)
proxy = metric(batch, "crypto.large_address.balance_change_btc")
assert proxy.dimensions["cohort"] == "reviewed_non_exchange"
assert Decimal(proxy.dimensions["label_coverage"]) < Decimal("1")
assert "whale" not in proxy.dimensions.values()
```

- [ ] **Step 2: Run tests and verify RED**

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_crypto_collectors.py -q`

Expected: FAIL on missing collectors.

- [ ] **Step 3: Implement Deribit adapter**

Use `/api/v2/public/get_volatility_index_data` for BTC/ETH DVOL daily OHLC and `/api/v2/public/ticker` only for code-owned instruments. Store funding/OI as actual observation-time metrics; do not label them daily unless aggregated from valid history rows.

- [ ] **Step 4: Implement CoinShares weekly parser**

Extract report date, period end, asset/region flows, and AUM from the allow-listed report page/PDF fixture. Publish weekly effective periods and keep source units. Reject a report without an explicit period.

- [ ] **Step 5: Implement reviewed entity exclusions**

Parse ranks 1–100 only from the registered first page. Keep code-owned normalized label patterns for exchange, custodian, miner, government, and known special entities. Publish the reviewed non-exchange cohort balance for the current UTC observation date; calculate `crypto.large_address.balance_change_btc` as today's accepted cohort balance minus the prior accepted UTC-date cohort balance using address intersection plus explicit entrant/exit dimensions. Also publish tracked balance, excluded balance, labelled balance, address counts, and label coverage. Unknown labels stay unknown; they are not asserted to be individuals. If no prior accepted daily snapshot exists, publish balance only and leave change unavailable.

- [ ] **Step 6: Run tests and commit**

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_crypto_collectors.py -q`

Expected: PASS.

```bash
git add quant-worker/smart_insights/collectors/deribit.py quant-worker/smart_insights/collectors/coinshares.py quant-worker/smart_insights/collectors/bitinfocharts.py quant-worker/tests/test_smart_insights_crypto_collectors.py quant-worker/tests/fixtures/smart_insights/crypto
git commit -m "feat: collect crypto derivatives and fund evidence"
```

---

### Task 5: Compute and publish Crypto regime/signals

**Files:**

- Create: `quant-worker/smart_insights/metrics/crypto.py`
- Create: `quant-worker/smart_insights/crypto_pipeline.py`
- Create: `quant-worker/tests/test_smart_insights_crypto_pipeline_integration.py`
- Modify: `quant-worker/collect_smart_insights.py`
- Modify: `quant-worker/smart_insights/sources.py`
- Modify: `README.md`

**Interfaces:**

- Produces: `calculate_crypto_snapshot(repository, as_of) -> SignalSnapshotInput`, `run_crypto_pipeline(...) -> PipelineResult`, and enabled daily/weekly Crypto source schedules.

- [ ] **Step 1: Write failing point-in-time integration test**

Seed active BTC/ETH/SOL daily datasets and immutable source observations, then assert:

```python
snapshot = calculate_crypto_snapshot(repository, as_of=AS_OF)
assert snapshot.market == "crypto"
assert snapshot.methodology_version == "crypto-regime-v1"
assert snapshot.coverage >= Decimal("0.60")
assert snapshot.score == expected_weighted_score
assert all(input_row.observed_at <= AS_OF for input_row in snapshot.inputs)
```

Add a replay assertion proving a later revised ETF row does not change the prior as-of result.

- [ ] **Step 2: Run integration test and verify RED**

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_crypto_pipeline_integration.py -q`

Expected: FAIL because pipeline is missing.

- [ ] **Step 3: Seed exact Crypto definitions**

Create code-owned `MetricDefinitionInput` rows for every implemented metric, including unit, frequency, direction, SLA, lookback, and quality tier. Upsert definitions by code without overwriting an existing methodology version silently.

- [ ] **Step 4: Implement Crypto groups and weights**

```python
CRYPTO_GROUP_WEIGHTS = {
    "momentum": Decimal("0.20"),
    "flow": Decimal("0.25"),
    "liquidity": Decimal("0.15"),
    "onchain": Decimal("0.20"),
    "derivatives": Decimal("0.10"),
    "sentiment": Decimal("0.10"),
}
```

Freeze scored components in `CRYPTO_GROUP_COMPONENTS`:

```python
CRYPTO_GROUP_COMPONENTS = {
    "momentum": ("price.btc.momentum_20d", "price.eth.momentum_20d", "price.sol.momentum_20d"),
    "flow": ("crypto.etf.net_flow_usd_5d", "crypto.coinshares.net_flow_usd"),
    "liquidity": ("crypto.stablecoin.supply_change_7d", "crypto.defi.tvl_change_7d"),
    "onchain": ("crypto.onchain.adjusted_transfer_change_30d", "crypto.onchain.active_addresses_change_30d", "crypto.onchain.nvt", "crypto.network.hashrate_change_30d"),
    "derivatives": ("crypto.derivatives.btc_dvol", "crypto.derivatives.eth_dvol", "crypto.derivatives.abs_funding_percentile"),
    "sentiment": ("crypto.fear_greed.index",),
}
```

Within each group, configured component weight is equal. ETF flow is the five-source-trading-day sum across BTC/ETH/SOL `TOTAL` rows. CoinShares keeps its weekly period and contributes only while fresh. Price momentum, transfers, addresses, stablecoin supply, TVL, and hashrate are positive-direction; NVT, DVOL, and absolute funding crowding are negative-direction. MVRV, SOPR, NUPL, OI, mempool state, and the large-address proxy are evidence/display metrics in methodology v1 and do not silently enter the score.

Read active Binance bars for price-derived metrics; read latest valid observations as-of time for external metrics. Require 60% fresh configured-weight coverage, assign approved labels, calculate Data Confidence, and persist signal inputs plus source observation IDs.

- [ ] **Step 5: Register collectors only after live smoke**

Add `--live-smoke --source CODE` to the CLI. The smoke fetches one bounded current source, parses at least one effective period, validates it, prints source/effective time/row count, and writes nothing. Eligible source codes are `alternative-fng`, `farside-btc-etf`, `farside-eth-etf`, `farside-sol-etf`, `coinmetrics-community`, `mempool-space`, `defillama-stablecoins`, `defillama-chains`, `deribit-public`, `coinshares-weekly`, and `bitinfocharts-top-addresses`. Set `enabled=True` one code at a time only after its own production parser smoke passes; any fixture-only or access-limited source remains disabled and its metric coverage is explicitly unavailable.

- [ ] **Step 6: Run full Crypto verification**

Run: `$env:PYTHONPATH=(Resolve-Path "quant-worker").Path; python -m pytest quant-worker/tests/test_smart_insights_crypto_metrics.py quant-worker/tests/test_smart_insights_crypto_collectors.py quant-worker/tests/test_smart_insights_crypto_pipeline_integration.py -q`

Expected: PASS.

Run one explicitly authorized live smoke per enabled source and retain sanitized output in the implementation report; do not put provider bodies in Git.

- [ ] **Step 7: Commit**

```bash
git add quant-worker/smart_insights/metrics/crypto.py quant-worker/smart_insights/crypto_pipeline.py quant-worker/tests/test_smart_insights_crypto_pipeline_integration.py quant-worker/collect_smart_insights.py quant-worker/smart_insights/sources.py README.md
git commit -m "feat: publish crypto regime signals"
```

---

## Plan 2 Completion Gate

- BTC/ETH/SOL price metrics come from active immutable datasets.
- Fear & Greed and on-chain use closed daily periods; Crypto ETF flow uses each source trading date.
- Farside totals reconcile or the effective date is quarantined.
- CoinShares stays weekly, and heuristic address data displays coverage/confidence.
- Crypto Regime Score and signals are deterministic, point-in-time, replayable, and unavailable below 60% coverage.
- Every enabled source has fixture tests and a bounded live smoke through the production parser.
