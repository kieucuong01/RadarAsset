# Smart Insights Gold Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver source-backed Gold observations, cross-asset diagnostics, deterministic Gold Regime Scores, and evidence-ready signals without converting weekly or monthly facts into fake daily data.

**Architecture:** Reuse the platform's active immutable XAU/USD dataset for daily price-derived metrics, reuse Macro plan FRED and CFTC facts, and collect World Gold Council tables through the private Firecrawl boundary. Join series only on information available at calculation time, retain every source period, and publish the score only when at least 60% of configured weight is fresh and valid.

**Tech Stack:** Python 3.12-compatible standard library, Decimal, statistics, psycopg 3, existing immutable datasets, FRED, CFTC Public Reporting Environment, World Gold Council via Firecrawl, pytest.

## Global Constraints

- Requires the completed data-foundation, Crypto metric-math, and Macro/CFTC plans.
- The active XAU/USD dataset version is the sole daily price source in this slice; do not introduce an unreviewed second price feed.
- World Gold Council observations retain their reported weekly or monthly effective period and are never forward-filled into daily observations.
- CFTC Gold positioning remains weekly; report date and observed/publication time stay distinct.
- Cross-asset calculations use timestamp intersections and point-in-time availability; no look-ahead join or forward-fill.
- Higher real yields and stronger USD pressure are negative Gold inputs; positive ETF flow and central-bank demand are positive inputs.
- A source must pass a bounded live smoke before `enabled=true` outside tests.
- Preserve unrelated working-tree changes and commit only task files.

---

## File Structure

- `quant-worker/smart_insights/gold_registry.py`: exact Gold metrics, weights, directions, SLAs, and references to foundation source codes.
- `quant-worker/smart_insights/parsers/xlsx_table.py`: bounded standard-library XLSX worksheet reader.
- `quant-worker/smart_insights/collectors/world_gold_council.py`: Firecrawl landing-page discovery plus deterministic ETF and central-bank workbook parsers.
- `quant-worker/smart_insights/metrics/gold.py`: price metrics, aligned correlation/beta, CFTC metrics, and Gold Regime Score.
- `quant-worker/smart_insights/gold_pipeline.py`: point-in-time observation, metric, score, and signal publication.
- `quant-worker/tests/fixtures/smart_insights/gold/`: recorded World Gold Council and price-series fixtures.
- `quant-worker/tests/test_smart_insights_gold_collectors.py`: parser and period-preservation tests.
- `quant-worker/tests/test_smart_insights_gold_metrics.py`: golden price, cross-asset, and regime tests.
- `quant-worker/tests/test_smart_insights_gold_pipeline_integration.py`: frozen-day publication and replay tests.
- `quant-worker/collect_smart_insights.py`: registers Gold collection and calculation jobs.

---

### Task 1: Register exact Gold metrics and source policy

**Files:**

- Create: `quant-worker/smart_insights/gold_registry.py`
- Modify: `quant-worker/tests/test_smart_insights_registry.py`

**Interfaces:**

- Produces: code-owned `SourceDefinition` and `MetricDefinitionSeed` rows for XAU, WGC, CFTC, FRED real yield, and FRED USD pressure inputs.

- [ ] **Step 1: Write a failing registry contract test**

```python
def test_gold_registry_freezes_weights_direction_and_frequency() -> None:
    assert GOLD_GROUP_WEIGHTS == {
        "momentum": Decimal("0.20"),
        "real_yields": Decimal("0.25"),
        "usd_pressure": Decimal("0.20"),
        "etf_flow": Decimal("0.15"),
        "cftc_positioning": Decimal("0.10"),
        "central_bank_demand": Decimal("0.10"),
    }
    assert GOLD_METRICS["macro.real_yield.10y_pct"].direction == -1
    assert GOLD_METRICS["macro.usd_broad_index"].direction == -1
    assert GOLD_METRICS["gold.etf_flow_tonnes"].direction == 1
    assert GOLD_METRICS["gold.central_bank_net_purchase_tonnes"].frequency == "source_period"
    source = source_for_code("wgc-gold-etf")
    assert source.collection_mode is CollectionMode.FIRECRAWL
    assert source.enabled is False
```

- [ ] **Step 2: Run the test and confirm the registry is missing**

Run: `cd quant-worker; python -m pytest tests/test_smart_insights_registry.py -q`

Expected: FAIL because `gold_registry` does not exist.

- [ ] **Step 3: Implement the frozen registry**

```python
GOLD_GROUP_WEIGHTS = {
    "momentum": Decimal("0.20"),
    "real_yields": Decimal("0.25"),
    "usd_pressure": Decimal("0.20"),
    "etf_flow": Decimal("0.15"),
    "cftc_positioning": Decimal("0.10"),
    "central_bank_demand": Decimal("0.10"),
}

GOLD_METRIC_ROWS = (
    ("gold.xau_return_1d", "momentum", 1, "P3D", "daily"),
    ("gold.xau_momentum_20d", "momentum", 1, "P3D", "daily"),
    ("macro.real_yield.10y_pct", "real_yields", -1, "P3D", "daily"),
    ("macro.usd_broad_index", "usd_pressure", -1, "P3D", "daily"),
    ("gold.etf_flow_tonnes", "etf_flow", 1, "P14D", "source_period"),
    ("gold.cftc_managed_money_net", "cftc_positioning", 1, "P10D", "weekly"),
    ("gold.central_bank_net_purchase_tonnes", "central_bank_demand", 1, "P120D", "source_period"),
)
```

Create `GOLD_METRICS` as an immutable input mapping and `GOLD_SOURCE_CODES = ("wgc-gold-etf", "wgc-central-bank", "cftc-disaggregated", "fred")`. Gold-owned codes are seeded here; the two `macro.*` rows must already exist with matching unit/direction/methodology and are referenced without creating duplicates. Resolve every source through the foundation registry so URL, attribution, enablement, and licensing policy cannot diverge. Validation rejects weights that do not sum to `1.00`, unknown source codes, and missing or mismatched metric methodology.

- [ ] **Step 4: Run the registry test**

Run: `cd quant-worker; python -m pytest tests/test_smart_insights_registry.py -q`

Expected: PASS.

- [ ] **Step 5: Commit the registry**

```bash
git add quant-worker/smart_insights/gold_registry.py quant-worker/tests/test_smart_insights_registry.py
git commit -m "feat: register smart insights gold metrics"
```

---

### Task 2: Calculate daily XAU price and cross-asset metrics from immutable datasets

**Files:**

- Create: `quant-worker/smart_insights/metrics/gold.py`
- Create: `quant-worker/tests/fixtures/smart_insights/gold/xau_daily.json`
- Create: `quant-worker/tests/test_smart_insights_gold_metrics.py`

**Interfaces:**

- Consumes: active immutable daily dataset rows for platform symbols `XAU`, `BTC`, and `SPY`, plus FRED 10Y real yield and USD pressure.
- Produces: `GoldPriceMetrics`, `CrossAssetMetric`, `aligned_correlation`, and `aligned_beta`.

- [ ] **Step 1: Write failing golden tests for price and aligned joins**

```python
def test_xau_metrics_are_closed_day_and_decimal_stable() -> None:
    rows = load_price_fixture("xau_daily.json")
    result = calculate_xau_metrics(rows, as_of=date(2026, 8, 12))
    assert result.effective_date == date(2026, 8, 12)
    assert result.return_1d == Decimal("0.010000")
    assert result.drawdown_from_peak == Decimal("-0.019608")

def test_cross_asset_math_uses_only_timestamp_intersection() -> None:
    gold = points(("2026-01-01", "1"), ("2026-01-02", "2"), ("2026-01-03", "3"))
    real_yield = points(("2026-01-01", "3"), ("2026-01-03", "1"))
    result = aligned_correlation(gold, real_yield, minimum_points=2)
    assert result.point_count == 2
    assert result.value == Decimal("-1.000000")
```

- [ ] **Step 2: Run the focused tests and confirm missing implementation**

Run: `cd quant-worker; python -m pytest tests/test_smart_insights_gold_metrics.py -q`

Expected: FAIL on missing `metrics.gold`.

- [ ] **Step 3: Implement Decimal-stable price metrics**

Implement `return_1d`, 20/60/120-day momentum, 20-day annualized volatility, and running drawdown. Reject duplicate dates and any row after `as_of`; require a closed UTC date and retain the active `DatasetVersion.id` in every calculation input.

```python
@dataclass(frozen=True)
class CrossAssetMetric:
    benchmark: str
    window: int
    effective_date: date
    value: Decimal | None
    point_count: int
    input_dataset_versions: tuple[str, ...]

def aligned_beta(y: Sequence[DatedPoint], x: Sequence[DatedPoint], *, minimum_points: int = 60) -> CrossAssetMetric:
    joined = intersect_by_date(y, x)
    if len(joined) < minimum_points:
        return unavailable_cross_asset_metric(joined)
    covariance = sample_covariance(joined)
    variance = sample_variance([pair.x for pair in joined])
    return metric_or_unavailable(covariance, variance, joined)
```

Use `XAU` as the dependent return series and `BTC`, `SPY`, `macro.real_yield.10y_pct`, and `macro.usd_broad_index` as the four code-owned benchmarks. Use daily changes for yield/index observations and log returns for price series. Return unavailable when the aligned window has fewer than 60 points or benchmark variance is zero.

- [ ] **Step 4: Run the Gold metric tests**

Run: `cd quant-worker; python -m pytest tests/test_smart_insights_gold_metrics.py -q`

Expected: PASS.

- [ ] **Step 5: Commit price and cross-asset math**

```bash
git add quant-worker/smart_insights/metrics/gold.py quant-worker/tests/fixtures/smart_insights/gold/xau_daily.json quant-worker/tests/test_smart_insights_gold_metrics.py
git commit -m "feat: calculate point in time gold metrics"
```

---

### Task 3: Parse World Gold Council ETF and central-bank periods through Firecrawl

**Files:**

- Create: `quant-worker/smart_insights/collectors/world_gold_council.py`
- Create: `quant-worker/smart_insights/parsers/xlsx_table.py`
- Create: `quant-worker/tests/fixtures/smart_insights/gold/wgc_etf_landing.md`
- Create: `quant-worker/tests/fixtures/smart_insights/gold/wgc_etf.xlsx`
- Create: `quant-worker/tests/fixtures/smart_insights/gold/wgc_central_bank_landing.md`
- Create: `quant-worker/tests/fixtures/smart_insights/gold/wgc_central_bank.xlsx`
- Create: `quant-worker/tests/test_smart_insights_gold_collectors.py`

**Interfaces:**

- Consumes: `FirecrawlArtifact` for the two allow-listed World Gold Council landing pages and bounded `.xlsx` bytes from the discovered `www.gold.org/download/file/` link.
- Produces: `ObservationCandidate` rows with reported period, value, unit, source URL, snapshot ID, parser version, and quality warnings.

- [ ] **Step 1: Record bounded representative fixtures and parser expectations**

Landing fixtures include title, source URL, publication/update date, and one `.xlsx` download link. Workbook fixtures contain shared strings, explicit period labels, units, one total row, one footnote, and one malformed row. Landing Markdown stays below 100 KB and each workbook stays below 2 MB.

```python
def test_wgc_etf_parser_preserves_reported_period() -> None:
    artifact, workbook = load_wgc_fixture("wgc_etf")
    rows = parse_wgc_etf(artifact, workbook)
    total = next(row for row in rows if row.asset == "GLOBAL_GOLD_ETF")
    assert total.effective_period == DateRange(date(2026, 7, 1), date(2026, 7, 31))
    assert total.frequency == "monthly"
    assert total.metric_code == "gold.etf_flow_tonnes"
    assert total.license_scope == "research_only"

def test_wgc_parser_never_publishes_malformed_value() -> None:
    artifact, workbook = load_wgc_fixture("wgc_central_bank")
    result = parse_wgc_central_bank(artifact, workbook)
    assert result.quarantined_count == 1
    assert result.quarantine_reason == "INVALID_NUMBER"
```

- [ ] **Step 2: Run the parser tests and confirm failure**

Run: `cd quant-worker; python -m pytest tests/test_smart_insights_gold_collectors.py -q`

Expected: FAIL because the WGC collector is absent.

- [ ] **Step 3: Implement bounded XLSX reading and safe download discovery**

Use `zipfile.ZipFile` and `xml.etree.ElementTree` only. Reject encrypted archives, path traversal, macros, external relationships, more than 20 worksheets, more than 20 MB uncompressed XML, more than 20,000 rows, or more than 200 columns. Support shared strings, inline strings, booleans, and numeric cells; do not evaluate formulas. The landing parser accepts exactly one matching `.xlsx` link on `www.gold.org/download/file/`; the HTTP boundary caps the workbook at 10 MB and stores it as a child raw artifact linked in snapshot metadata.

- [ ] **Step 4: Implement strict table selection and period parsing**

```python
WGC_ALLOWED_HOSTS = ("gold.org", "www.gold.org")
PARSER_VERSIONS = {"wgc-gold-etf": "wgc-etf-v1", "wgc-central-bank": "wgc-central-bank-v1"}

def candidate(*, source_code: str, metric_code: str, period: DateRange, value: Decimal, unit: str, artifact: FirecrawlArtifact) -> ObservationCandidate:
    return ObservationCandidate(
        metric_code=metric_code,
        market="gold",
        asset="XAU",
        effective_start=period.start,
        effective_end=period.end,
        observed_at=artifact.fetched_at,
        value=value,
        unit=unit,
        source_code=source_code,
        source_url=artifact.source_url,
        raw_snapshot_id=artifact.snapshot_id,
        parser_version=PARSER_VERSIONS[source_code],
        methodology_version="gold-source-period-v1",
        license_scope="research_only",
    )
```

Select worksheets/tables by normalized required headers rather than sheet index or cell coordinates. Accept only explicit reported periods and declared units. ETF rows come from the registered Gold ETF landing/workbook; central-bank reserve-change rows come from the registered Gold Reserves landing/workbook. Quarantine structure drift as `SCHEMA_DRIFT`; do not use page prose to infer a missing workbook value.

- [ ] **Step 5: Prove source periods are not expanded to daily rows**

Add a test that publishes one July ETF observation and asserts exactly one `MetricObservation` exists with `effectiveStart=2026-07-01` and `effectiveEnd=2026-07-31`.

Run: `cd quant-worker; python -m pytest tests/test_smart_insights_gold_collectors.py -q`

Expected: PASS with one source-period row.

- [ ] **Step 6: Commit WGC collectors**

```bash
git add quant-worker/smart_insights/parsers/xlsx_table.py quant-worker/smart_insights/collectors/world_gold_council.py quant-worker/tests/fixtures/smart_insights/gold quant-worker/tests/test_smart_insights_gold_collectors.py
git commit -m "feat: collect source period gold fund data"
```

---

### Task 4: Calculate CFTC Gold positioning and the deterministic Gold regime

**Files:**

- Modify: `quant-worker/smart_insights/metrics/gold.py`
- Modify: `quant-worker/tests/test_smart_insights_gold_metrics.py`

**Interfaces:**

- Consumes: CFTC gold contract `088691`, signed percentile inputs, WGC observations, real yield, USD pressure, and price momentum.
- Produces: CFTC net/delta/percentile metrics and `MarketRegimeResult` for Gold.

- [ ] **Step 1: Write failing Gold regime golden tests**

```python
def test_gold_regime_uses_exact_weight_and_direction() -> None:
    result = gold_regime({
        "momentum": input_score("40", confidence="90"),
        "real_yields": input_score("-20", confidence="100"),
        "usd_pressure": input_score("30", confidence="80"),
        "etf_flow": input_score("60", confidence="70"),
        "cftc_positioning": input_score("10", confidence="85"),
        "central_bank_demand": input_score("50", confidence="60"),
    })
    assert result.score == Decimal("24.00")
    assert result.label == "constructive"
    assert result.configured_weight_coverage == Decimal("1.00")

def test_gold_regime_is_unavailable_below_sixty_percent_coverage() -> None:
    with pytest.raises(InsufficientCoverageError):
        gold_regime({"momentum": input_score("20"), "real_yields": input_score("10")})
```

- [ ] **Step 2: Run the tests and confirm score behavior is missing**

Run: `cd quant-worker; python -m pytest tests/test_smart_insights_gold_metrics.py -q`

Expected: FAIL on missing `gold_regime`.

- [ ] **Step 3: Implement positioning and scoring**

Compute managed-money net as `long - short`, normalized net as `(long - short) / open_interest`, weekly delta against the previous report date, and an expanding historical percentile using only reports known by `as_of`. Momentum is the equal-weight mean of XAU 1-day return percentile and 20-day momentum percentile. The other five groups each use exactly one component: 10Y real yield level (negative direction), USD broad index 20-day change (negative), global Gold ETF flow tonnes (positive), CFTC managed-money normalized net (positive), and global central-bank reserve change tonnes (positive). Cross-asset correlation/beta, volatility, drawdown, ETF holdings, country reserves, and CFTC raw counts remain display/evidence metrics in v1. Convert scored components to signed percentile score `[-100, 100]`, exclude stale/quarantined inputs, require 60% configured-weight coverage, renormalize fresh weights, and use the frozen labels:

```python
def regime_label(score: Decimal) -> str:
    if score <= Decimal("-40"): return "strongly_negative"
    if score <= Decimal("-15"): return "negative"
    if score < Decimal("15"): return "neutral"
    if score < Decimal("40"): return "constructive"
    return "strongly_positive"
```

Data Confidence uses the foundation formula and caps at 100. Include all metric observation IDs and methodology version `gold-regime-v1` in the output.

- [ ] **Step 4: Run all Gold metric tests**

Run: `cd quant-worker; python -m pytest tests/test_smart_insights_gold_metrics.py -q`

Expected: PASS.

- [ ] **Step 5: Commit Gold scoring**

```bash
git add quant-worker/smart_insights/metrics/gold.py quant-worker/tests/test_smart_insights_gold_metrics.py
git commit -m "feat: score smart insights gold regime"
```

---

### Task 5: Publish and replay the Gold vertical slice

**Files:**

- Create: `quant-worker/smart_insights/gold_pipeline.py`
- Modify: `quant-worker/collect_smart_insights.py`
- Create: `quant-worker/tests/test_smart_insights_gold_pipeline_integration.py`

**Interfaces:**

- Consumes: active price dataset, accepted WGC/CFTC/FRED observations, repository transaction, and `as_of` time.
- Produces: immutable Gold observations, metric snapshots, signals, Data Confidence, and a reproducible Gold regime snapshot.

- [ ] **Step 1: Write a frozen-day integration test**

```python
def test_gold_pipeline_replays_without_future_or_forward_filled_facts(db) -> None:
    seed_xau_through(db, "2026-08-12")
    seed_wgc_period(db, start="2026-07-01", end="2026-07-31", observed_at="2026-08-05T10:00:00Z")
    seed_cftc_report(db, report_date="2026-08-04", observed_at="2026-08-07T19:30:00Z")
    first = run_gold(db, as_of="2026-08-12T23:59:59Z")
    seed_wgc_period(db, start="2026-08-01", end="2026-08-31", observed_at="2026-09-05T10:00:00Z")
    replay = run_gold(db, as_of="2026-08-12T23:59:59Z")
    assert replay.fingerprint == first.fingerprint
    assert replay.input_ids == first.input_ids
    assert count_metric(db, "gold.etf_flow_tonnes", effective_start="2026-07-01") == 1
```

- [ ] **Step 2: Run the integration test and confirm failure**

Run: `cd quant-worker; python -m pytest tests/test_smart_insights_gold_pipeline_integration.py -q`

Expected: FAIL because `gold_pipeline` is absent.

- [ ] **Step 3: Implement transactional idempotent publication**

Within one repository transaction: acquire `smart-insights:gold:<effective-date>` lease, collect due enabled sources, retain last known-good observations on provider failure, publish accepted candidates, load inputs where both `effectiveEnd <= as_of.date()` and `observedAt <= as_of`, calculate metrics/regime/signals, upsert by deterministic identity, and release the lease. Persist source run status even when one source fails; unrelated market pipelines must not roll back.

- [ ] **Step 4: Register exact jobs and bounded live-smoke commands**

Add CLI targets:

```text
python collect_smart_insights.py collect --source wgc-gold-etf --as-of <ISO-8601>
python collect_smart_insights.py collect --source wgc-central-bank --as-of <ISO-8601>
python collect_smart_insights.py calculate --market gold --as-of <ISO-8601>
python collect_smart_insights.py smoke --source wgc-gold-etf --max-bytes 10485760 --timeout-seconds 30
python collect_smart_insights.py smoke --source wgc-central-bank --max-bytes 10485760 --timeout-seconds 30
```

Keep each `wgc-*` source disabled until its own smoke returns an allow-listed final landing/download URL, HTTP success, accepted parser version, at least one valid row, and no schema drift. XAU price calculation runs after daily market-data close; WGC and CFTC run only when their source periods are due.

- [ ] **Step 5: Run the complete Gold slice**

Run: `cd quant-worker; python -m pytest tests/test_smart_insights_gold_collectors.py tests/test_smart_insights_gold_metrics.py tests/test_smart_insights_gold_pipeline_integration.py -q`

Expected: PASS.

- [ ] **Step 6: Commit the pipeline**

```bash
git add quant-worker/smart_insights/gold_pipeline.py quant-worker/collect_smart_insights.py quant-worker/tests/test_smart_insights_gold_pipeline_integration.py
git commit -m "feat: publish reproducible gold insights"
```

---

## Plan Completion Gate

- [ ] `python -m pytest tests/test_smart_insights_gold_collectors.py tests/test_smart_insights_gold_metrics.py tests/test_smart_insights_gold_pipeline_integration.py -q` passes from `quant-worker`.
- [ ] XAU daily calculations identify their active dataset version and exclude future rows.
- [ ] WGC and CFTC rows preserve source frequency and are not expanded or forward-filled.
- [ ] Correlation/beta outputs report their aligned point count and become unavailable below 60 observations.
- [ ] Gold score uses exact 20/25/20/15/10/10 weights and becomes unavailable below 60% fresh configured-weight coverage.
- [ ] Every enabled Gold source has bounded live-smoke evidence; fixture-only sources remain disabled.
- [ ] `git diff --check` returns no errors.
