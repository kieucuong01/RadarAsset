# Evidence-Backed Asset Opinions Design

Date: 2026-08-15

Status: Approved direction, pending written-spec review

## 1. Objective

Replace the overlapping Smart Insights blocks `Tài sản nổi bật`, `Research run`, `Tóm tắt AI`, and
`Investor Intelligence` with one decision-oriented block: `Quan điểm AI theo tài sản`.

The block analyzes:

1. assets currently held in the user's portfolio;
2. assets in the user's watchlist;
3. the representative assets `VNINDEX`, `XAU`, and `BTC`.

Every opinion must be evidence-first. Quantitative code builds a point-in-time fact sheet before AI
is invoked. AI may interpret only those locked facts and must not invent a number, source, forecast,
or action. The result gives a general market view and a separate portfolio-aware suggestion based on
current exposure, investment horizon, and risk tolerance.

This feature is decision support for personal quantitative research. It does not place orders or
issue absolute buy/sell instructions.

## 2. Product Decisions

### 2.1 Removed user-facing blocks

The Smart Insights page no longer renders:

- `Tài sản nổi bật`;
- `Research run`;
- the standalone `Tóm tắt AI` block;
- the standalone `Investor Intelligence` block.

`ResearchRun` remains an internal provenance and audit record. Existing endpoints may remain for
backward compatibility, but the Smart Insights page does not request or display research runs.

### 2.2 Replacement block

`Quan điểm AI theo tài sản` is the single synthesis surface. It has two layers:

- **Quan điểm định lượng chung:** what the verified data says about the asset, independent of the
  user's position.
- **Quan điểm theo danh mục:** what the user should review given the position weight, concentration,
  unrealized result, horizon, and risk tolerance.

The two layers must remain visually and semantically distinct. A constructive general view does not
automatically imply increasing an already concentrated position.

### 2.3 Allowed personalized actions

The UI and stored briefing item use a fixed allow-list:

| Internal value | Vietnamese label |
|---|---|
| `HOLD` | Giữ nguyên |
| `REVIEW_INCREASE` | Theo dõi để xem xét tăng tỷ trọng |
| `REVIEW_REDUCE_RISK` | Xem xét giảm rủi ro |
| `WAIT_CONFIRMATION` | Chờ xác nhận |
| `NO_ACTION_INSUFFICIENT_DATA` | Chưa hành động — thiếu dữ liệu |

AI may explain one of these actions but may not create an exact order, position size, guaranteed
outcome, or ungrounded price target.

## 3. Asset Universe

The worker builds one deterministic, de-duplicated universe per user and effective date:

1. active portfolio positions, ordered by absolute portfolio weight descending;
2. watchlist assets not already included, ordered by the watchlist's stable creation order;
3. `VNINDEX`, `XAU`, and `BTC` when not already included.

The result is capped at 25 assets. Portfolio positions have priority over watchlist assets, which
have priority over the three representative assets. Equivalent aliases must normalize to the
canonical platform asset before de-duplication. If the cap excludes a representative, the API
reports that exclusion in universe metadata rather than silently implying full representative
coverage.

## 4. Point-in-Time Fact Sheet

### 4.1 Common market facts

Any asset with validated daily bars receives:

- 1-day, 5-day, 20-day, and 60-day return;
- position relative to MA20, MA50, and MA200;
- 20-day realized volatility and its historical percentile;
- current drawdown and drawdown percentile;
- relative strength versus the asset's configured benchmark;
- current portfolio weight, unrealized result, and concentration contribution when held.

Calculations must use only observations available at the briefing's `effectiveAt`. No revised value
or future bar may leak into a historical briefing.

### 4.2 Specialized evidence pillars

| Asset family | Specialized evidence |
|---|---|
| BTC and supported crypto | ETF flows, Fear & Greed, derivatives pressure, on-chain/network activity, large-address activity, and macro impact |
| XAU | USD pressure, real yield, trend, gold ETF or CFTC positioning when live, and macro-event risk |
| VNINDEX and Vietnamese equities | benchmark-relative strength, liquidity, breadth, foreign flow, and index trend when the underlying source has passed its live gate |

Facts keep their real publication frequency. Weekly or monthly observations are not converted into
fabricated daily observations. Each fact carries source, effective time, observed time, freshness,
unit, methodology version, and evidence ID.

Kronos BTC remains `SHADOW / NOT USED IN DECISIONS`. Its forecast, score, or evaluation result cannot
enter any fact sheet, stance, confidence, personalized action, or AI prompt for this feature.

## 5. Data Sufficiency Gate

An asset receives an actionable opinion only when all gates pass:

- at least 60 valid daily bars;
- at least three valid numeric facts;
- at least two independent source families;
- no critical input is stale, quarantined, or conflicting beyond its declared tolerance.

When a gate fails, the asset stays visible with:

- stance `INSUFFICIENT_DATA`;
- label `Chưa đủ bằng chứng`;
- action `NO_ACTION_INSUFFICIENT_DATA`;
- the exact failed gates and missing/stale inputs.

There is no seed, deterministic sample, or stale AI text fallback in this block.

## 6. Deterministic Quant Layer

The quant worker calculates versioned pillar scores before AI runs:

- trend;
- flow/liquidity;
- valuation or relative-value context when supported;
- macro sensitivity;
- sentiment/on-chain for relevant assets;
- portfolio risk and concentration.

Each pillar exposes its signed score, facts, coverage, freshness, supporting evidence IDs, and
contradicting evidence IDs. A versioned rule maps the aggregate score to a stance such as
`POSITIVE`, `CONSTRUCTIVE`, `NEUTRAL`, `CAUTIOUS`, or `NEGATIVE`.

The quant layer also calculates a data-confidence ceiling from source quality, freshness, coverage,
and validation status. AI confidence cannot exceed this ceiling. The same inputs and methodology
version must produce the same score, stance, confidence ceiling, and personalized-action candidate.

## 7. Grounded AI Layer

AI receives only the asset's validated fact sheet, deterministic scores, contradictions, portfolio
snapshot, preference snapshot, and fixed output schema. It produces:

- concise base thesis;
- the strongest supporting and contradicting facts;
- bull, base, and bear cases;
- invalidation conditions expressed with existing evidence metrics;
- a portfolio-aware explanation of the bounded personalized action.

The grounding verifier rejects the entire AI explanation when:

- a number cannot be matched to a supplied evidence value after declared display formatting;
- an evidence ID is absent or outside the active tenant's permitted bundle;
- the text changes an asset, unit, effective date, or horizon;
- supplied contradictions are omitted from a high-confidence conclusion;
- AI confidence exceeds the quant confidence ceiling;
- the text contains absolute buy/sell language, an exact order, an exact allocation, or a guaranteed
  forecast.

If AI fails or is rejected, the UI shows the validated quant view with the explicit label
`Chỉ có quan điểm định lượng`. It must not reuse an older AI explanation under a newer fact sheet.

## 8. Storage Mapping

No new database table is required. Reuse the existing models:

- `DailyBriefing` freezes organization, user, effective date/time, revision, fingerprint, portfolio
  snapshot, preference snapshot, methodology, model, prompt version, and overall status.
- `DailyBriefingItem` stores one asset per item, rank, relevance, evidence IDs, time horizon, bounded
  action, scenarios, confidence, and AI explanation status.
- `SignalSnapshot` stores the deterministic quant score and stance. Its `inputs` JSON contains the
  versioned pillar scores, gate results, coverage, freshness, fact references, and invalidation
  metrics needed to reconstruct the view.
- `AiInsight` stores accepted AI title/summary and catalyst/risk text, linked to the internal
  `ResearchRun` and briefing item.
- existing evidence records remain the authoritative source for visible numbers and provenance.

`DailyBriefingItem.affectedAssets` contains exactly one canonical symbol for this block. Quant-only
items keep `aiInsightId = null` and an explicit non-accepted `explanationStatus`.

## 9. API Contract

Extend the existing tenant-aware endpoint:

```text
GET /api/smart-insights/briefing?date=
```

It returns the current briefing fields plus `assetOpinions`. The browser must not issue a request per
asset.

```text
assetOpinions[] = {
  symbol,
  assetName,
  stance,
  quantScore,
  confidence,
  horizon,
  portfolioWeightPct,
  personalizedAction,
  pillars[],
  thesis,
  bullCase,
  baseCase,
  bearCase,
  invalidationConditions[],
  evidence[],
  dataCoverage,
  freshness,
  explanationStatus,
  failedGates[]
}
```

The Zod client contract rejects malformed values. The API selects the latest accepted briefing
revision, or a valid quant-only revision, within the requested effective day. It never exposes
ResearchRun parameters, prompts, provider credentials, raw private payloads, or runtime logs.

The Smart Insights page removes its separate Investor Intelligence and `/api/research/runs`
requests. Compatibility routes are not deleted as part of this feature.

## 10. UI Design

The implementation preserves the current Smart Insights card, typography, spacing, color, icon,
dark/light theme, and data-status styles.

### 10.1 Summary view

Desktop uses a compact comparison table. Mobile converts the same rows into labeled stacked cards.
Each asset shows:

- symbol and asset name;
- stance and confidence;
- current portfolio weight when held;
- two or three highest-value numeric facts;
- bounded personalized action;
- freshness or insufficiency state.

The selected row opens the detail panel without navigating away.

### 10.2 Asset detail

The detail panel shows:

1. general quantitative view and horizon;
2. portfolio-aware suggestion and the position/risk context behind it;
3. compact trend/flow/macro/risk charts for the selected asset only;
4. evidence table with current value, change, percentile, impact, source, and freshness;
5. bull, base, and bear cases;
6. invalidation conditions;
7. missing, stale, conflicting, quant-only, or insufficient-data notices.

Charts answer trend questions; tables support exact comparison. Color is never the only signal of
stance or freshness. Units, as-of time, source, and methodology remain visible or one disclosure
away.

## 11. Performance Design and Budgets

Performance is measured before optimization and verified again after implementation. The baseline
records the existing Smart Insights briefing endpoint p50/p95, database query count, response bytes,
browser request count, relevant JavaScript chunks, and synthetic mobile LCP/INP/CLS.

### 11.1 Request and worker path

- The page makes one briefing request for the merged block. Removing the two obsolete user-facing
  surfaces must also remove their page-load requests.
- AI and quant generation run in the background worker after upstream data jobs finish. No AI or
  cross-provider collection happens in the web request path.
- Universe, positions, watchlist, bars, evidence, and snapshots are batch-loaded for at most 25
  assets. A loop that issues one database query per asset is not permitted.
- Independent worker calculations may run with bounded concurrency. One asset failure cannot block
  or retry the whole briefing.
- Briefing publication is immutable and idempotent by user, effective date, revision, and input
  fingerprint.

### 11.2 Browser rendering

- The response contains compact summaries for every asset and sufficient detail for the selected
  asset experience without follow-up asset requests.
- The browser renders charts only for the selected asset, not for every hidden row/card.
- Reuse the project's existing charting primitives. Do not add a second heavy visualization library.
- Do not add blanket `memo` or `useMemo`. Profile first and optimize only measured expensive
  recalculations or unstable props.
- Below-fold panels may be deferred or dynamically loaded only when bundle analysis shows a material
  benefit and the loading state preserves layout dimensions.

### 11.3 Cache and tenant safety

The read response may use an ETag derived from the immutable briefing fingerprint. Any server or
client cache key includes organization, user, effective date, and revision. A personalized briefing
must never be shared across tenants or users.

### 11.4 Acceptance budgets

For the maximum 25-asset briefing under the controlled benchmark profile:

- snapshot read API server-processing p95 is at most 200 ms with a warm application and database;
- database queries remain constant with asset count and do not exceed the documented measured
  baseline plus two queries;
- `assetOpinions` keeps the total briefing JSON at or below 250 KB uncompressed and 75 KB gzip;
- the merged UI adds no initial JavaScript chunk larger than 30 KB gzip and targets no more than 10%
  growth from the measured Smart Insights initial-JS baseline;
- synthetic mobile LCP is at most 2.5 seconds, INP at most 200 ms, and CLS at most 0.1;
- no measured endpoint, interaction, or Web Vital regresses by more than 10% from baseline even when
  the absolute target is already met.

If the current baseline already exceeds an absolute budget, implementation must still avoid a
regression and record the remaining gap. Budgets may change only with documented measurements and a
reviewed reason, not by silently weakening the check.

## 12. Failure and Degradation Behavior

| Failure | Required behavior |
|---|---|
| One asset quant calculation fails | Other asset opinions publish; failed asset shows unavailable state |
| Asset fails the data gate | Show `Chưa đủ bằng chứng`; do not call AI for that asset |
| AI request fails | Publish quant-only item with explicit label |
| Grounding verification fails | Reject AI text; retain quant-only item and rejection status |
| Critical source is stale or quarantined | Exclude it from fresh coverage and fail the gate when required |
| Accepted sources conflict | Preserve both evidence rows and surface the contradiction |
| No portfolio | Show general opinions and watchlist/references; personalized layer explains that exposure is unavailable |
| Oversized response | Fail the performance contract in tests; do not silently truncate evidence needed for grounding |

## 13. Verification Strategy

### 13.1 Quant and worker tests

- Correct universe union, canonical de-duplication, representative fallback, priority, and 25-asset
  cap.
- No-lookahead calculations at historical `effectiveAt` values.
- Deterministic score, stance, confidence ceiling, and bounded action.
- Data gate fails closed for short history, too few facts, one source family, stale critical input,
  and conflicts.
- Kronos fields are rejected from fact sheets and scoring inputs.
- Batch loading maintains constant query count from 1 to 25 assets.

### 13.2 Grounding tests

- Reject invented numbers, wrong units/dates/assets, inaccessible evidence IDs, omitted supplied
  contradictions, confidence above the ceiling, and absolute buy/sell language.
- Model transport is faked in CI; tests do not depend on a live AI provider.
- AI failure and rejection both preserve deterministic output.

### 13.3 API and tenant tests

- Organization and user scope are enforced for portfolio, preferences, briefing, AI insight, and
  evidence.
- The latest accepted or valid quant-only revision is selected deterministically.
- Zod validates every asset-opinion state.
- Responses contain no ResearchRun parameters, prompt text, secret, raw private payload, or runtime
  log.
- One endpoint serves the whole merged block and response-size budgets are enforced.

### 13.4 UI and browser tests

- Removed labels and their requests are absent.
- Desktop table and mobile stacked cards preserve the current Smart Insights style.
- Selection updates the detail panel and renders only the selected asset charts.
- Loading, fresh, stale, conflicting, quant-only, unavailable, no-portfolio, and insufficient-data
  states are distinct.
- No `Dữ liệu mẫu` content appears in the new block.
- Desktop and mobile have no horizontal overflow, layout shift, or unreadable chart labels.

### 13.5 Performance verification

- Capture before/after API p50/p95, database query count, response sizes, browser request count,
  bundle chunks, and mobile Web Vitals using the same dataset and environment.
- Profile the endpoint and component render before adding an index, memoization, or code splitting.
- Use query-plan evidence before adding or changing an index.
- Add a maximum-universe benchmark or contract test so query count, payload size, and server latency
  regressions are visible in CI or release verification.

## 14. Implementation Sequence

1. Record the performance baseline and current request graph before changes.
2. Add shared asset-opinion contracts, data-gate rules, and golden tests.
3. Implement batch universe and point-in-time fact-sheet construction in the quant worker.
4. Implement deterministic pillar scores, confidence ceiling, and bounded personalized actions.
5. Add structured AI generation and grounding verification behind the quant gate.
6. Persist immutable asset items through existing briefing, signal, AI, evidence, and run models.
7. Extend the briefing API and Zod client contract without adding per-asset endpoints.
8. Replace the four obsolete page blocks with the summary table/cards and selected-asset detail.
9. Remove obsolete page requests while retaining compatible backend routes.
10. Run quant, grounding, tenant, API, UI, build, browser, and maximum-universe performance checks.
11. Compare measurements with the baseline and document any remaining budget gap before merge.

## 15. Acceptance Criteria

- Smart Insights no longer renders `Tài sản nổi bật`, `Research run`, standalone `Tóm tắt AI`, or
  standalone `Investor Intelligence`.
- `Quan điểm AI theo tài sản` covers the user's positions, watchlist, and `VNINDEX`/`XAU`/`BTC` under
  the deterministic 25-asset priority rule.
- Every displayed number resolves to a permitted evidence record with source and freshness.
- Every actionable opinion passes the minimum-history, numeric-fact, source-family, and freshness
  gates.
- Assets with inadequate data remain visible as `Chưa đủ bằng chứng`; no sample or stale AI fallback
  appears.
- General stance and portfolio-aware suggestion are visibly distinct.
- Personalized actions stay inside the allow-list and never become executable trade instructions.
- Kronos shadow output has no path into the feature's fact sheet, prompt, score, confidence, or
  suggestion.
- The page uses one merged briefing request, batch data access, and selected-asset-only chart
  rendering.
- Performance measurements meet the documented budgets or show a documented pre-existing gap with
  no regression.
- All affected quant, grounding, tenant, API, UI, build, browser, and performance checks pass before
  merge or push.
