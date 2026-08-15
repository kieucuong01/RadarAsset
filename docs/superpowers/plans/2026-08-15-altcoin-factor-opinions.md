# Altcoin Factor Opinions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce evidence-backed opinions for non-stablecoin altcoins, with BTC context and Altcoin Season for every altcoin, asset-specific ETF flow for ETH/SOL, and optional quantified macro liquidity including four-week M2 change.

**Architecture:** Resolve each personalized symbol from the existing asset catalog fields returned by the personalization queries, then select one deterministic factor profile by canonical symbol. Load provider observations and price bars in the existing two-query market-data batch, derive BTC context once per briefing and M2 liquidity from real FRED history, and keep every missing provider fail-closed. Reuse the existing read contract and Asset Opinion UI, extending only labels, deterministic change conditions, fixtures, and performance guards.

**Tech Stack:** Python 3.12, psycopg/PostgreSQL, pytest, Next.js 16, React 19, TypeScript, Vitest, Playwright, FRED collector, Scrapling-backed BlockchainCenter/Farside collectors.

## Global Constraints

- Keep the existing BTC opinion profile and its weights unchanged.
- Exclude `USDT`, `USDC`, `DAI`, `FDUSD`, and `TUSD` before loading opinion market data.
- Standard altcoins use weights: asset trend 30%, BTC trend 25%, Altcoin rotation 20%, macro 15%, broad sentiment 10%.
- ETH and SOL use weights: asset trend 25%, BTC trend 20%, Altcoin rotation 15%, ETF flow 25%, macro 10%, broad sentiment 5%.
- Accept only `crypto.cycle.altcoin_season.index` with `dimensions.horizon = season_90d`.
- Normalize Altcoin Season with `clamp((index - 50) * 2, -100, 100)` and method `altcoin_season_centered_v1`.
- ETH and SOL consume only their own Farside `fund = TOTAL` series; other altcoins receive no ETF pillar.
- Use at most two macro decision inputs, selected by absolute contribution.
- Missing or stale provider data lowers coverage; it is never zero-filled or simulated.
- Preserve gates of 60 fresh daily bars, three numeric inputs, two source families, and 60% weighted pillar coverage.
- Cap each opinion at 12 decision inputs, five supporting facts, three contradicting facts, and 12 evidence rows.
- Keep market-data query count constant from one through 25 assets and add no frontend dependency.
- Preserve the current optimized briefing budgets: warm local p95 at most 200 ms, raw JSON at most 250,000 bytes, gzip JSON at most 75,000 bytes, LCP at most 2.5 seconds, INP at most 200 ms, and CLS at most 0.1.

---

## File Structure

- `quant-worker/smart_insights/asset_opinion_contracts.py`: catalog identity contract shared by repository and universe construction.
- `quant-worker/smart_insights/asset_opinion_quant.py`: canonical market mapping, stablecoin exclusion, derived BTC context, normalization, gates, scoring, and deterministic invalidations.
- `quant-worker/smart_insights/asset_opinion_rules.py`: BTC, standard-altcoin, and ETH/SOL profile weights and input rules.
- `quant-worker/smart_insights/briefing_pipeline.py`: personalization/catalog batching and once-per-briefing context reuse.
- `quant-worker/smart_insights/asset_opinion_repository.py`: bounded provider-fact selection, dimension scoping, percentile normalization, and derived M2 history.
- `quant-worker/smart_insights/macro_registry.py`: allow-listed FRED `M2SL` source definition.
- `quant-worker/smart_insights/metrics/macro.py`: raw and derived M2 metric definitions without changing the existing macro-regime component weights.
- `quant-worker/smart_insights/collectors/farside.py`: deterministic `TOTAL` construction when a validated table exposes fund rows but no total column.
- `src/components/smart-insights/asset-opinion-labels.ts`: Vietnamese/English factor and pillar labels.
- `src/components/smart-insights/AssetOpinionDetail.tsx`: Vietnamese/English deterministic invalidation labels.
- Existing Python, Vitest, and Playwright files listed in each task hold regression coverage.

### Task 1: Canonical Catalog Markets and Stablecoin Boundary

**Files:**
- Modify: `quant-worker/smart_insights/asset_opinion_contracts.py`
- Modify: `quant-worker/smart_insights/asset_opinion_quant.py`
- Modify: `quant-worker/smart_insights/briefing_pipeline.py`
- Test: `quant-worker/tests/test_asset_opinion_universe.py`
- Test: `quant-worker/tests/test_smart_insights_briefing_pipeline_integration.py`
- Test: `quant-worker/tests/test_asset_opinion_persistence.py`

**Interfaces:**
- Produces: `AssetIdentity(symbol: str, name: str, market: str, asset_class: str)`.
- Produces: `canonical_opinion_market(identity: AssetIdentity | None, *, symbol: str, signal_market: str | None) -> str`.
- Changes: `BriefingRepository.load_personalization(...)` returns `(positions, watchlist, preferences, identities)`.
- Preserves: portfolio/watchlist order and the 25-asset cap.

- [ ] **Step 1: Write failing taxonomy and stablecoin tests**

```python
def test_catalog_market_overrides_missing_or_wrong_signal_market() -> None:
    assert canonical_opinion_market(
        AssetIdentity("ETH", "Ethereum", "crypto_spot", "crypto"),
        symbol="ETH",
        signal_market=None,
    ) == "crypto"
    assert canonical_opinion_market(
        AssetIdentity("SOL", "Solana", "crypto_spot", "crypto"),
        symbol="SOL",
        signal_market="macro",
    ) == "crypto"
    assert canonical_opinion_market(
        AssetIdentity("XAU", "Gold Spot", "metal_spot", "commodity"),
        symbol="XAU",
        signal_market=None,
    ) == "gold"


def test_universe_excludes_stablecoins_before_limit() -> None:
    universe = build_asset_universe(
        (candidate("USDT"), candidate("ETH")),
        (candidate("USDC", watchlist_rank=1), candidate("ADA", watchlist_rank=2)),
        ("BTC",),
        limit=3,
    )
    assert tuple(row.symbol for row in universe.assets) == ("ETH", "ADA", "BTC")
```

Update the briefing fake repository to return an identity tuple and assert that an ETH position with no ETH signal reaches `load_asset_opinion_market_data` as `("ETH", "crypto")`.

- [ ] **Step 2: Run the focused tests and confirm the pre-change failure**

Run:

```powershell
Set-Location quant-worker
& ..\.venv\Scripts\python.exe -m pytest tests/test_asset_opinion_universe.py tests/test_smart_insights_briefing_pipeline_integration.py tests/test_asset_opinion_persistence.py -q
```

Expected: failure because `AssetIdentity`, `canonical_opinion_market`, and the fourth personalization result do not exist.

- [ ] **Step 3: Implement the catalog contract and canonical mapping**

Add the frozen identity contract and these exact boundaries:

```python
STABLECOIN_SYMBOLS = frozenset({"USDT", "USDC", "DAI", "FDUSD", "TUSD"})


def canonical_opinion_market(
    identity: AssetIdentity | None,
    *,
    symbol: str,
    signal_market: str | None,
) -> str:
    normalized = canonical_symbol(symbol)
    if identity is not None:
        if identity.market == "crypto_spot" or identity.asset_class.casefold() == "crypto":
            return "crypto"
        if identity.market == "vn_equity":
            return "stock_vn"
        if identity.market == "metal_spot" or normalized == "XAU":
            return "gold"
        if identity.market in {"equity", "index", "global_equity"}:
            return "equity"
    if normalized in REPRESENTATIVE_MARKETS:
        return REPRESENTATIVE_MARKETS[normalized]
    return signal_market if signal_market in {"crypto", "gold", "equity", "stock_vn"} else "other"
```

Skip a candidate in `build_asset_universe` when its canonical symbol is in `STABLECOIN_SYMBOLS`, before adding it to `seen` or counting it toward `limit`.

- [ ] **Step 4: Return catalog fields inside the existing personalization queries**

Select `a.name`, `a.market`, and `a.asset_class` in both portfolio and watchlist queries, and add those non-aggregated fields to the portfolio query's `GROUP BY`. Build one deduplicated `tuple[AssetIdentity, ...]` from those rows, retain `ORDER BY w.created_at, w.id`, and return it as the fourth item. In `generate_briefing`, build `identity_by_symbol`, resolve catalog identity before signal metadata, and continue using representative fallbacks for BTC, XAU, and VNINDEX.

- [ ] **Step 5: Run the focused tests and confirm they pass**

Run the Step 2 command. Expected: all selected tests pass, ETH resolves from catalog metadata, stablecoins are absent, and watchlist ordering is unchanged.

- [ ] **Step 6: Commit the catalog boundary**

```powershell
git add quant-worker/smart_insights/asset_opinion_contracts.py quant-worker/smart_insights/asset_opinion_quant.py quant-worker/smart_insights/briefing_pipeline.py quant-worker/tests/test_asset_opinion_universe.py quant-worker/tests/test_smart_insights_briefing_pipeline_integration.py quant-worker/tests/test_asset_opinion_persistence.py
git commit -m "feat: resolve opinion assets from catalog"
```

### Task 2: Deterministic BTC, Standard-Alt, and ETH/SOL Profiles

**Files:**
- Modify: `quant-worker/smart_insights/asset_opinion_rules.py`
- Modify: `quant-worker/smart_insights/asset_opinion_quant.py`
- Test: `quant-worker/tests/test_asset_opinion_quant.py`

**Interfaces:**
- Produces: `opinion_profile(market: str, symbol: str) -> str`, returning `btc`, `standard_alt`, `etf_alt`, or the existing non-crypto market name.
- Changes: `pillar_weights(market: str, symbol: str) -> dict[str, Decimal]`.
- Changes: `input_rule(market: str, symbol: str, metric_code: str) -> InputRule | None`.
- Preserves: the current BTC weights `trend=.40`, `fund_flow=.30`, `macro=.15`, `sentiment_onchain=.15`.

- [ ] **Step 1: Write failing profile-weight tests**

```python
def test_altcoin_profiles_have_exact_weights() -> None:
    assert pillar_weights("crypto", "ADA") == {
        "trend": Decimal("0.30"),
        "btc_trend": Decimal("0.25"),
        "altcoin_rotation": Decimal("0.20"),
        "macro": Decimal("0.15"),
        "broad_sentiment": Decimal("0.10"),
    }
    assert pillar_weights("crypto", "ETH") == {
        "trend": Decimal("0.25"),
        "btc_trend": Decimal("0.20"),
        "altcoin_rotation": Decimal("0.15"),
        "etf_flow": Decimal("0.25"),
        "macro": Decimal("0.10"),
        "broad_sentiment": Decimal("0.05"),
    }
    assert pillar_weights("crypto", "BTC") == {
        "trend": Decimal("0.40"),
        "fund_flow": Decimal("0.30"),
        "macro": Decimal("0.15"),
        "sentiment_onchain": Decimal("0.15"),
    }
```

Add a ledger test with four eligible macro facts and assert only the two largest absolute macro contributions survive and total decision inputs remain at most 12.

Add coverage assertions using explicit fact tuples: standard altcoin without macro is `0.85`, ETH/SOL with ETF but without macro is `0.90`, ETH/SOL without ETF and macro is `0.65`, and price-only altcoins remain below `0.60` and fail `PILLAR_COVERAGE_MINIMUM_60`.

- [ ] **Step 2: Run the focused test and confirm the old single-profile behavior fails**

```powershell
Set-Location quant-worker
& ..\.venv\Scripts\python.exe -m pytest tests/test_asset_opinion_quant.py -q
```

Expected: profile signatures and expected altcoin weights fail before implementation.

- [ ] **Step 3: Add symbol-aware profile constants and rules**

Use separate immutable dictionaries for BTC, standard altcoins, and ETH/SOL. Route `market.*` trend inputs to `trend`, `crypto.btc.return_*` to `btc_trend`, `crypto.cycle.altcoin_season.index` to `altcoin_rotation`, ETH/SOL `crypto.etf.net_flow_usd` to `etf_flow`, `crypto.fear_greed.index` to `broad_sentiment`, and the approved macro metrics to `macro`. Keep CoinShares and on-chain rules available only to BTC.

- [ ] **Step 4: Make the decision ledger symbol-aware and cap macro evidence**

Change the internal call to:

```python
pillars, decision_inputs = _decision_ledger(asset.market, asset.symbol, facts)
```

Before the 12-row cap, select macro candidates with:

```python
macro_rows = sorted(
    (row for row in candidates if row[1].pillar_code == "macro"),
    key=lambda row: (-abs(row[2] * row[1].input_weight), row[0].metric_code, row[0].id),
)[:2]
allowed_macro_ids = {row[0].id for row in macro_rows}
candidates = [
    row
    for row in candidates
    if row[1].pillar_code != "macro" or row[0].id in allowed_macro_ids
]
```

Bump the methodology identifier to `asset-opinion-v2` because altcoin weights and factor membership change, while the BTC weight assertions prevent accidental BTC profile drift.

- [ ] **Step 5: Run the profile tests and confirm they pass**

Run the Step 2 command. Expected: the full quant test file passes, each profile sums to `1.00`, only two macro facts enter an altcoin ledger, and BTC regression assertions remain green.

- [ ] **Step 6: Commit the profiles**

```powershell
git add quant-worker/smart_insights/asset_opinion_rules.py quant-worker/smart_insights/asset_opinion_quant.py quant-worker/tests/test_asset_opinion_quant.py
git commit -m "feat: add deterministic altcoin profiles"
```

### Task 3: Once-Per-Briefing BTC Trend Context

**Files:**
- Modify: `quant-worker/smart_insights/asset_opinion_quant.py`
- Modify: `quant-worker/smart_insights/asset_opinion_pipeline.py`
- Test: `quant-worker/tests/test_asset_opinion_quant.py`
- Test: `quant-worker/tests/test_asset_opinion_pipeline.py`

**Interfaces:**
- Produces: `build_btc_context_facts(bars: tuple[MarketBar, ...], *, as_of: datetime) -> tuple[QuantFact, ...]`.
- Produces exactly `crypto.btc.return_20d` and `crypto.btc.return_60d` when enough fresh BTC bars exist.
- Reuses the same fact IDs and underlying BTC bar IDs across every non-BTC crypto draft in a batch.

- [ ] **Step 1: Write failing BTC-context tests**

```python
def test_btc_context_uses_explainable_bounded_returns() -> None:
    facts = build_btc_context_facts(bars(90, symbol="BTC"), as_of=NOW)
    assert tuple(row.metric_code for row in facts) == (
        "crypto.btc.return_20d",
        "crypto.btc.return_60d",
    )
    assert all(Decimal("-100") <= row.signed_score <= Decimal("100") for row in facts)
    assert all(row.normalization_method == "return_x400_bounded_v1" for row in facts)
    assert all(row.source_family == "market_bars" for row in facts)
```

In the pipeline test, create ETH and ADA candidates, instrument the quant builder, and assert both calls receive the same two BTC fact IDs while the market-data repository call count remains unchanged.

- [ ] **Step 2: Run the focused tests and confirm the helper is absent**

```powershell
Set-Location quant-worker
& ..\.venv\Scripts\python.exe -m pytest tests/test_asset_opinion_quant.py tests/test_asset_opinion_pipeline.py -q
```

Expected: import or assertion failure for the new BTC context helper and reused specialized facts.

- [ ] **Step 3: Implement BTC context from the existing benchmark batch**

Filter closed BTC bars at `as_of`, require 21 bars for the 20-day fact and 61 for the 60-day fact, use `return * 400` bounded to `[-100, 100]`, retain the exact underlying bar IDs, and set each fact timestamp from the latest contributing BTC bar. Return no partial 60-day fact when its history is insufficient.

- [ ] **Step 4: Reuse context facts in `build_asset_opinion_drafts`**

Compute once before the asset loop:

```python
btc_context = build_btc_context_facts(
    inputs.market_data.bars_for("BTC"),
    as_of=inputs.as_of,
)
```

For each non-BTC crypto asset, pass `(*inputs.market_data.facts_for(asset.symbol), *btc_context)` as `specialized`. Pass the unchanged specialized tuple for BTC and all non-crypto assets.

- [ ] **Step 5: Run the focused tests and confirm they pass**

Run the Step 2 command. Expected: BTC context facts are bounded, auditable, reused across altcoins, and no per-asset query path exists.

- [ ] **Step 6: Commit BTC context reuse**

```powershell
git add quant-worker/smart_insights/asset_opinion_quant.py quant-worker/smart_insights/asset_opinion_pipeline.py quant-worker/tests/test_asset_opinion_quant.py quant-worker/tests/test_asset_opinion_pipeline.py
git commit -m "feat: reuse BTC trend context for altcoins"
```

### Task 4: Altcoin Season and Asset-Specific ETF Fact Selection

**Files:**
- Modify: `quant-worker/smart_insights/asset_opinion_repository.py`
- Modify: `quant-worker/smart_insights/asset_opinion_quant.py`
- Test: `quant-worker/tests/test_asset_opinion_repository.py`
- Test: `quant-worker/tests/test_asset_opinion_quant.py`

**Interfaces:**
- Accepts: global `crypto.cycle.altcoin_season.index` only at `horizon=season_90d`.
- Accepts: `crypto.etf.net_flow_usd` only when `fund=TOTAL` and `dimensions.asset` matches the requested BTC, ETH, or SOL symbol.
- Produces: centered Altcoin Season scores with normalization method `altcoin_season_centered_v1`.

- [ ] **Step 1: Write failing dimension and normalization tests**

```python
def test_loader_keeps_only_90_day_altcoin_season() -> None:
    rows = []
    for horizon, value in (("season_90d", "25"), ("month", "80"), ("year", "90")):
        row = fact_row(
            None,
            "crypto.cycle.altcoin_season.index",
            dimensions={"horizon": horizon},
        )
        row.update(id=f"altseason-{horizon}", value=Decimal(value))
        rows.append(row)
    result = load_asset_opinion_market_data(
        CountingConnection(fact_rows=rows),
        (("ADA", "crypto"),),
        ("BTC",),
        NOW,
    )
    fact = next(row for row in result.facts_for("ADA") if row.metric_code.endswith("altcoin_season.index"))
    assert dict(fact.dimensions)["horizon"] == "season_90d"


@pytest.mark.parametrize(("value", "score"), (("25", "-50"), ("50", "0"), ("75", "50")))
def test_altcoin_season_centered_score(value: str, score: str) -> None:
    opinion = build_quant_opinion(
        asset=candidate("ADA", market="crypto"),
        bars=bars(90, symbol="ADA"),
        specialized=(
            fact(
                "crypto.cycle.altcoin_season.index",
                "blockchaincenter-altcoin-season",
                score=None,
                value=value,
            ),
        ),
        as_of=NOW,
        risk_tolerance="moderate",
    )
    row = next(item for item in opinion.decision_inputs if item.metric_code.endswith("altcoin_season.index"))
    assert row.normalized_score == Decimal(score)
    assert row.normalization_method == "altcoin_season_centered_v1"
```

Add repository rows with ETH and SOL ETF dimensions in the same batch; assert ETH receives only ETH TOTAL, SOL only SOL TOTAL, and ADA receives no ETF fact.

- [ ] **Step 2: Run focused tests and confirm current exclusion fails**

```powershell
Set-Location quant-worker
& ..\.venv\Scripts\python.exe -m pytest tests/test_asset_opinion_repository.py tests/test_asset_opinion_quant.py -q
```

Expected: Altcoin Season is absent and ETF asset-dimension checks are not enforced.

- [ ] **Step 3: Extend bounded repository selection**

Add `crypto.cycle.altcoin_season.index` to `CRYPTO_DECISION_METRICS`. Change `_fact_dimensions_allowed` to receive `symbol`, enforce `season_90d`, and enforce both `fund=TOTAL` and matching `asset` for ETF observations. Keep the latest-fact limit at 12 and the SQL output limit at 1,000.

- [ ] **Step 4: Implement centered rotation normalization before source scores**

At the start of `_fact_score`, before returning a stored `signed_score`, add:

```python
if fact.metric_code == "crypto.cycle.altcoin_season.index":
    return _bounded((fact.value - Decimal("50")) * Decimal("2")), "altcoin_season_centered_v1"
```

This prevents a generic signal score from replacing the documented rotation formula.

- [ ] **Step 5: Run focused tests and confirm they pass**

Run the Step 2 command. Expected: only the 90-day horizon enters the ledger, centered scores are exact, ETF facts cannot leak across assets, and the 12-input cap still passes.

- [ ] **Step 6: Commit provider fact scoping**

```powershell
git add quant-worker/smart_insights/asset_opinion_repository.py quant-worker/smart_insights/asset_opinion_quant.py quant-worker/tests/test_asset_opinion_repository.py quant-worker/tests/test_asset_opinion_quant.py
git commit -m "feat: scope altcoin rotation and ETF evidence"
```

### Task 5: FRED M2 Four-Week Liquidity Fact

**Files:**
- Modify: `quant-worker/smart_insights/macro_registry.py`
- Modify: `quant-worker/smart_insights/metrics/macro.py`
- Modify: `quant-worker/smart_insights/asset_opinion_rules.py`
- Modify: `quant-worker/smart_insights/asset_opinion_repository.py`
- Modify: `quant-worker/collect_smart_insights.py`
- Test: `quant-worker/tests/test_smart_insights_macro_collectors.py`
- Test: `quant-worker/tests/test_smart_insights_macro_metrics.py`
- Test: `quant-worker/tests/test_smart_insights_crypto_collectors.py`
- Test: `quant-worker/tests/test_asset_opinion_repository.py`
- Test: `quant-worker/tests/test_asset_opinion_quant.py`

**Interfaces:**
- Adds raw source: FRED `M2SL` as `macro.m2_busd`, weekly, direction `+1`.
- Adds derived decision fact: `macro.m2_change_4w`, unit `PERCENT`, method `empirical_percentile_365d`, underlying IDs from current and prior FRED observations.
- Preserves: `MACRO_GROUP_COMPONENTS` and `COMPONENT_WEIGHTS`; M2 does not alter the existing macro-regime or BTC profile.

- [ ] **Step 1: Write failing registry and derived-history tests**

```python
def test_m2sl_is_allow_listed_without_changing_macro_regime_components() -> None:
    assert FRED_SERIES["M2SL"].metric_code == "macro.m2_busd"
    assert FRED_SERIES["M2SL"].direction == 1
    assert "macro.m2_change_4w" not in COMPONENT_WEIGHTS


def test_loader_derives_latest_m2_four_week_percent_change() -> None:
    rows = []
    for index in range(24):
        effective_at = NOW - timedelta(weeks=23 - index)
        row = fact_row(None, "macro.m2_busd", effective_at=effective_at)
        row.update(
            id=f"m2-{index}",
            value=Decimal("20000") + Decimal("100") * index,
            unit="USD billion",
            provider_code="fred",
            source_url="https://fred.stlouisfed.org/series/M2SL",
            signal_score=None,
            signal_percentile=None,
            raw_percentile=None,
            raw_history_count=24,
        )
        rows.append(row)
    result = load_asset_opinion_market_data(
        CountingConnection(fact_rows=rows),
        (("ADA", "crypto"),),
        ("BTC",),
        NOW,
    )
    fact = next(row for row in result.facts_for("ADA") if row.metric_code == "macro.m2_change_4w")
    assert fact.value == Decimal("22300") / Decimal("21900") - Decimal("1")
    assert len(fact.underlying_ids) == 2
    assert fact.normalization_method == "empirical_percentile_365d"
```

Add two fail-closed cases: fewer than 20 derived history points yields no signed score, and a stale/latest-future M2 observation never enters decision inputs.

Monkeypatch `collect_smart_insights.FredCollector` in a collector-builder test and assert `M2SL` requests at least 196 calendar days on an empty deployment, while every other FRED series retains `SMART_INSIGHTS_FRED_OVERLAP_DAYS`.

- [ ] **Step 2: Run focused tests and confirm M2 is absent**

```powershell
Set-Location quant-worker
& ..\.venv\Scripts\python.exe -m pytest tests/test_smart_insights_macro_collectors.py tests/test_smart_insights_macro_metrics.py tests/test_smart_insights_crypto_collectors.py tests/test_asset_opinion_repository.py tests/test_asset_opinion_quant.py -q
```

Expected: FRED registry and derived M2 fact assertions fail.

- [ ] **Step 3: Register raw and derived M2 definitions**

Add:

```python
"M2SL": _series(
    "M2SL",
    "macro.m2_busd",
    "US M2 Money Stock",
    "USD billion",
    "weekly",
    1,
)
```

Add `macro.m2_change_4w` to `_DERIVED_DEFINITIONS` with unit `%`, weekly freshness `10_080`, direction `1`, and `lookback_days=28`. Do not add it to `MACRO_GROUP_COMPONENTS`.

In `build_batch_collectors`, use `max(overlap_days, 196)` only for `M2SL`; this supplies at least 20 four-week-change observations on first collection without expanding every FRED request.

- [ ] **Step 4: Derive M2 from the bounded raw FRED history**

In the asset-opinion repository, filter current-revision `macro.m2_busd` rows, sort them by effective time, and for each current point choose the latest prior point with `effective_at <= current.effective_at - 28 days`. Compute `current / prior - 1`; reject non-positive prior values. For the latest fresh derived point, require at least 20 derived points before assigning:

```python
percentile = _percentile_rank(tuple(row.value for row in derived_history), latest.value)
signed_score = _score((Decimal("2") * percentile - Decimal("1")) * Decimal("100"))
```

Set `source_family` and `source_code` to the FRED provider, retain the latest source URL, use `m2-liquidity-change-4w-v1`, and set `underlying_ids=(previous_id, current_id)`. Append this global fact to each crypto asset before `latest_decision_facts`; do not append it for gold or equities.

Define a repository-local finite percentile helper with the same `count(value <= current) / count(values)` convention as the quant module; do not import a private quant helper across the repository boundary.

- [ ] **Step 5: Make M2 eligible for the altcoin macro pillar**

Add `macro.m2_change_4w` to `MACRO_DECISION_METRICS` and `CRYPTO_MACRO_RULES` with an input weight that participates in the existing strongest-two selection. Confirm BTC's profile weights and macro-regime component weights are byte-for-byte unchanged by their regression assertions.

- [ ] **Step 6: Run focused tests and confirm they pass**

Run the Step 2 command. Expected: M2SL collection remains API-key gated, real history yields one auditable four-week fact, insufficient or stale history remains missing, and BTC rules do not drift.

- [ ] **Step 7: Commit M2 liquidity evidence**

```powershell
git add quant-worker/smart_insights/macro_registry.py quant-worker/smart_insights/metrics/macro.py quant-worker/smart_insights/asset_opinion_rules.py quant-worker/smart_insights/asset_opinion_repository.py quant-worker/collect_smart_insights.py quant-worker/tests/test_smart_insights_macro_collectors.py quant-worker/tests/test_smart_insights_macro_metrics.py quant-worker/tests/test_smart_insights_crypto_collectors.py quant-worker/tests/test_asset_opinion_repository.py quant-worker/tests/test_asset_opinion_quant.py
git commit -m "feat: derive M2 liquidity for altcoin opinions"
```

### Task 6: Deterministic Farside TOTAL Without a Reported Total Column

**Files:**
- Modify: `quant-worker/smart_insights/collectors/farside.py`
- Test: `quant-worker/tests/test_smart_insights_crypto_collectors.py`

**Interfaces:**
- Preserves: reconciliation against a provider-reported total when the `Total` column exists.
- Adds: a deterministic daily `TOTAL` equal to the sum of validated fund rows when `Total` is absent.
- Rejects: a table with only `Date`, duplicate dates, invalid fund values, or an unreconciled reported total.

- [ ] **Step 1: Write the failing no-total SOL test**

```python
def test_farside_sol_builds_total_from_validated_fund_rows() -> None:
    markdown = """| Date | BSOL | VSOL | FSOL |
| --- | ---: | ---: | ---: |
| 12 Aug 2026 | 30.0 | 10.0 | 4.2 |
"""
    batch = FarsideEtfCollector("SOL", crawler=FakeCrawler(markdown)).collect(NOW)
    total = next(row for row in batch.observations if row.dimensions["fund"] == "TOTAL")
    assert batch.error_code is None
    assert total.value == Decimal("44200000")
    assert total.dimensions == {"asset": "SOL", "fund": "TOTAL"}
```

Add a `Date`-only table assertion with `SCHEMA_DRIFT` and retain the current bad-reported-total quarantine assertion.

- [ ] **Step 2: Run the collector test and confirm the parser rejects the missing total**

```powershell
Set-Location quant-worker
& ..\.venv\Scripts\python.exe -m pytest tests/test_smart_insights_crypto_collectors.py -q
```

Expected: the new SOL no-total case fails with schema drift.

- [ ] **Step 3: Permit an optional total while retaining validation**

When falling back to Markdown, require only `Date`. Detect `Total` case-insensitively when present. Treat every remaining header as a fund, require at least one fund, parse every fund value, and compute `reconciled = sum(fund_values.values(), Decimal("0"))`. If a reported total exists, retain `_RECONCILIATION_TOLERANCE`; otherwise publish `reconciled` as the total. Do not infer totals from a partially parsed or malformed row.

- [ ] **Step 4: Run the collector tests and confirm both paths pass**

Run the Step 2 command. Expected: BTC/ETH/SOL reported-total fixtures still reconcile, SOL without Total produces exactly one daily TOTAL, and malformed tables fail closed.

- [ ] **Step 5: Commit deterministic total construction**

```powershell
git add quant-worker/smart_insights/collectors/farside.py quant-worker/tests/test_smart_insights_crypto_collectors.py
git commit -m "feat: derive validated Farside totals"
```

### Task 7: Profile-Specific Change Conditions and UI Labels

**Files:**
- Modify: `quant-worker/smart_insights/asset_opinion_quant.py`
- Modify: `src/components/smart-insights/asset-opinion-labels.ts`
- Modify: `src/components/smart-insights/AssetOpinionDetail.tsx`
- Test: `quant-worker/tests/test_asset_opinion_quant.py`
- Test: `src/components/smart-insights/AssetOpinions.test.tsx`

**Interfaces:**
- Produces deterministic condition codes only when their matching decision input exists.
- Adds labels for `btc_trend`, `altcoin_rotation`, `etf_flow`, `broad_sentiment`, BTC returns, Altcoin Season, and M2 four-week change.
- Preserves the existing conclusion-first card, contribution chart, calculation table, and DeepSeek grounding label gate.

- [ ] **Step 1: Write failing invalidation and label tests**

```python
def test_altcoin_invalidations_reference_only_available_inputs() -> None:
    opinion = build_quant_opinion(
        asset=candidate("ETH", market="crypto"),
        bars=bars(90, symbol="ETH"),
        specialized=(
            fact("crypto.btc.return_20d", "market_bars", score="30"),
            fact("crypto.btc.return_60d", "market_bars", score="20"),
            fact("crypto.cycle.altcoin_season.index", "blockchaincenter", score=None, value="80"),
            fact("crypto.etf.net_flow_usd", "farside", score="40"),
            fact("crypto.fear_greed.index", "alternative-fng", score=None, value="60"),
        ),
        as_of=NOW,
        risk_tolerance="moderate",
    )
    assert "BTC_TREND_TURNS_NEGATIVE" in opinion.invalidation_conditions
    assert "ALTCOIN_SEASON_BELOW_75" in opinion.invalidation_conditions
    assert "ETH_ETF_FLOW_TURNS_NEGATIVE" in opinion.invalidation_conditions

    without_etf = build_quant_opinion(
        asset=candidate("ADA", market="crypto"),
        bars=bars(90, symbol="ADA"),
        specialized=tuple(
            row
            for row in opinion.facts
            if row.metric_code
            in {
                "crypto.btc.return_20d",
                "crypto.btc.return_60d",
                "crypto.cycle.altcoin_season.index",
                "crypto.fear_greed.index",
            }
        ),
        as_of=NOW,
        risk_tolerance="moderate",
    )
    assert all("ETF_FLOW" not in code for code in without_etf.invalidation_conditions)
```

In the React test, render an ETH opinion containing the new metrics and assert Vietnamese text includes `Xu hướng BTC`, `Luân chuyển Altcoin`, `Dòng tiền ETF`, and `Cung tiền M2 4 tuần`.

- [ ] **Step 2: Run Python and frontend focused tests and confirm labels are absent**

```powershell
Set-Location quant-worker
& ..\.venv\Scripts\python.exe -m pytest tests/test_asset_opinion_quant.py -q
Set-Location ..
npm test -- src/components/smart-insights/AssetOpinions.test.tsx
```

Expected: new condition codes and localized labels fail.

- [ ] **Step 3: Generate deterministic profile invalidations from decision inputs**

Change `_invalidation_conditions` to accept `stance`, `symbol`, and `decision_inputs`. Begin with the existing score-boundary condition, then append:

- `BTC_TREND_TURNS_NEGATIVE` when the average included BTC trend score is non-negative, otherwise `BTC_TREND_TURNS_POSITIVE`;
- `ALTCOIN_SEASON_BELOW_75`, `ALTCOIN_SEASON_ABOVE_75`, or `ALTCOIN_SEASON_ABOVE_25` based on the current raw index zone;
- `ETH_ETF_FLOW_TURNS_NEGATIVE`, `ETH_ETF_FLOW_TURNS_POSITIVE`, `SOL_ETF_FLOW_TURNS_NEGATIVE`, or `SOL_ETF_FLOW_TURNS_POSITIVE` based on the included asset-specific ETF normalized-score sign.

Deduplicate in insertion order. Never emit a condition when its metric is missing from `decision_inputs`.

- [ ] **Step 4: Add Vietnamese and English display labels**

Add metric labels for `crypto.btc.return_20d`, `crypto.btc.return_60d`, `crypto.cycle.altcoin_season.index`, and `macro.m2_change_4w`; add pillar labels for `btc_trend`, `altcoin_rotation`, `etf_flow`, and `broad_sentiment`; add every condition code from Step 3 to `INVALIDATION_LABELS`.

- [ ] **Step 5: Run focused tests and confirm they pass**

Run the Step 2 commands. Expected: conditions are data-backed and the existing UI displays readable labels without changing the response schema or adding a library.

- [ ] **Step 6: Commit the explainability surface**

```powershell
git add quant-worker/smart_insights/asset_opinion_quant.py quant-worker/tests/test_asset_opinion_quant.py src/components/smart-insights/asset-opinion-labels.ts src/components/smart-insights/AssetOpinionDetail.tsx src/components/smart-insights/AssetOpinions.test.tsx
git commit -m "feat: explain altcoin opinion drivers"
```

### Task 8: End-to-End Coverage, Live Source Smoke, and Performance Guard

**Files:**
- Modify: `e2e/smart-insights-asset-opinions.spec.ts`
- Modify: `docs/verification/2026-08-15-asset-opinion-performance-baseline.md`
- Verify: `scripts/benchmark-smart-insights.mjs`
- Verify: all affected Python and frontend suites

**Interfaces:**
- Exercises a 25-asset briefing containing BTC, ETH, SOL, standard altcoins, XAU, and VNINDEX.
- Records provider-smoke truth separately from deterministic E2E fixtures.
- Enforces the existing latency, payload, evidence, and Core Web Vitals budgets.

- [ ] **Step 1: Extend the E2E fixture with real contract-shaped ETH/SOL/ADA ledgers**

Give ETH and SOL `trend`, `btc_trend`, `altcoin_rotation`, `etf_flow`, and `broad_sentiment` pillars; give ADA `trend`, `btc_trend`, `altcoin_rotation`, and `broad_sentiment`. Keep each ledger at 12 or fewer inputs and each evidence list at 12 or fewer rows. Add assertions that selecting ETH shows its own ETF metric, selecting ADA does not show ETF evidence, and no stablecoin appears in the asset list.

- [ ] **Step 2: Run the targeted feature suites**

```powershell
Set-Location quant-worker
& ..\.venv\Scripts\python.exe -m pytest tests/test_asset_opinion_universe.py tests/test_asset_opinion_repository.py tests/test_asset_opinion_quant.py tests/test_asset_opinion_pipeline.py tests/test_asset_opinion_ai.py tests/test_smart_insights_briefing_pipeline_integration.py tests/test_smart_insights_macro_collectors.py tests/test_smart_insights_macro_metrics.py tests/test_smart_insights_crypto_collectors.py -q
Set-Location ..
npm test -- src/components/smart-insights/AssetOpinions.test.tsx src/lib/backend/smart-insights.test.ts src/lib/backend/smart-insights-schema.test.ts scripts/benchmark-smart-insights.test.mjs
```

Expected: all targeted tests pass.

- [ ] **Step 3: Verify live-source boundaries without inventing success**

Run the enabled public sources separately:

```powershell
.\scripts\run-smart-insights.ps1 -Schedule daily -Source blockchaincenter-altcoin-season -LiveSmoke
.\scripts\run-smart-insights.ps1 -Schedule daily -Source farside-eth-etf -LiveSmoke
.\scripts\run-smart-insights.ps1 -Schedule daily -Source farside-sol-etf -LiveSmoke
```

Run FRED only when `FRED_API_KEY` is configured:

```powershell
.\scripts\run-smart-insights.ps1 -Schedule daily -Source fred -LiveSmoke
```

Record the actual status, observation count, source timestamp, and error code. A missing FRED key or provider failure remains `Unavailable`; fixture or seeded values must not be described as live.

- [ ] **Step 4: Run the full regression suites and production build**

```powershell
npm run lint
npm test
Set-Location quant-worker
& ..\.venv\Scripts\python.exe -m pytest --basetemp .pytest-altcoin-factors -q
Set-Location ..
npm run build
```

Expected: zero lint errors, all Vitest and pytest suites pass with only documented skips, and the production build succeeds.

- [ ] **Step 5: Run production desktop/mobile E2E and collect Web Vitals**

```powershell
$env:E2E_PRODUCTION='1'
npm run test:e2e -- e2e/smart-insights-asset-opinions.spec.ts
```

Expected: desktop and 390×844 mobile cases pass; LCP is at most 2,500 ms, INP at most 200 ms, CLS at most 0.1, and the selected detail has no horizontal overflow.

- [ ] **Step 6: Verify the authenticated warm briefing benchmark attachment**

The existing Playwright case obtains cookies from its authenticated browser context, calls `benchmark(...)` for one warm-up plus 20 measured requests, applies `assertBudgets(result)`, and attaches `smart-insights-benchmark.json`. Read that attachment and record `assetCount`, `p50Ms`, `p95Ms`, `bytes`, `gzipBytes`, `maxDecisionInputs`, `maxEvidence`, `maxSupporting`, and `maxContradicting`.

```powershell
Get-ChildItem -Recurse -Filter smart-insights-benchmark.json test-results | Select-Object -ExpandProperty FullName
```

Expected: 25 assets, p95 at most 200 ms, raw response at most 250,000 bytes, gzip response at most 75,000 bytes, maximum 12 decision inputs/evidence, maximum five supporting facts, and maximum three contradicting facts. Do not commit browser cookies or write them into verification documentation.

- [ ] **Step 7: Confirm constant query count**

Run `test_batch_loader_uses_two_queries_for_one_or_twenty_five_assets` and the pipeline reuse test, then record that the market-data loader still issues exactly `BAR_QUERY` and `FACT_QUERY` for both one and 25 assets. The personalization path may change selected columns but must not add a per-asset query.

- [ ] **Step 8: Record final evidence and commit verification**

Append the exact test totals, live-smoke outcomes, benchmark numbers, query count, E2E Web Vitals, and final commit SHA to `docs/verification/2026-08-15-asset-opinion-performance-baseline.md`.

```powershell
git add e2e/smart-insights-asset-opinions.spec.ts docs/verification/2026-08-15-asset-opinion-performance-baseline.md
git commit -m "test: verify altcoin factor opinions"
```

## Final Acceptance Checklist

- [ ] ETH, SOL, and standard altcoins resolve from catalog metadata even without asset signals.
- [ ] Stablecoins never enter the 25-asset opinion universe or market-data query parameters.
- [ ] BTC weights, allowed BTC factors, and macro-regime component weights remain unchanged.
- [ ] Standard-alt and ETH/SOL profile weights sum exactly to `1.00`.
- [ ] BTC context is derived once and reused without N+1 queries.
- [ ] Only BlockchainCenter `season_90d` enters decision ledgers.
- [ ] ETH/SOL ETF evidence is asset-specific; other altcoins receive no ETF pillar.
- [ ] M2 uses real FRED history, has two underlying source IDs, and fails closed without sufficient fresh history.
- [ ] Optional macro/ETF absence lowers coverage instead of creating zero-valued evidence.
- [ ] DeepSeek receives only the bounded decision ledger and `AI đã phân tích` remains grounding-gated.
- [ ] Desktop/mobile UI shows readable Vietnamese/English factor labels and only data-backed change conditions.
- [ ] Full tests, build, live-smoke truth, constant-query guard, payload budgets, and Core Web Vitals pass.
