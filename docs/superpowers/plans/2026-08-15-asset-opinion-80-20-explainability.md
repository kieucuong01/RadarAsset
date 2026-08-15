# Asset Opinion 80/20 Explainability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn each Smart Insights asset opinion into a bounded, market-scoped and fully auditable decision showing every scored input, exact calculation, strongest support, contradictions and deterministic invalidation conditions.

**Architecture:** Keep provider collection and existing regime pipelines as the source of validated observations and normalized signal scores. Add a narrow asset-opinion rule registry that admits only 80/20 core metrics by market, selects the latest eligible fact, calculates an explainable ledger, and serializes only bounded decision inputs. Extend the current briefing contract and progressively disclose the formula in the existing selected-asset UI; DeepSeek remains an optional grounded explanation layer.

**Tech Stack:** Python 3.12 quant worker, PostgreSQL/psycopg, Next.js 16 App Router, React 19, TypeScript, Zod, shadcn/ui, Tailwind CSS, Recharts, pytest, Vitest and Playwright.

## Global Constraints

- Preserve the current Smart Insights styles, tokens, cards, typography, responsive layout and light/dark themes.
- Apply the 80/20 source policy from `docs/superpowers/specs/2026-08-15-asset-opinion-80-20-explainability-design.md`.
- No seed, fabricated, stale-AI or cross-market fallback is allowed in asset opinions.
- Kronos remains shadow-only and cannot enter facts, scores, prompts or UI evidence.
- At most 12 scored decision inputs, eight highlighted inputs and 30 chart points per series are serialized per asset.
- A maximum 25-asset briefing stays below 250 KB raw and 75 KB gzip and uses constant-count batched database queries.
- The badge `AI đã phân tích` is shown only for an accepted grounded DeepSeek output.
- Every production behavior change follows red-green-refactor TDD.

---

### Task 1: Market-Scope and Bound the Fact Repository

**Files:**
- Modify: `quant-worker/smart_insights/asset_opinion_contracts.py`
- Modify: `quant-worker/smart_insights/asset_opinion_repository.py`
- Test: `quant-worker/tests/test_asset_opinion_repository.py`

**Interfaces:**
- Consumes: metric observations, signal-snapshot input JSON, canonical asset symbols and `as_of`.
- Produces: `QuantFact` rows with dimensions, percentile, source input weight and normalization metadata; `AssetOpinionMarketData.facts_for(symbol)` contains only latest market-eligible decision facts.

- [ ] **Step 1: Add repository tests that reproduce cross-market leakage and historical flooding**

Extend `fact_row` with `dimensions`, `signal_metric_code`, `signal_market`, `signal_percentile`, and
`signal_configured_weight`, then add:

```python
def test_loader_scopes_global_facts_by_market_and_keeps_latest_metric_dimension() -> None:
    older = fact_row(None, "crypto.fear_greed.index")
    older["effective_at"] = NOW - timedelta(days=1)
    latest = fact_row(None, "crypto.fear_greed.index")
    latest["id"] = "fear-greed-latest"
    macro = fact_row(None, "macro.regime.score")
    connection = CountingConnection(fact_rows=[older, latest, macro])

    result = load_asset_opinion_market_data(
        connection,
        (("BTC", "crypto"), ("XAU", "gold"), ("VNINDEX", "equity")),
        ("BTC", "XAU", "VNINDEX"),
        NOW,
    )

    assert [row.id for row in result.facts_for("BTC") if row.metric_code == "crypto.fear_greed.index"] == ["fear-greed-latest"]
    assert all(not row.metric_code.startswith("crypto.") for row in result.facts_for("XAU"))
    assert all(not row.metric_code.startswith("crypto.") for row in result.facts_for("VNINDEX"))
    assert "macro.regime.score" in {row.metric_code for row in result.facts_for("BTC")}
    assert "macro.regime.score" in {row.metric_code for row in result.facts_for("XAU")}

def test_loader_excludes_unapproved_context_and_caps_decision_facts() -> None:
    rows = [fact_row(None, "crypto.cycle.altcoin_season.index")]
    rows += [fact_row("BTC", f"crypto.onchain.noise_{index}") for index in range(20)]
    result = load_asset_opinion_market_data(
        CountingConnection(fact_rows=rows), (("BTC", "crypto"),), ("BTC",), NOW
    )

    assert all(row.metric_code != "crypto.cycle.altcoin_season.index" for row in result.facts_for("BTC"))
    assert len(result.facts_for("BTC")) <= 12
```

- [ ] **Step 2: Run the focused repository tests and verify RED**

Run:

```powershell
Set-Location quant-worker
..\.venv\Scripts\python.exe -m pytest tests/test_asset_opinion_repository.py -q
```

Expected: FAIL because the loader accepts only symbol tuples, appends all global facts to every asset and keeps multiple effective observations.

- [ ] **Step 3: Implement explicit market admission and latest-key selection**

Change the loader signature to consume `tuple[tuple[str, str], ...]` for opinion assets. Select
`observation.dimensions`, `input.metricCode`, `input.percentile`, and `input.configuredWeight` in the
existing second batch query. Retain `signal.market` for every score candidate: XAU prefers the score
from the `gold` signal pipeline, BTC crypto inputs prefer `crypto`, and BTC macro inputs prefer
`macro`. A source observation scored for one market must never be reused with that score for another
market. Add pure helpers with these exact contracts:

```python
def fact_allowed_for_market(metric_code: str, market: str) -> bool:
    if metric_code.startswith("macro."):
        return market in {"crypto", "gold"}
    if metric_code.startswith("crypto."):
        return market == "crypto" and metric_code.startswith((
            "crypto.etf.", "crypto.coinshares.", "crypto.fear_greed.",
            "crypto.onchain.", "crypto.network.", "crypto.large_address.",
        ))
    if metric_code.startswith("gold."):
        return market == "gold"
    if metric_code.startswith("equity."):
        return market in {"equity", "stock_vn"}
    return False

def latest_decision_facts(rows: tuple[QuantFact, ...], *, limit: int = 12) -> tuple[QuantFact, ...]:
    latest: dict[tuple[str, tuple[tuple[str, str], ...]], QuantFact] = {}
    for row in rows:
        key = (row.metric_code, row.dimensions)
        current = latest.get(key)
        if current is None or (row.effective_at, row.observed_at, row.id) > (
            current.effective_at, current.observed_at, current.id
        ):
            latest[key] = row
    ordered = sorted(
        latest.values(),
        key=lambda row: (
            row.signed_score is None,
            not row.fresh,
            -(abs(row.signed_score) if row.signed_score is not None else Decimal("0")),
            row.metric_code,
            row.dimensions,
        ),
    )
    return tuple(ordered[:limit])
```

Use a dictionary keyed by `(row.metric_code, row.dimensions)` and the shown deterministic sort by
whether `signed_score` exists, freshness, absolute score and metric code. Preserve the existing
two-query invariant.

- [ ] **Step 4: Update repository callers and verify GREEN**

Modify `PostgresBriefingRepository.load_asset_opinion_market_data` and its protocol to pass
`tuple((asset.symbol, asset.market) for asset in universe.assets)`. Run:

```powershell
Set-Location quant-worker
..\.venv\Scripts\python.exe -m pytest tests/test_asset_opinion_repository.py tests/test_smart_insights_briefing_pipeline_integration.py -q
```

Expected: PASS and both the one-asset and 25-asset cases execute exactly two queries.

- [ ] **Step 5: Commit the repository boundary**

```powershell
git add quant-worker/smart_insights/asset_opinion_contracts.py quant-worker/smart_insights/asset_opinion_repository.py quant-worker/smart_insights/briefing_pipeline.py quant-worker/tests/test_asset_opinion_repository.py quant-worker/tests/test_smart_insights_briefing_pipeline_integration.py
git commit -m "fix: scope asset opinion facts by market"
```

---

### Task 2: Build the Explainable 80/20 Quant Ledger

**Files:**
- Create: `quant-worker/smart_insights/asset_opinion_rules.py`
- Modify: `quant-worker/smart_insights/asset_opinion_contracts.py`
- Modify: `quant-worker/smart_insights/asset_opinion_quant.py`
- Test: `quant-worker/tests/test_asset_opinion_quant.py`

**Interfaces:**
- Consumes: latest fresh `QuantFact` rows and derived market-bar facts.
- Produces: `DecisionInput`, enhanced `PillarScore`, formula text, deterministic supporting/contradicting IDs and invalidation conditions on `QuantAssetOpinion`.

- [ ] **Step 1: Write failing quant tests for market weights and the exact calculation trace**

Add tests using real `build_quant_opinion` behavior:

```python
def test_btc_80_20_ledger_exposes_exact_weighted_contributions() -> None:
    opinion = build_quant_opinion(
        asset=candidate("BTC"), bars=bars(220),
        specialized=(
            fact("crypto.etf.net_flow_usd", "farside", score="80"),
            fact("crypto.coinshares.net_flow_usd", "coinshares-weekly", score="40"),
            fact("crypto.fear_greed.index", "alternative-fng", score="20"),
            fact("macro.regime.score", "fred", score="-20", contradicting=True),
        ),
        as_of=NOW, risk_tolerance="moderate",
    )

    assert {row.code: row.configured_weight for row in opinion.pillars} == {
        "trend": Decimal("0.40"), "fund_flow": Decimal("0.30"),
        "macro": Decimal("0.15"), "sentiment_onchain": Decimal("0.15"),
    }
    assert len(opinion.decision_inputs) <= 12
    assert sum((row.contribution for row in opinion.pillars), Decimal("0")) == opinion.total_contribution
    assert opinion.formula == "asset_score = Σ(pillar_score × pillar_weight) ÷ data_coverage"
    assert opinion.contradicting_fact_ids

def test_highlight_selection_is_bounded_and_uses_contribution_order() -> None:
    opinion = build_quant_opinion(
        asset=candidate("BTC"), bars=bars(220),
        specialized=tuple(
            fact(f"crypto.onchain.metric_{index}", f"source-{index}", score=str(90 - index * 10), contradicting=index >= 6)
            for index in range(9)
        ),
        as_of=NOW, risk_tolerance="moderate",
    )
    assert 3 <= len(opinion.supporting_fact_ids) <= 5
    assert len(opinion.contradicting_fact_ids) <= 3

def test_xau_uses_trend_macro_and_optional_positioning_weights() -> None:
    opinion = build_quant_opinion(
        asset=candidate("XAU", market="gold"), bars=bars(220, symbol="XAU"),
        specialized=(
            fact("macro.real_yield.10y_pct", "fred", score="-40"),
            fact("macro.usd_broad_index", "fred-usd", score="-20"),
            fact("gold.cftc.managed_money_net_oi", "cftc", score="30"),
        ),
        as_of=NOW, risk_tolerance="moderate",
    )
    assert {row.code: row.configured_weight for row in opinion.pillars} == {
        "trend": Decimal("0.55"), "macro": Decimal("0.30"), "positioning": Decimal("0.15"),
    }
    assert opinion.data_coverage == Decimal("1.00")
```

- [ ] **Step 2: Run quant tests and verify RED**

Run:

```powershell
Set-Location quant-worker
..\.venv\Scripts\python.exe -m pytest tests/test_asset_opinion_quant.py -q
```

Expected: FAIL because `DecisionInput`, contribution fields and market-specific rule weights do not exist.

- [ ] **Step 3: Implement a small versioned rule registry**

Define `MARKET_RULES` in `asset_opinion_rules.py` with the exact pillar weights from the approved
spec. Admit only the listed core prefixes/exact metrics. Treat Farside and CoinShares as one
`fund_flow` pillar with input weights `0.75` and `0.25`; when one is absent, normalize by available
input weight without increasing the pillar's configured weight. Reuse `signed_score` and percentile
already produced by the provider regime pipelines; compute Fear & Greed directly only when a source
score is absent:

```python
def fear_greed_score(value: Decimal) -> Decimal:
    return max(Decimal("-100"), min(Decimal("100"), (value - Decimal("50")) * Decimal("2")))
```

Do not promote unscored metrics merely to satisfy coverage.

- [ ] **Step 4: Calculate and expose deterministic contribution records**

Add immutable contracts:

```python
@dataclass(frozen=True, slots=True)
class DecisionInput:
    fact_id: str
    metric_code: str
    pillar_code: str
    raw_value: Decimal
    unit: str
    normalized_score: Decimal
    input_weight: Decimal
    weighted_score: Decimal
    pillar_weight: Decimal
    contribution: Decimal
    normalization_method: str
    percentile: Decimal | None
    lookback: str | None
```

Compute pillars from their decision inputs, store `available_input_weight` and `contribution`, and
select support/contradictions by descending absolute contribution with metric-code tie-breakers.
Derive invalidations from the strongest supporting input by describing the stance boundary score
that would be crossed; never ask AI to invent the threshold.

- [ ] **Step 5: Run all asset-opinion worker tests and verify GREEN**

```powershell
Set-Location quant-worker
..\.venv\Scripts\python.exe -m pytest tests/test_asset_opinion_quant.py tests/test_asset_opinion_pipeline.py tests/test_asset_opinion_ai.py tests/test_kronos_isolation.py -q
```

Expected: PASS with the same inputs producing byte-for-byte equal ledgers and Kronos absent.

- [ ] **Step 6: Commit the quant ledger**

```powershell
git add quant-worker/smart_insights/asset_opinion_rules.py quant-worker/smart_insights/asset_opinion_contracts.py quant-worker/smart_insights/asset_opinion_quant.py quant-worker/tests/test_asset_opinion_quant.py
git commit -m "feat: explain asset opinion calculations"
```

---

### Task 3: Persist and Serve a Bounded Explainability Contract

**Files:**
- Modify: `quant-worker/smart_insights/briefing_pipeline.py`
- Modify: `quant-worker/tests/test_asset_opinion_persistence.py`
- Modify: `src/lib/backend/smart-insights-types.ts`
- Modify: `src/lib/backend/smart-insights.ts`
- Modify: `src/lib/backend/smart-insights.test.ts`
- Modify: `src/lib/smart-insights-client.ts`
- Modify: `src/lib/smart-insights-client.test.ts`

**Interfaces:**
- Consumes: `QuantAssetOpinion` explainability records and accepted optional AI output.
- Produces: one Zod-validated `AssetOpinionModel` containing bounded `decisionInputs`, highlighted support/contradictions, pillar contributions, formula and deterministic invalidations.

- [ ] **Step 1: Write failing persistence and API contract tests**

Assert the snapshot contains all scored inputs but no unscored/historical facts:

```python
assert len(snapshot["decisionInputs"]) <= 12
assert len(snapshot["supportingEvidenceIds"]) <= 5
assert len(snapshot["contradictingEvidenceIds"]) <= 3
assert snapshot["formula"] == "asset_score = Σ(pillar_score × pillar_weight) ÷ data_coverage"
assert all(row["usedInDecision"] for row in snapshot["evidence"])
```

In TypeScript fixtures, add one exact decision input and assert unknown fields, more than 12 inputs,
more than five support IDs, or an `accepted` state without AI prose are rejected.

- [ ] **Step 2: Run contract tests and verify RED**

```powershell
Set-Location quant-worker
..\.venv\Scripts\python.exe -m pytest tests/test_asset_opinion_persistence.py -q
Set-Location ..
npm test -- src/lib/backend/smart-insights.test.ts src/lib/smart-insights-client.test.ts
```

Expected: FAIL because the new explainability fields are absent.

- [ ] **Step 3: Serialize only decision evidence**

Change `_persist_asset_opinion` so `evidence` is built from `quant.decision_inputs` rather than
`quant.facts`. Store the raw value, normalized score, input/pillar weights, contribution,
normalization method, percentile and `usedInDecision: true`. Persist only the selected support and
contradiction evidence IDs into the snapshot and AI bundle.

- [ ] **Step 4: Extend server types, parser and Zod schema**

Add `decisionInputSchema` with finite decimal strings and maximum-array constraints:

```typescript
const decisionInputSchema = z.object({
  evidenceId: z.string().min(1),
  metricCode: z.string().min(1),
  pillarCode: z.string().min(1),
  rawValue: z.string(),
  unit: z.string().min(1),
  normalizedScore: decimalString,
  inputWeight: decimalString,
  pillarWeight: decimalString,
  contribution: decimalString,
  normalizationMethod: z.string().min(1),
  percentile: decimalString.nullable(),
  lookback: z.string().nullable(),
}).strict();
```

Use `.max(12)`, `.max(5)`, `.max(3)` and chart-series `.max(30)`. Keep malformed stored rows isolated
through the existing per-opinion fallback rather than failing the entire briefing.

- [ ] **Step 5: Verify contracts and measure stored payload**

Run the focused Python and Vitest commands from Step 2 and execute the existing briefing payload
benchmark. Expected: PASS and the latest stored 25-asset response is below the raw/gzip budgets.

- [ ] **Step 6: Commit the bounded contract**

```powershell
git add quant-worker/smart_insights/briefing_pipeline.py quant-worker/tests/test_asset_opinion_persistence.py src/lib/backend/smart-insights-types.ts src/lib/backend/smart-insights.ts src/lib/backend/smart-insights.test.ts src/lib/smart-insights-client.ts src/lib/smart-insights-client.test.ts
git commit -m "feat: serve bounded asset decision evidence"
```

---

### Task 4: Redesign the Selected-Asset Explanation UI

**Files:**
- Create: `src/components/smart-insights/AssetOpinionCalculation.tsx`
- Modify: `src/components/smart-insights/AssetOpinionDetail.tsx`
- Modify: `src/components/smart-insights/AssetOpinionList.tsx`
- Modify: `src/components/smart-insights/AssetOpinions.tsx`
- Modify: `src/components/smart-insights/AssetOpinions.test.tsx`
- Modify: `src/lib/i18n/dictionary.ts`
- Modify: `src/lib/i18n/dictionary.test.ts`

**Interfaces:**
- Consumes: the bounded `AssetOpinionModel` and existing `onEvidence(id)` callback.
- Produces: conclusion-first detail, 3–5 support cards, 1–3 contradiction cards, deterministic invalidations and a collapsed calculation disclosure containing every scored input.

- [ ] **Step 1: Write failing UI tests for hierarchy and AI badge truthfulness**

Extend the fixture with exact contribution fields and assert:

```tsx
it("shows conclusion support contradictions invalidation and the complete calculation ledger", () => {
  const html = renderToStaticMarkup(
    <AssetOpinions opinions={[opinion()]} locale="vi" onEvidence={() => undefined} />,
  );
  expect(html).toContain("Kết luận");
  expect(html).toContain("Vì sao có kết luận này");
  expect(html).toContain("Yếu tố phản biện");
  expect(html).toContain("Điều kiện đổi quan điểm");
  expect(html).toContain("Xem cách tính");
  expect(html).toContain("Đóng góp");
});

it("labels AI only after grounded output is accepted", () => {
  const accepted = renderToStaticMarkup(<AssetOpinions opinions={[opinion()]} locale="vi" onEvidence={() => undefined} />);
  const quantOnly = renderToStaticMarkup(<AssetOpinions opinions={[opinion({ explanationStatus: "quant_only", thesis: null })]} locale="vi" onEvidence={() => undefined} />);
  expect(accepted).toContain("AI đã phân tích");
  expect(quantOnly).toContain("Phân tích định lượng");
  expect(quantOnly).not.toContain("AI đã phân tích");
});
```

- [ ] **Step 2: Run component and dictionary tests and verify RED**

```powershell
npm test -- src/components/smart-insights/AssetOpinions.test.tsx src/lib/i18n/dictionary.test.ts
```

Expected: FAIL because the hierarchy, calculation disclosure and verified AI badge do not exist.

- [ ] **Step 3: Implement the calculation disclosure using existing primitives**

Use semantic `<details>`/`<summary>` so it is collapsed by default without client state. Render a
pillar subtotal table followed by all `decisionInputs`. Every row shows raw value, normalized score,
input/pillar weight and signed contribution. Use tabular numerals, text plus color and a minimum
44-pixel summary target.

- [ ] **Step 4: Recompose the selected detail in decision order**

Replace the evidence dump with the six approved sections. Support and contradiction cards are
selected from IDs supplied by the backend; do not sort again in React. Keep only selected-asset
charts and cap chart inputs at the contract boundary. Use existing theme tokens and Lucide icons;
add no dependency and no new fetch.

- [ ] **Step 5: Add exact localized copy and verify GREEN**

Add Vietnamese/English labels for the six sections, raw value, normalized score, input weight,
pillar weight, contribution, formula, `AI đã phân tích`, `Phân tích định lượng`, and empty
contradiction state. Run:

```powershell
npm test -- src/components/smart-insights/AssetOpinions.test.tsx src/lib/i18n/dictionary.test.ts src/lib/smart-insights-client.test.ts
```

Expected: PASS with no `2000 evidence` count and no unbounded `.map(opinion.evidence)` render path.

- [ ] **Step 6: Commit the explanation UI**

```powershell
git add src/components/smart-insights/AssetOpinionCalculation.tsx src/components/smart-insights/AssetOpinionDetail.tsx src/components/smart-insights/AssetOpinionList.tsx src/components/smart-insights/AssetOpinions.tsx src/components/smart-insights/AssetOpinions.test.tsx src/lib/i18n/dictionary.ts src/lib/i18n/dictionary.test.ts
git commit -m "feat: explain every asset opinion decision"
```

---

### Task 5: Regenerate, Measure and Browser-Verify the Live Local Experience

**Files:**
- Modify: `scripts/benchmark-smart-insights.mjs`
- Modify: `e2e/smart-insights-asset-opinions.spec.ts`
- Modify: `docs/verification/2026-08-15-asset-opinion-performance-baseline.md`

**Interfaces:**
- Consumes: migrated code, local PostgreSQL data, worker refresh queue and authenticated local app.
- Produces: refreshed real local briefings, before/after evidence counts and payload sizes, desktop/mobile QA and a verified final report.

- [ ] **Step 1: Add failing payload and browser assertions**

Add benchmark assertions for every opinion:

```javascript
for (const opinion of briefing.assetOpinions) {
  assert.ok(opinion.decisionInputs.length <= 12);
  assert.ok(opinion.supportingEvidenceIds.length <= 5);
  assert.ok(opinion.contradictingEvidenceIds.length <= 3);
}
assert.ok(rawBytes <= 250_000);
assert.ok(gzipBytes <= 75_000);
```

Extend Playwright to open `Xem cách tính`, assert one formula/ledger, verify the AI/quant label for
the fixture state, switch BTC/XAU, and assert no horizontal overflow at desktop and 390x844 mobile.

- [ ] **Step 2: Run benchmark/E2E and verify RED against old stored briefings**

Run the focused benchmark and production E2E command documented in the existing verification file.
Expected: FAIL until briefings are regenerated with the new snapshot contract.

- [ ] **Step 3: Refresh upstream regimes and all queued asset opinions**

Run the existing Smart Insights worker activation/refresh commands from
`docs/operations/smart-insights-runbook.md`. Do not mark unavailable collectors successful. Confirm
the newest briefing contains market-scoped facts and no asset has more than 12 decision inputs.

- [ ] **Step 4: Measure before/after payload and runtime**

Record the current observed failure baseline of roughly 2,000 evidence rows per affected asset, then
record final maximum evidence count, raw bytes, gzip bytes, p50/p95, query count and browser Web
Vitals using the same authenticated benchmark. Update the verification document with exact numbers.

- [ ] **Step 5: Run full verification**

From the repository root:

```powershell
npm run lint
npm test
npm run build
```

From `quant-worker`:

```powershell
..\.venv\Scripts\python.exe -m pytest -q
```

Then run the authenticated desktop/mobile E2E. Expected: all affected tests pass, build exits 0,
payload budgets pass and the browser shows no new console, API or overflow errors.

- [ ] **Step 6: Commit verification evidence**

```powershell
git add scripts/benchmark-smart-insights.mjs e2e/smart-insights-asset-opinions.spec.ts docs/verification/2026-08-15-asset-opinion-performance-baseline.md
git commit -m "test: verify bounded asset opinion evidence"
```

---

## Completion Gate

- Repository tests prove latest-fact selection, explicit global market mapping, two-query batch access and the 12-input cap.
- Quant tests prove exact 80/20 weights, formula totals, deterministic support/contradiction ordering, stance gates and Kronos isolation.
- API/Zod tests prove bounded strict contracts and per-opinion malformed-data isolation.
- UI tests prove conclusion-first hierarchy, complete calculation disclosure and truthful AI labels.
- Live local briefings are regenerated; current DB evidence is distinguished from test fixtures.
- Raw/gzip payload, p50/p95, Web Vitals, desktop/mobile layout, lint, tests and production build are recorded before completion is claimed.
