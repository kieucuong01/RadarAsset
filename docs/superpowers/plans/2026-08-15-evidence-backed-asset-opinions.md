# Evidence-Backed Asset Opinions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three sample/overlapping Smart Insights surfaces with one fast, evidence-backed asset-opinion experience for portfolio, watchlist, VNINDEX, XAU, and BTC assets.

**Architecture:** The Python worker batch-loads a bounded 25-asset universe, creates point-in-time facts and deterministic quant opinions, then optionally asks AI to explain only the locked evidence bundle. Existing `DailyBriefing`, `DailyBriefingItem`, `SignalSnapshot`, `AiInsight`, and evidence records persist immutable revisions; the Next.js API reads one tenant-scoped briefing snapshot and the browser renders one selected asset's charts at a time.

**Tech Stack:** Python 3.11+, psycopg 3, pytest, PostgreSQL/Prisma 7.8, Next.js 16, React 19, TypeScript 5.8, Zod 4, Vitest, Recharts, Playwright.

## Global Constraints

- Do not add a database table or migration for this feature.
- Do not add a charting or AI dependency; reuse Recharts and the existing Responses API adapter.
- Asset priority is portfolio weight descending, then watchlist creation order, then VNINDEX/XAU/BTC, capped at 25 after canonical de-duplication.
- Require 60 valid daily bars, three numeric facts, two independent source families, and no stale/quarantined critical input before publishing an actionable opinion.
- An insufficient asset remains visible as `Chưa đủ bằng chứng` and never receives sample or stale AI prose.
- Kronos fields cannot enter the fact sheet, score, confidence, prompt, or personalized action.
- Allowed actions are `HOLD`, `REVIEW_INCREASE`, `REVIEW_REDUCE_RISK`, `WAIT_CONFIRMATION`, and `NO_ACTION_INSUFFICIENT_DATA`.
- AI confidence cannot exceed the deterministic data-confidence ceiling; unsupported numbers, evidence IDs, units, assets, dates, or trade language reject the entire AI explanation.
- The page uses one `/api/smart-insights/briefing` request for this block and no per-asset request.
- Batch query count must remain constant from 1 to 25 assets and may not exceed the measured baseline plus two queries.
- Maximum briefing size is 250 KB uncompressed and 75 KB gzip.
- Warm snapshot API server-processing p95 target is 200 ms; mobile LCP is at most 2.5 s, INP at most 200 ms, and CLS at most 0.1.
- No measured endpoint, interaction, or Web Vital may regress more than 10% from the recorded baseline.
- Preserve unrelated dirty work and stage only files listed by the current task.

---

## File Structure

### New worker files

- `quant-worker/smart_insights/asset_opinion_contracts.py`: immutable inputs, gate results, pillar scores, quant opinions, AI results, and persistence payloads.
- `quant-worker/smart_insights/asset_opinion_quant.py`: canonical universe, market-bar facts, data gate, pillar aggregation, stance, confidence, and bounded personalized action.
- `quant-worker/smart_insights/asset_opinion_repository.py`: the two bounded batch queries for bars and specialized evidence; no query-per-asset loops.
- `quant-worker/smart_insights/asset_opinion_pipeline.py`: per-user orchestration, per-asset failure isolation, AI invocation, grounding, and draft construction.

### New web files

- `src/components/smart-insights/AssetOpinions.tsx`: selection state and section-level loading/empty rendering.
- `src/components/smart-insights/AssetOpinionList.tsx`: desktop table and mobile stacked cards.
- `src/components/smart-insights/AssetOpinionDetail.tsx`: selected-asset thesis, compact charts, scenarios, invalidations, and evidence table.
- `src/components/smart-insights/AssetOpinions.test.tsx`: static rendering contracts for actionable, quant-only, and insufficient states.
- `e2e/smart-insights-asset-opinions.spec.ts`: authenticated desktop/mobile request and overflow verification.

### Existing files to modify

- `quant-worker/smart_insights/briefing_pipeline.py`: include asset-opinion drafts in the immutable briefing transaction and fingerprint.
- `quant-worker/smart_insights/openai_responses.py`: add a separate strict asset-opinion output schema and synthesizer while retaining the existing briefing schema.
- `quant-worker/smart_insights/grounding.py`: verify the new thesis/scenario/invalidation fields and new action allow-list.
- `quant-worker/collect_smart_insights.py`: run asset-opinion generation inside the existing briefing schedules.
- `src/lib/backend/smart-insights-types.ts`: add the server read model.
- `src/lib/backend/smart-insights.ts`: map stored asset-opinion items in the existing batched briefing query.
- `src/lib/smart-insights-client.ts`: add the Zod client contract.
- `src/app/api/smart-insights/briefing/route.ts`: private ETag handling for immutable revisions.
- `src/components/SmartInsights.tsx`: render the merged block and remove the three obsolete UI/request sources.
- `src/components/smart-insights/source-guard.test.ts`: assert the new block and absence of obsolete renders/sample fallbacks.
- `src/lib/i18n/dictionary.ts`: add Vietnamese/English copy for the new section and state/action labels.

### Performance and verification files

- `scripts/benchmark-smart-insights.mjs`: bounded authenticated endpoint benchmark and payload budget check.
- `scripts/benchmark-smart-insights.test.mjs`: percentile and budget unit tests.
- `docs/verification/2026-08-15-asset-opinion-performance-baseline.md`: reproducible baseline and final comparison table.

---

### Task 1: Record the Performance Baseline

**Files:**
- Create: `scripts/benchmark-smart-insights.mjs`
- Create: `scripts/benchmark-smart-insights.test.mjs`
- Create: `docs/verification/2026-08-15-asset-opinion-performance-baseline.md`

**Interfaces:**
- Consumes: `SMART_INSIGHTS_BENCH_URL`, optional `SMART_INSIGHTS_BENCH_COOKIE`, and an immutable local briefing.
- Produces: `percentile(values: number[], quantile: number): number` and JSON output containing `p50Ms`, `p95Ms`, `bytes`, and `gzipBytes`.

- [ ] **Step 1: Write the failing percentile and budget tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { assertBudgets, percentile } from "./benchmark-smart-insights.mjs";

test("percentile uses the nearest-rank sample", () => {
  assert.equal(percentile([10, 20, 30, 40, 50], 0.95), 50);
});

test("briefing budget rejects latency and payload overflow", () => {
  assert.throws(() =>
    assertBudgets({ p95Ms: 201, bytes: 250_001, gzipBytes: 75_001 }),
  );
});
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run: `node --test scripts/benchmark-smart-insights.test.mjs`

Expected: FAIL because `benchmark-smart-insights.mjs` does not exist.

- [ ] **Step 3: Implement the bounded benchmark**

```js
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

export function percentile(values, quantile) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * quantile) - 1)];
}

export function assertBudgets(result) {
  const failures = [];
  if (result.p95Ms > 200) failures.push(`p95 ${result.p95Ms}ms > 200ms`);
  if (result.bytes > 250_000) failures.push(`payload ${result.bytes} > 250000`);
  if (result.gzipBytes > 75_000) failures.push(`gzip ${result.gzipBytes} > 75000`);
  if (failures.length) throw new Error(failures.join(", "));
}

export async function benchmark({ url, cookie, iterations = 20 }) {
  const samples = [];
  let body = "";
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    const response = await fetch(url, {
      headers: cookie ? { Cookie: cookie, Accept: "application/json" } : { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`benchmark HTTP ${response.status}`);
    body = await response.text();
    samples.push(performance.now() - started);
  }
  const result = {
    p50Ms: Math.round(percentile(samples, 0.5)),
    p95Ms: Math.round(percentile(samples, 0.95)),
    bytes: Buffer.byteLength(body),
    gzipBytes: gzipSync(body).byteLength,
  };
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.SMART_INSIGHTS_BENCH_URL;
  if (!url) throw new Error("SMART_INSIGHTS_BENCH_URL is required");
  const result = await benchmark({
    url,
    cookie: process.env.SMART_INSIGHTS_BENCH_COOKIE,
    iterations: 20,
  });
  console.log(JSON.stringify(result));
  if (process.env.SMART_INSIGHTS_BENCH_ENFORCE === "1") assertBudgets(result);
}
```

The executable branch reads the URL/cookie from environment variables, never prints the cookie, runs
20 iterations, and prints only the result JSON. Task 1 records without enforcing so a pre-existing
gap is evidence; Task 10 sets `SMART_INSIGHTS_BENCH_ENFORCE=1`.

- [ ] **Step 4: Run the unit test**

Run: `node --test scripts/benchmark-smart-insights.test.mjs`

Expected: PASS.

- [ ] **Step 5: Capture the current baseline**

Run against the already-running authenticated local app:

```powershell
$env:SMART_INSIGHTS_BENCH_URL="http://localhost:3120/api/smart-insights/briefing"
$env:SMART_INSIGHTS_BENCH_COOKIE=Read-Host "Paste the authenticated Cookie request header"
node scripts/benchmark-smart-insights.mjs
```

Record date, commit SHA, Node version, database size, briefing asset count, p50/p95, raw/gzip bytes,
the Smart Insights browser request list, initial JS transfer, and mobile LCP/INP/CLS in the baseline
document. Write `not captured` only when the metric cannot be obtained and include the exact command
or environment blocker; do not manufacture a value.

- [ ] **Step 6: Commit the baseline tooling and evidence**

```powershell
git add scripts/benchmark-smart-insights.mjs scripts/benchmark-smart-insights.test.mjs docs/verification/2026-08-15-asset-opinion-performance-baseline.md
git commit -m "test: baseline Smart Insights performance"
```

---

### Task 2: Define the Asset Universe and Immutable Contracts

**Files:**
- Create: `quant-worker/smart_insights/asset_opinion_contracts.py`
- Create: `quant-worker/smart_insights/asset_opinion_quant.py`
- Create: `quant-worker/tests/test_asset_opinion_universe.py`

**Interfaces:**
- Consumes: canonical portfolio and watchlist candidates returned by the repository.
- Produces: `build_asset_universe(portfolio, watchlist, representatives, limit=25) -> UniverseResult`.

- [ ] **Step 1: Write failing universe tests**

```python
from decimal import Decimal

from smart_insights.asset_opinion_contracts import AssetCandidate
from smart_insights.asset_opinion_quant import build_asset_universe


def test_universe_prioritizes_portfolio_then_watchlist_then_representatives() -> None:
    portfolio = (
        AssetCandidate("ETH", "Ethereum", "crypto", Decimal("0.20"), 0),
        AssetCandidate("BTC", "Bitcoin", "crypto", Decimal("0.60"), 0),
    )
    watchlist = (
        AssetCandidate("GOLD", "Gold alias", "gold", Decimal("0"), 1),
        AssetCandidate("SOL", "Solana", "crypto", Decimal("0"), 2),
    )
    result = build_asset_universe(portfolio, watchlist, ("VNINDEX", "XAU", "BTC"), limit=5)
    assert tuple(row.symbol for row in result.assets) == ("BTC", "ETH", "XAU", "SOL", "VNINDEX")


def test_universe_caps_at_25_and_reports_excluded_representatives() -> None:
    portfolio = tuple(
        AssetCandidate(f"A{index:02d}", f"Asset {index}", "equity", Decimal("0.04"), 0)
        for index in range(25)
    )
    result = build_asset_universe(portfolio, (), ("VNINDEX", "XAU", "BTC"), limit=25)
    assert len(result.assets) == 25
    assert result.excluded_representatives == ("VNINDEX", "XAU", "BTC")
```

- [ ] **Step 2: Run the focused test**

Run from `quant-worker`: `python -m pytest tests/test_asset_opinion_universe.py -q`

Expected: FAIL because the contracts and universe builder do not exist.

- [ ] **Step 3: Implement immutable contracts**

Create frozen, slotted dataclasses for:

```python
@dataclass(frozen=True, slots=True)
class AssetCandidate:
    symbol: str
    name: str
    market: str
    portfolio_weight: Decimal
    watchlist_rank: int
    quantity: Decimal = Decimal("0")
    average_cost: Decimal | None = None


@dataclass(frozen=True, slots=True)
class UniverseResult:
    assets: tuple[AssetCandidate, ...]
    excluded_representatives: tuple[str, ...]
```

Also define `MarketBar`, `QuantFact`, `DataGateResult`, `PillarScore`, `QuantAssetOpinion`,
`AssetOpinionAiOutput`, `AssetOpinionGroundingAccepted`, and `AssetOpinionDraft`. Every timestamp field must be timezone-aware in
`__post_init__`; every score/confidence must be finite and inside its declared range.

Use these exact field contracts:

```python
@dataclass(frozen=True, slots=True)
class MarketBar:
    id: str
    symbol: str
    ts: datetime
    close: Decimal
    observed_at: datetime


@dataclass(frozen=True, slots=True)
class QuantFact:
    id: str
    metric_code: str
    value: Decimal
    unit: str
    effective_at: datetime
    observed_at: datetime
    source_family: str
    source_code: str
    source_url: str
    signed_score: Decimal | None
    confidence: Decimal
    fresh: bool
    critical: bool
    methodology_version: str
    underlying_ids: tuple[str, ...] = ()
```

`DataGateResult` has `passed`, `failed_gates`, `source_families`, and `numeric_fact_count`.
`PillarScore` has `code`, `score`, `configured_weight`, `confidence`, and `fact_ids`.
`QuantAssetOpinion` has asset identity, stance/score/confidence, gate, pillars, facts, weight, action,
horizon, freshness, and methodology version. `AssetOpinionDraft` adds evidence bundle, accepted AI
output or null, and one of `accepted`, `quant_only`, `insufficient_data`, or `unavailable`.

- [ ] **Step 4: Implement canonical de-duplication and ordering**

In `asset_opinion_quant.py`, use this alias boundary and stable priority:

```python
ALIASES = {"GOLD": "XAU", "XAUUSD": "XAU", "BTCUSD": "BTC", "BTCUSDT": "BTC"}


def canonical_symbol(symbol: str) -> str:
    normalized = symbol.strip().upper()
    return ALIASES.get(normalized, normalized)
```

Portfolio rows sort by negative absolute weight and symbol. Watchlist rows retain creation rank.
Representatives append last. The first canonical candidate wins and exclusions are explicit.

- [ ] **Step 5: Run tests and commit**

Run: `python -m pytest tests/test_asset_opinion_universe.py -q`

Expected: PASS.

```powershell
git add quant-worker/smart_insights/asset_opinion_contracts.py quant-worker/smart_insights/asset_opinion_quant.py quant-worker/tests/test_asset_opinion_universe.py
git commit -m "feat: define asset opinion universe"
```

---

### Task 3: Build Point-in-Time Facts, Gates, Scores, and Actions

**Files:**
- Modify: `quant-worker/smart_insights/asset_opinion_quant.py`
- Create: `quant-worker/tests/test_asset_opinion_quant.py`
- Modify: `quant-worker/tests/test_kronos_isolation.py`

**Interfaces:**
- Consumes: `AssetCandidate`, ordered `MarketBar` values, specialized `QuantFact` values, risk tolerance, and `as_of`.
- Produces: `build_quant_opinion(*, asset: AssetCandidate, bars: tuple[MarketBar, ...], specialized: tuple[QuantFact, ...], as_of: datetime, risk_tolerance: str) -> QuantAssetOpinion`.

- [ ] **Step 1: Write failing no-lookahead and gate tests**

Define deterministic helpers at the top of the test file:

```python
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from smart_insights.asset_opinion_contracts import AssetCandidate, MarketBar, QuantFact

NOW = datetime(2026, 8, 15, tzinfo=timezone.utc)


def candidate(symbol: str, weight: str = "0") -> AssetCandidate:
    return AssetCandidate(symbol, symbol, "crypto" if symbol == "BTC" else "gold", Decimal(weight), 0)


def bars(count: int, symbol: str = "BTC") -> tuple[MarketBar, ...]:
    return tuple(
        MarketBar(f"bar-{index}", symbol, NOW - timedelta(days=count - index), Decimal(100 + index), NOW - timedelta(days=count - index))
        for index in range(count)
    )


def rising_bars(count: int) -> tuple[MarketBar, ...]:
    return bars(count)


def future_bar() -> MarketBar:
    return MarketBar("future", "BTC", NOW + timedelta(days=1), Decimal("999"), NOW + timedelta(days=1))


def fact(metric: str, source: str, *, fresh: bool = True, critical: bool = False, score: str = "40") -> QuantFact:
    return QuantFact(
        f"fact-{metric}", metric, Decimal("1"), "RATIO", NOW, NOW, source, source,
        f"https://example.test/{source}", Decimal(score), Decimal("80"), fresh, critical,
        "asset-opinion-facts-v1",
    )


def supportive_crypto_facts() -> tuple[QuantFact, ...]:
    return (
        fact("crypto.etf_flow", "farside", score="70"),
        fact("crypto.fear_greed", "alternative-fng", score="40"),
        fact("macro.risk", "fred", score="30"),
    )
```

```python
def test_fact_sheet_ignores_future_and_requires_two_source_families() -> None:
    opinion = build_quant_opinion(
        asset=candidate("BTC"),
        bars=bars(61) + (future_bar(),),
        specialized=(fact("crypto.etf_flow", "farside", fresh=True),),
        as_of=NOW,
        risk_tolerance="moderate",
    )
    assert all(row.effective_at <= NOW for row in opinion.facts)
    assert opinion.gate.passed is True
    assert set(opinion.gate.source_families) == {"market_bars", "farside"}


def test_gate_fails_closed_without_history_or_fresh_critical_fact() -> None:
    short = build_quant_opinion(
        asset=candidate("XAU"), bars=bars(59, "XAU"), specialized=(), as_of=NOW, risk_tolerance="moderate"
    )
    stale = build_quant_opinion(
        asset=candidate("XAU"),
        bars=bars(80, "XAU"),
        specialized=(fact("macro.real_yield", "fred", fresh=False, critical=True),),
        as_of=NOW,
        risk_tolerance="moderate",
    )
    assert short.stance == "INSUFFICIENT_DATA"
    assert "MINIMUM_60_DAILY_BARS" in short.gate.failed_gates
    assert "CRITICAL_INPUT_STALE" in stale.gate.failed_gates
    assert stale.personalized_action == "NO_ACTION_INSUFFICIENT_DATA"
```

- [ ] **Step 2: Write failing deterministic scoring/action tests**

```python
def test_concentrated_positive_position_still_reviews_risk() -> None:
    opinion = build_quant_opinion(
        candidate("BTC", weight="0.31"),
        rising_bars(220),
        supportive_crypto_facts(),
        NOW,
        "moderate",
    )
    assert opinion.stance in {"CONSTRUCTIVE", "POSITIVE"}
    assert opinion.personalized_action == "REVIEW_REDUCE_RISK"


def test_same_inputs_produce_identical_opinion() -> None:
    first = build_quant_opinion(
        asset=candidate("BTC"), bars=rising_bars(220), specialized=supportive_crypto_facts(),
        as_of=NOW, risk_tolerance="moderate",
    )
    second = build_quant_opinion(
        asset=candidate("BTC"), bars=rising_bars(220), specialized=supportive_crypto_facts(),
        as_of=NOW, risk_tolerance="moderate",
    )
    assert first == second
```

- [ ] **Step 3: Run tests and confirm failure**

Run: `python -m pytest tests/test_asset_opinion_quant.py tests/test_kronos_isolation.py -q`

Expected: FAIL because fact construction and scoring are absent.

- [ ] **Step 4: Implement common facts**

Use closed bars at or before `as_of`. Calculate 1/5/20/60-day return, MA20/50/200 position when
enough history exists, 20-day annualized realized volatility, current drawdown, and historical
percentiles. Calculate benchmark-relative 20-day return when the matching benchmark bars are present.
For a held asset, calculate unrealized return from latest close and average cost and expose current
weight/concentration; never create P&L when cost basis is absent. Derived facts use source family
`market_bars`, carry underlying bar IDs, and use methodology `asset-opinion-facts-v1`.
Use the existing market-calendar helpers to compare VN/XAU bars with the latest completed trading
session; use the latest closed UTC day with a 36-hour allowance for crypto. A weekend or exchange
holiday is not itself a stale bar.

```python
def trailing_return(closes: tuple[Decimal, ...], days: int) -> Decimal | None:
    if len(closes) <= days or closes[-days - 1] == 0:
        return None
    return closes[-1] / closes[-days - 1] - Decimal("1")
```

- [ ] **Step 5: Implement the gate and pillar aggregation**

Map existing metric families deterministically:

```python
PILLAR_PREFIXES = {
    "flow_liquidity": (
        "crypto.etf.", "crypto.coinshares.", "crypto.stablecoin.", "crypto.defi.",
        "gold.cftc.", "equity.liquidity.", "equity.foreign_flow.",
    ),
    "macro": ("macro.",),
    "relative_value": ("equity.valuation.", "gold.relative_value."),
    "sentiment_onchain": (
        "crypto.fear_greed.", "crypto.derivatives.", "crypto.onchain.",
        "crypto.network.", "crypto.large_address.",
    ),
}
```

Only metric codes already registered and returned by the batch repository can contribute. Unknown
prefixes remain visible evidence but have zero configured score weight until a methodology version
explicitly maps them.

The configured weights are:

```python
PILLAR_WEIGHTS = {
    "trend": Decimal("0.40"),
    "flow_liquidity": Decimal("0.20"),
    "macro": Decimal("0.15"),
    "relative_value": Decimal("0.10"),
    "sentiment_onchain": Decimal("0.15"),
}
```

Aggregate only fresh valid pillar scores, but publish a stance only at 60% configured-weight
coverage. Map the weighted `[-100, 100]` result to `NEGATIVE` at `<= -40`, `CAUTIOUS` at `<= -15`,
`NEUTRAL` below `15`, `CONSTRUCTIVE` below `40`, and `POSITIVE` otherwise. Confidence is the
weighted source confidence multiplied by configured-weight coverage and capped at 100.

- [ ] **Step 6: Implement bounded personalized actions**

Use concentration limits of 15% conservative, 25% moderate, and 35% aggressive. The deterministic
order is: failed gate → `NO_ACTION_INSUFFICIENT_DATA`; concentration above limit →
`REVIEW_REDUCE_RISK`; unresolved contradiction/event risk → `WAIT_CONFIRMATION`; constructive or
positive underweight/watched asset → `REVIEW_INCREASE`; otherwise → `HOLD`.

- [ ] **Step 7: Extend Kronos isolation assertions**

Assert `asset_opinion_quant.py`, `asset_opinion_pipeline.py`, and serialized signal inputs reject any
fact whose metric code starts with `kronos.` or whose methodology contains `kronos`.

- [ ] **Step 8: Run tests and commit**

Run: `python -m pytest tests/test_asset_opinion_quant.py tests/test_kronos_isolation.py -q`

Expected: PASS.

```powershell
git add quant-worker/smart_insights/asset_opinion_quant.py quant-worker/tests/test_asset_opinion_quant.py quant-worker/tests/test_kronos_isolation.py
git commit -m "feat: score evidence-backed asset opinions"
```

---

### Task 4: Batch-Load 1–25 Assets Without N+1 Queries

**Files:**
- Create: `quant-worker/smart_insights/asset_opinion_repository.py`
- Modify: `quant-worker/smart_insights/briefing_pipeline.py`
- Modify: `quant-worker/smart_insights/personalization.py`
- Create: `quant-worker/tests/test_asset_opinion_repository.py`
- Modify: `quant-worker/tests/test_smart_insights_briefing_pipeline_integration.py`

**Interfaces:**
- Consumes: canonical opinion symbols, benchmark symbols, `as_of`, and the existing psycopg connection.
- Produces: `load_asset_opinion_market_data(connection: psycopg.Connection[object], symbols: tuple[str, ...], benchmark_symbols: tuple[str, ...], as_of: datetime) -> AssetOpinionMarketData` using exactly two SQL executions regardless of symbol count.

- [ ] **Step 1: Write a failing constant-query-count test**

```python
def test_batch_loader_uses_two_queries_for_one_or_twenty_five_assets() -> None:
    one = CountingConnection(fixtures())
    many = CountingConnection(fixtures())
    load_asset_opinion_market_data(one, ("BTC",), ("BTC",), NOW)
    load_asset_opinion_market_data(many, tuple(f"A{index}" for index in range(25)), ("VNINDEX",), NOW)
    assert one.execute_count == 2
    assert many.execute_count == 2
```

- [ ] **Step 2: Run the focused test**

Run: `python -m pytest tests/test_asset_opinion_repository.py -q`

Expected: FAIL because the loader does not exist.

- [ ] **Step 3: Implement one ranked bar query**

Use `ROW_NUMBER() OVER (PARTITION BY asset.symbol ORDER BY bar.ts DESC)` across the de-duplicated union
of opinion and benchmark symbols, then filter `row_number <= 260`. Enforce active, passed/warning
dataset versions and `published_at`, `bar.ts`, and `ingested_at` at or before `as_of`. Return rows
ordered by symbol and timestamp ascending.

- [ ] **Step 4: Implement one specialized-fact query**

Select the latest valid revision per natural key for all requested assets plus global BTC/XAU/VNINDEX
drivers. Join metric definition direction, provider, raw snapshot, and asset. Enforce observed/effective
times at or before `as_of`, validated snapshots, and passed/warning observations. Limit the bounded
result to 2,000 rows and reject a larger result rather than making another query.

- [ ] **Step 5: Enrich existing portfolio rows without another query**

Modify the first query in `PostgresBriefingRepository.load_personalization` to return aggregate
quantity, cost basis, and average cost together with weight. Extend `PortfolioPosition` with optional
fields defaulting to zero/null so existing relevance tests remain compatible.

- [ ] **Step 6: Run repository and briefing regression tests**

Run:

```powershell
python -m pytest tests/test_asset_opinion_repository.py tests/test_smart_insights_briefing_pipeline_integration.py tests/test_smart_insights_personalization.py -q
```

Expected: PASS with constant query count.

- [ ] **Step 7: Commit**

```powershell
git add quant-worker/smart_insights/asset_opinion_repository.py quant-worker/smart_insights/briefing_pipeline.py quant-worker/smart_insights/personalization.py quant-worker/tests/test_asset_opinion_repository.py quant-worker/tests/test_smart_insights_briefing_pipeline_integration.py quant-worker/tests/test_smart_insights_personalization.py
git commit -m "perf: batch asset opinion evidence"
```

---

### Task 5: Add Strict Asset-Opinion AI and Grounding

**Files:**
- Modify: `quant-worker/smart_insights/openai_responses.py`
- Modify: `quant-worker/smart_insights/grounding.py`
- Create: `quant-worker/tests/test_asset_opinion_ai.py`
- Modify: `quant-worker/tests/test_smart_insights_grounding.py`

**Interfaces:**
- Consumes: one `EvidenceBundle`, deterministic stance/action, portfolio context, locale, model, and API key.
- Produces: `synthesize_asset_opinion(bundle: EvidenceBundle, *, deterministic_action: str, locale: str, model: str | None, api_key: str | None, transport: JsonTransport | None = None, timeout_seconds: int = 30) -> AssetOpinionAiOutput | AiUnavailable | AiSchemaError` and `verify_asset_opinion(output: AssetOpinionAiOutput, bundle: EvidenceBundle, deterministic_action: str) -> AssetOpinionGroundingAccepted | GroundingRejected`.

- [ ] **Step 1: Write failing strict-schema tests**

Define `valid_payload()` in the test file with exactly these keys:

```python
def valid_payload() -> dict[str, object]:
    return {
        "thesis": "BTC giữ xu hướng định lượng tích cực.",
        "bull_case": "Dòng tiền 1.00 tiếp tục hỗ trợ BTC.",
        "base_case": "Theo dõi xác nhận từ dòng tiền 1.00.",
        "bear_case": "Luận điểm yếu đi nếu dòng tiền 1.00 đảo chiều.",
        "invalidation_conditions": ["Dòng tiền 1.00 không còn hiệu lực."],
        "supporting_evidence_ids": ["e1"],
        "contradicting_evidence_ids": [],
        "affected_assets": ["BTC"],
        "time_horizon": "WEEKS_1_4",
        "personalized_action": "HOLD",
        "confidence": 60,
    }
```

```python
def test_asset_opinion_schema_contains_three_scenarios_and_invalidations() -> None:
    result = parse_asset_opinion_output(valid_payload())
    assert result.bull_case
    assert result.base_case
    assert result.bear_case
    assert result.invalidation_conditions
    assert result.personalized_action == "HOLD"


def test_asset_opinion_parser_rejects_extra_fields_and_unknown_action() -> None:
    assert isinstance(parse_asset_opinion_output({**valid_payload(), "extra": True}), AiSchemaError)
    assert isinstance(parse_asset_opinion_output({**valid_payload(), "personalized_action": "BUY"}), AiSchemaError)
```

- [ ] **Step 2: Write failing grounding tests**

Define `valid_output()` as `AssetOpinionAiOutput` parsed from `valid_payload()`. Define `bundle()` with
one BTC `EvidenceFact` whose ID is `e1`, display value is `1.00`, source is
`https://example.test/farside`, data-confidence ceiling is 75, and no contradictions. Define
`bundle_with_contradiction()` by adding evidence ID `e2` to `contradicting_evidence_ids`.

```python
def test_asset_opinion_grounding_rejects_numbers_and_trade_language_in_any_field() -> None:
    unsupported = replace(valid_output(), bull_case="BTC rises 99%.")
    action = replace(valid_output(), invalidation_conditions=("Mua ngay BTC",))
    assert verify_asset_opinion(unsupported, bundle(), "HOLD").reason_code == "UNSUPPORTED_NUMBER"
    assert verify_asset_opinion(action, bundle(), "HOLD").reason_code == "DISALLOWED_ACTION"


def test_confidence_and_contradictions_remain_fail_closed() -> None:
    assert verify_asset_opinion(replace(valid_output(), confidence=90), bundle(), "HOLD").reason_code == "CONFIDENCE_EXCEEDS_DATA"
    assert verify_asset_opinion(replace(valid_output(), confidence=70), bundle_with_contradiction(), "HOLD").reason_code == "CONTRADICTION_OMITTED"
```

- [ ] **Step 3: Run the AI/grounding tests**

Run: `python -m pytest tests/test_asset_opinion_ai.py tests/test_smart_insights_grounding.py -q`

Expected: FAIL because the asset-opinion schema is absent.

- [ ] **Step 4: Add a separate strict output schema**

Required fields are `thesis`, `bull_case`, `base_case`, `bear_case`, `invalidation_conditions`,
`supporting_evidence_ids`, `contradicting_evidence_ids`, `affected_assets`, `time_horizon`,
`personalized_action`, and `confidence`. Set `additionalProperties: false`, cap each prose field at
700 characters, invalidations at three items/280 characters, and affected assets at exactly one.

- [ ] **Step 5: Add the evidence-only prompt and fakeable transport path**

The prompt states that the deterministic stance and action cannot be changed, every displayed number
must be copied from evidence, and no browsing/calculation/order/sizing/guarantee is allowed. Reuse
`JsonTransport`, two-attempt retry behavior, `store: false`, and the existing configured endpoint.

- [ ] **Step 6: Verify every prose field through one shared validator**

Concatenate thesis, all three cases, and invalidations for number/action checks. Require output action
to equal the deterministic action passed to the verifier and output affected asset to equal the
single bundle asset.

- [ ] **Step 7: Run tests and commit**

Run:

```powershell
python -m pytest tests/test_asset_opinion_ai.py tests/test_smart_insights_grounding.py tests/test_smart_insights_openai_responses.py -q
```

Expected: PASS and existing briefing AI contracts remain unchanged.

```powershell
git add quant-worker/smart_insights/openai_responses.py quant-worker/smart_insights/grounding.py quant-worker/tests/test_asset_opinion_ai.py quant-worker/tests/test_smart_insights_grounding.py
git commit -m "feat: ground asset opinion explanations"
```

---

### Task 6: Generate and Persist Asset Opinions in the Daily Briefing

**Files:**
- Create: `quant-worker/smart_insights/asset_opinion_pipeline.py`
- Modify: `quant-worker/smart_insights/briefing_pipeline.py`
- Modify: `quant-worker/collect_smart_insights.py`
- Create: `quant-worker/tests/test_asset_opinion_pipeline.py`
- Modify: `quant-worker/tests/test_smart_insights_briefing_pipeline_integration.py`
- Modify: `quant-worker/tests/test_smart_insights_repository_integration.py`

**Interfaces:**
- Consumes: current signals, personalization, two-query market data, AI synthesizer, and briefing `as_of`.
- Produces: `build_asset_opinion_drafts(inputs: AssetOpinionBatch, *, synthesizer: AssetOpinionSynthesizer = synthesize_asset_opinion, build_quant: QuantBuilder = build_quant_opinion) -> tuple[AssetOpinionDraft, ...]`.

`AssetOpinionBatch` contains `universe`, `bars_by_symbol`, `facts_by_symbol`, `preferences`, `as_of`,
and `organization_id`. `AssetOpinionSynthesizer` consumes an evidence bundle plus deterministic
action/locale/model/key settings. `QuantBuilder` has the exact Task 3 signature.

- [ ] **Step 1: Write failing pipeline isolation tests**

```python
def test_one_asset_failure_does_not_drop_other_opinions() -> None:
    drafts = build_asset_opinion_drafts(
        inputs=batch_with_btc_xau(),
        build_quant=fails_only_for("XAU"),
        synthesizer=fake_ai,
    )
    assert tuple(row.symbol for row in drafts) == ("BTC", "XAU")
    assert drafts[0].explanation_status == "accepted"
    assert drafts[1].explanation_status == "unavailable"


def test_failed_gate_skips_ai_and_never_reuses_old_text() -> None:
    synthesizer = SpySynthesizer()
    draft = build_asset_opinion_drafts(insufficient_batch(), synthesizer=synthesizer)[0]
    assert synthesizer.calls == 0
    assert draft.ai_output is None
    assert draft.quant.personalized_action == "NO_ACTION_INSUFFICIENT_DATA"
```

The test file defines `batch_with_btc_xau()` and `insufficient_batch()` by constructing
`AssetOpinionBatch` with the Task 2 BTC/XAU candidates and Task 3 bar/fact helpers. `fails_only_for`
delegates to `build_quant_opinion` except when `asset.symbol` matches its argument, where it raises
`ValueError("fixture failure")`. `SpySynthesizer.__call__` increments `calls` and returns the valid
Task 5 output.

- [ ] **Step 2: Write failing persistence assertions**

Assert one `DailyBriefingItem(section="asset_opinion")` per symbol, one matching asset-specific
`SignalSnapshot`, exactly one `affectedAssets` symbol, quant-only `aiInsightId = null`, and no
`kronos` key anywhere in `SignalSnapshot.inputs`.

- [ ] **Step 3: Run pipeline tests**

Run:

```powershell
python -m pytest tests/test_asset_opinion_pipeline.py tests/test_smart_insights_briefing_pipeline_integration.py tests/test_smart_insights_repository_integration.py -q
```

Expected: FAIL before integration exists.

- [ ] **Step 4: Implement bounded orchestration**

Build the universe once, load all market data once, then process each in a bounded loop. The loop may
perform CPU work and AI calls but may not execute SQL. Use the configured `SMART_INSIGHTS_AI_MAX_CONCURRENCY`
clamped to 1–4 when parallelizing AI; preserve universe order in the returned tuple.

- [ ] **Step 5: Extend the immutable draft and fingerprint**

Add `asset_opinions: tuple[AssetOpinionDraft, ...]` to `BriefingDraft`. Include canonical symbol,
quant methodology, gate, pillar scores, evidence-bundle fingerprint, AI status/output, and action in
the canonical briefing fingerprint.

- [ ] **Step 6: Persist using existing models inside the current transaction**

For each opinion:

- insert/idempotently resolve an asset-specific `SignalSnapshot` with `signalType="asset_opinion"`;
- store quant score/stance and versioned pillars/gate/facts in `inputs`;
- insert evidence records from the bundle;
- when accepted, map thesis → `AiInsight.title`, base case → `summary`, bull case → `catalyst`, and a
  canonical JSON object containing bear case and invalidations → `risk`;
- insert `DailyBriefingItem` after primary/risk ranks with `section="asset_opinion"` and exactly one
  affected symbol.

- [ ] **Step 7: Invoke opinions from briefing schedules**

Both `briefing` and `briefing-refresh` use the enhanced `generate_briefing`. `replay` reads the frozen
revision and never reruns quant or AI.

- [ ] **Step 8: Run worker regression tests and commit**

Run:

```powershell
python -m pytest tests/test_asset_opinion_pipeline.py tests/test_smart_insights_briefing_pipeline_integration.py tests/test_smart_insights_repository_integration.py tests/test_smart_insights_foundation.py -q
```

Expected: PASS.

```powershell
git add quant-worker/smart_insights/asset_opinion_pipeline.py quant-worker/smart_insights/briefing_pipeline.py quant-worker/collect_smart_insights.py quant-worker/tests/test_asset_opinion_pipeline.py quant-worker/tests/test_smart_insights_briefing_pipeline_integration.py quant-worker/tests/test_smart_insights_repository_integration.py
git commit -m "feat: publish daily asset opinions"
```

---

### Task 7: Extend the One-Request Briefing API

**Files:**
- Modify: `src/lib/backend/smart-insights-types.ts`
- Modify: `src/lib/backend/smart-insights.ts`
- Modify: `src/lib/backend/smart-insights.test.ts`
- Modify: `src/lib/smart-insights-client.ts`
- Create: `src/lib/smart-insights-client.test.ts`
- Modify: `src/app/api/smart-insights/briefing/route.ts`
- Modify: `src/app/api/tenant-routes.test.ts`

**Interfaces:**
- Consumes: `DailyBriefingItem(section="asset_opinion")` joined to asset, signal inputs, AI insight, and evidence.
- Produces: `BriefingReadModel.assetOpinions: AssetOpinionReadModel[]` and a private ETag-capable route.

- [ ] **Step 1: Write the failing Zod contract test**

Use this complete opinion shape in `fixtureBriefing()`:

```typescript
const baseOpinion = {
  symbol: "BTC",
  assetName: "Bitcoin",
  stance: "CONSTRUCTIVE" as const,
  quantScore: "32.50",
  confidence: "72.00",
  horizon: "WEEKS_1_4" as const,
  portfolioWeightPct: "18.00",
  personalizedAction: "HOLD" as const,
  pillars: [{
    code: "trend",
    score: "45.00",
    weight: "0.40",
    confidence: "80.00",
    factIds: ["e1"],
    series: [{ ts: "2026-08-15T00:00:00Z", value: 45 }],
  }],
  thesis: "Xu hướng BTC đang mang tính xây dựng.",
  bullCase: "Dòng tiền 1.00 tiếp tục hỗ trợ.",
  baseCase: "Theo dõi xác nhận dòng tiền 1.00.",
  bearCase: "Dòng tiền 1.00 đảo chiều.",
  invalidationConditions: ["Dòng tiền 1.00 không còn hiệu lực."],
  evidence: [{
    id: "e1",
    metricCode: "crypto.etf_flow",
    displayValue: "1.00",
    delta: null,
    percentile: null,
    impact: "supporting" as const,
    sourceCode: "farside",
    sourceUrl: "https://example.test/farside",
    effectiveAt: "2026-08-15T00:00:00Z",
    observedAt: "2026-08-15T00:00:00Z",
    freshness: "fresh" as const,
  }],
  dataCoverage: "0.80",
  freshness: "fresh" as const,
  explanationStatus: "accepted" as const,
  failedGates: [] as string[],
};

function fixtureBriefing() {
  return {
    id: "briefing-1",
    localDate: "2026-08-15",
    revision: 1,
    generatedAt: "2026-08-15T01:00:00Z",
    timezone: "Asia/Bangkok",
    status: "complete" as const,
    overallDataConfidence: "72.00",
    portfolioState: "available" as const,
    primary: [],
    riskAlerts: [],
    sourceRunId: "run-1",
    assetOpinions: [
      baseOpinion,
      { ...baseOpinion, symbol: "XAU", explanationStatus: "quant_only" as const, thesis: null },
      {
        ...baseOpinion,
        symbol: "VNINDEX",
        stance: "INSUFFICIENT_DATA" as const,
        personalizedAction: "NO_ACTION_INSUFFICIENT_DATA" as const,
        explanationStatus: "insufficient_data" as const,
        thesis: null,
        failedGates: ["SOURCE_FAMILIES_MINIMUM_2"],
      },
    ],
  };
}
```

```typescript
it("parses actionable, quant-only, and insufficient asset opinions", () => {
  const parsed = briefingSchema.parse(fixtureBriefing());
  expect(parsed.assetOpinions.map((row) => row.explanationStatus)).toEqual([
    "accepted",
    "quant_only",
    "insufficient_data",
  ]);
  expect(parsed.assetOpinions[0].baseCase).toBeTruthy();
});
```

- [ ] **Step 2: Write failing backend mapping and tenant tests**

Assert `loadBriefing` filters asset opinions by the active organization/user through the parent
briefing, maps no ResearchRun parameters/prompt/provider secret, and does not issue a query per item.

- [ ] **Step 3: Run focused web tests**

Run:

```powershell
npm test -- src/lib/smart-insights-client.test.ts src/lib/backend/smart-insights.test.ts src/app/api/tenant-routes.test.ts
```

Expected: FAIL because `assetOpinions` is absent.

- [ ] **Step 4: Add exact read types and Zod schemas**

Define stance/action/status enums, pillar/evidence/gate objects, and the full contract from the spec,
including `bullCase`, `baseCase`, `bearCase`, and invalidations. Decimal database values remain
strings at the API boundary; chart series use finite numbers validated by Zod.

Use the exact pillar and evidence properties shown by `baseOpinion`. `thesis`, all three scenario
fields, and invalidations are nullable/empty for quant-only and insufficient states. A stale or
unavailable opinion cannot claim `explanationStatus: "accepted"`.

- [ ] **Step 5: Extend the existing batched Prisma include**

Select asset `symbol` and `name`, signal `inputs`, and AI `risk` in the existing `items` include. Map
only `section === "asset_opinion"` into `assetOpinions`; keep `primary` and `riskAlerts` for backward
compatibility. Malformed stored JSON becomes an explicit unavailable opinion rather than throwing the
whole briefing response.

- [ ] **Step 6: Add private ETag revalidation**

Add `loadBriefingEnvelope` returning `{ briefing, fingerprint }` while preserving `loadBriefing` for
callers. The route computes `ETag: "<fingerprint>"`, returns 304 on `If-None-Match`, and sets
`Cache-Control: private, no-cache`. The cache key is inherently organization/user/date/revision because
the fingerprint includes those frozen inputs.

- [ ] **Step 7: Run tests and commit**

Run:

```powershell
npm test -- src/lib/smart-insights-client.test.ts src/lib/backend/smart-insights.test.ts src/app/api/tenant-routes.test.ts
```

Expected: PASS.

```powershell
git add src/lib/backend/smart-insights-types.ts src/lib/backend/smart-insights.ts src/lib/backend/smart-insights.test.ts src/lib/smart-insights-client.ts src/lib/smart-insights-client.test.ts src/app/api/smart-insights/briefing/route.ts src/app/api/tenant-routes.test.ts
git commit -m "feat: serve asset opinions in briefing"
```

---

### Task 8: Build the Chart-First Asset Opinion UI

**Files:**
- Create: `src/components/smart-insights/AssetOpinions.tsx`
- Create: `src/components/smart-insights/AssetOpinionList.tsx`
- Create: `src/components/smart-insights/AssetOpinionDetail.tsx`
- Create: `src/components/smart-insights/AssetOpinions.test.tsx`

**Interfaces:**
- Consumes: `AssetOpinionModel[]`, locale, and `onEvidence(id)`.
- Produces: one selected-asset detail, desktop comparison table, mobile cards, and no network calls.

- [ ] **Step 1: Write failing render-state tests**

Define the test fixture builder locally:

```tsx
function opinion(overrides: Partial<AssetOpinionModel> = {}): AssetOpinionModel {
  return {
    symbol: "BTC",
    assetName: "Bitcoin",
    stance: "CONSTRUCTIVE",
    quantScore: "32.50",
    confidence: "72.00",
    horizon: "WEEKS_1_4",
    portfolioWeightPct: "18.00",
    personalizedAction: "HOLD",
    pillars: [{
      code: "trend", score: "45.00", weight: "0.40", confidence: "80.00",
      factIds: ["e1"], series: [{ ts: "2026-08-15T00:00:00Z", value: 45 }],
    }],
    thesis: "Xu hướng BTC đang mang tính xây dựng.",
    bullCase: "Dòng tiền 1.00 tiếp tục hỗ trợ.",
    baseCase: "Theo dõi xác nhận dòng tiền 1.00.",
    bearCase: "Dòng tiền 1.00 đảo chiều.",
    invalidationConditions: ["Dòng tiền 1.00 không còn hiệu lực."],
    evidence: [{
      id: "e1", metricCode: "crypto.etf_flow", displayValue: "1.00", delta: null,
      percentile: null, impact: "supporting", sourceCode: "farside",
      sourceUrl: "https://example.test/farside", effectiveAt: "2026-08-15T00:00:00Z",
      observedAt: "2026-08-15T00:00:00Z", freshness: "fresh",
    }],
    dataCoverage: "0.80",
    freshness: "fresh",
    explanationStatus: "accepted",
    failedGates: [],
    ...overrides,
  };
}

const acceptedBtc = () => opinion();
const quantOnlyXau = () => opinion({ symbol: "XAU", thesis: null, explanationStatus: "quant_only" });
const insufficientVnindex = () => opinion({
  symbol: "VNINDEX",
  stance: "INSUFFICIENT_DATA",
  thesis: null,
  personalizedAction: "NO_ACTION_INSUFFICIENT_DATA",
  explanationStatus: "insufficient_data",
  failedGates: ["SOURCE_FAMILIES_MINIMUM_2"],
});
```

```tsx
it("renders table, mobile cards, three scenarios, and numerical evidence", () => {
  const html = renderToStaticMarkup(
    <AssetOpinions opinions={[acceptedBtc()]} locale="vi" onEvidence={() => undefined} />,
  );
  expect(html).toContain("Quan điểm AI theo tài sản");
  expect(html).toContain("hidden md:block");
  expect(html).toContain("md:hidden");
  expect(html).toContain("Kịch bản cơ sở");
  expect(html).toContain("Nguồn &amp; độ mới");
});

it("shows explicit quant-only and insufficient states without sample prose", () => {
  const html = renderToStaticMarkup(
    <AssetOpinions opinions={[quantOnlyXau(), insufficientVnindex()]} locale="vi" onEvidence={() => undefined} />,
  );
  expect(html).toContain("Chỉ có quan điểm định lượng");
  expect(html).toContain("Chưa đủ bằng chứng");
  expect(html).not.toContain("Dữ liệu mẫu");
});
```

- [ ] **Step 2: Run the focused component test**

Run: `npm test -- src/components/smart-insights/AssetOpinions.test.tsx`

Expected: FAIL because components do not exist.

- [ ] **Step 3: Implement the summary list**

Use semantic table markup on desktop and labeled cards on mobile. Each row/card contains symbol,
stance text and icon, confidence, portfolio weight, at most three key facts, freshness, and the
Vietnamese action label. Selection is a button with `aria-pressed`; no hover-only information.

- [ ] **Step 4: Implement selected-only charts and detail**

Render Recharts only for the selected opinion. Use compact line/bar charts from existing pillar
series; when a series has fewer than two points, show the fact table instead of fabricating history.
Render thesis, portfolio-aware action, bull/base/bear cards, invalidations, and an evidence table with
value, delta, percentile, impact, source, as-of, and freshness. Evidence buttons call `onEvidence`.

- [ ] **Step 5: Preserve layout and accessible states**

Use existing border/background/bull/bear/neutral tokens, reserve chart height to avoid CLS, show text
alongside color, and apply `min-w-0`/overflow containment. No animation duration or continuously moving
content is added.

- [ ] **Step 6: Run tests and commit**

Run: `npm test -- src/components/smart-insights/AssetOpinions.test.tsx`

Expected: PASS.

```powershell
git add src/components/smart-insights/AssetOpinions.tsx src/components/smart-insights/AssetOpinionList.tsx src/components/smart-insights/AssetOpinionDetail.tsx src/components/smart-insights/AssetOpinions.test.tsx
git commit -m "feat: add asset opinion cockpit UI"
```

---

### Task 9: Replace the Obsolete Smart Insights Blocks and Requests

**Files:**
- Modify: `src/components/SmartInsights.tsx`
- Modify: `src/components/smart-insights/source-guard.test.ts`
- Modify: `src/lib/i18n/dictionary.ts`
- Modify: `src/lib/i18n/dictionary.test.ts`

**Interfaces:**
- Consumes: `briefing.assetOpinions` already loaded by the current briefing request.
- Produces: the merged block in the existing page order and zero requests to `/api/research/runs`, `/api/assets/:symbol/intelligence`, or `/api/insights` from Smart Insights.

- [ ] **Step 1: Change source guards first**

Replace the old “restore every legacy block” assertion with:

```typescript
expect(smartInsightsPage).toContain("<AssetOpinions");
for (const removed of ["LegacyAIDigest", "LegacyInvestorIntelligence", "LegacyExpertSignals"])
  expect(smartInsightsPage).not.toContain(removed);
for (const endpoint of ["/api/research/runs", "/intelligence", "/api/insights"])
  expect(smartInsightsPage).not.toContain(endpoint);
```

Also require `AssetOpinions.tsx` to contain no `fetch(` and no sample constant.

- [ ] **Step 2: Run source-guard and dictionary tests**

Run:

```powershell
npm test -- src/components/smart-insights/source-guard.test.ts src/lib/i18n/dictionary.test.ts
```

Expected: FAIL while the old components are still rendered.

- [ ] **Step 3: Wire the merged block**

Remove imports/renders for `LegacyAIDigest`, `LegacyInvestorIntelligence`, and `LegacyExpertSignals`.
Render `AssetOpinions` after `LegacyDailyHero`, passing `briefing?.assetOpinions ?? []` and the existing
evidence callback. Preserve Market Pulse, Watchlist, Economic Calendar, and Data Health unchanged.

- [ ] **Step 4: Add localized copy**

Add exact Vietnamese/English labels for title, general view, portfolio view, confidence, scenarios,
invalidation, evidence, freshness, quant-only, insufficient, no-portfolio, and all five bounded
actions. Existing legacy copy can remain for compatibility but is no longer reachable from this page.

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
npm test -- src/components/smart-insights/source-guard.test.ts src/components/smart-insights/AssetOpinions.test.tsx src/lib/i18n/dictionary.test.ts
```

Expected: PASS.

```powershell
git add src/components/SmartInsights.tsx src/components/smart-insights/source-guard.test.ts src/lib/i18n/dictionary.ts src/lib/i18n/dictionary.test.ts
git commit -m "feat: merge Smart Insights intelligence blocks"
```

---

### Task 10: Verify Browser Behavior and Performance Budgets

**Files:**
- Create: `e2e/smart-insights-asset-opinions.spec.ts`
- Modify: `scripts/benchmark-smart-insights.mjs`
- Modify: `docs/verification/2026-08-15-asset-opinion-performance-baseline.md`

**Interfaces:**
- Consumes: seeded authenticated E2E app and a maximum-universe briefing fixture/revision.
- Produces: desktop/mobile browser evidence, forbidden-request assertions, final p50/p95/payload comparison, and budget pass/fail.

- [ ] **Step 1: Write the authenticated browser test**

The test follows the existing sign-up/workspace flow, visits `/`, records request URLs, and asserts:

```typescript
await expect(page.getByRole("heading", { name: "Quan điểm AI theo tài sản" })).toBeVisible();
await expect(page.getByText("Research run", { exact: true })).toHaveCount(0);
await expect(page.getByText("Investor Intelligence", { exact: true })).toHaveCount(0);
expect(requests.some((url) => url.includes("/api/research/runs"))).toBe(false);
expect(requests.some((url) => url.includes("/intelligence"))).toBe(false);
expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
```

On desktop, select BTC then XAU and assert only one detail region exists. On mobile, assert the table
is hidden, stacked cards are visible, action/scenario text wraps, and no horizontal overflow occurs.

- [ ] **Step 2: Run desktop and mobile E2E**

Run: `npm run test:e2e -- e2e/smart-insights-asset-opinions.spec.ts`

Expected: PASS in both configured projects with no console/page/API errors after authentication.

- [ ] **Step 3: Run the maximum-universe endpoint benchmark**

Run `scripts/benchmark-smart-insights.mjs` against a 25-asset accepted or quant-only revision. The
script must call `assertBudgets` after reporting measurements. Record p50/p95, raw/gzip bytes, asset
count, query count, request count, initial-JS delta, and mobile Web Vitals beside the Task 1 baseline.

- [ ] **Step 4: Profile only a failed budget**

If a budget fails, capture a CPU profile, React render profile, SQL `EXPLAIN (ANALYZE, BUFFERS)` for
the slow query, or bundle analyzer output matching the failed metric. Change an index, memoization,
or code split only when that evidence identifies it. Repeat the identical benchmark and record both
measurements.

- [ ] **Step 5: Run full verification**

Run from the repository root:

```powershell
npm run lint
npm test
npm run build
```

Run from `quant-worker`:

```powershell
python -m pytest tests/test_asset_opinion_universe.py tests/test_asset_opinion_quant.py tests/test_asset_opinion_repository.py tests/test_asset_opinion_ai.py tests/test_asset_opinion_pipeline.py tests/test_smart_insights_briefing_pipeline_integration.py tests/test_kronos_isolation.py -q
```

Expected: every command exits 0. If an unrelated pre-existing failure appears, record the exact test,
commit SHA, and evidence that it also fails on the baseline branch; do not describe it as passing.

- [ ] **Step 6: Commit browser and performance verification**

```powershell
git add e2e/smart-insights-asset-opinions.spec.ts scripts/benchmark-smart-insights.mjs docs/verification/2026-08-15-asset-opinion-performance-baseline.md
git commit -m "test: verify asset opinion performance"
```

---

## Completion Gate

Before merge or push, verify all of the following from the feature worktree:

- `git status --short` contains no unrelated or generated files.
- The worker tests prove no-lookahead, fail-closed gates, deterministic action, AI grounding, per-asset
  failure isolation, constant query count, and Kronos isolation.
- The web tests prove tenant scope, Zod validation, one briefing request, no obsolete block requests,
  no sample fallback, selected-only charts, and responsive rendering.
- The final verification document includes measured before/after evidence rather than estimated
  performance.
- The current branch contains only reviewed task commits and the approved design/plan commits.
