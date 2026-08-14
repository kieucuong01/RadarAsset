# WorldMonitor-Inspired Quant Intelligence Design

Date: 2026-08-14

Status: Approved direction, pending written-spec review

## 1. Objective

Extend Smart Insights into a quantitative decision cockpit for macro, crypto, gold, and energy by
adapting the strongest data and intelligence patterns demonstrated by WorldMonitor. The project will
not copy WorldMonitor source code, assets, branding, or UI implementation. RadarAsset will implement
its own collectors, metrics, APIs, and components against upstream data providers so the existing
Next.js/React architecture and visual language remain authoritative.

The first delivery must provide:

1. Macro Event Risk with measured BTC and XAU impact.
2. Energy/Oil Pulse centered on WTI, Brent, inventory, production, and oil-shock indicators.
3. Global macro context from BIS and existing FRED/CFTC data.
4. A source-health and confidence model that fails closed when evidence is stale or incomplete.
5. A Kronos shadow evaluation for BTC that cannot influence recommendations or portfolio scores.

## 2. Product Principles

- Every displayed conclusion must trace to stored observations and evidence.
- A risk score measures stress, not bullish or bearish direction.
- No panel may show seeded or fabricated values as live data.
- Missing coverage must produce `UNAVAILABLE`, `STALE`, `LIMITED DATA`, or `INSUFFICIENT DATA`.
- Multiple articles describing one event count as one event after deduplication.
- Composite signals require multiple independent source types where available.
- Raw observations, methodologies, parser versions, and calculation timestamps remain inspectable.
- Charts answer trend questions, tables support comparison, and cards summarize the few metrics that
  require immediate attention.
- The original Smart Insights blocks and styling remain. New content is organized inside tabs rather
  than replacing the old layout or creating a long single-column page.

## 3. License Boundary

WorldMonitor is an AGPL-3.0 project. RadarAsset will use its public documentation as product and
architecture research only. No WorldMonitor source file, component, stylesheet, asset, generated
client, formula implementation, or branding will be copied into RadarAsset.

Each upstream data provider receives its own source definition, terms URL, license classification,
credentials, refresh schedule, parser version, and live-smoke gate. An upstream is enabled only when
its parser passes in the intended deployment environment.

## 4. Existing Capabilities to Preserve

The implementation must reuse and preserve the current Smart Insights foundation:

- CryptoCraft economic calendar.
- Farside BTC/ETH/SOL ETF flows.
- Alternative.me Fear & Greed.
- DefiLlama stablecoin supply and chain TVL.
- mempool.space network metrics and BTC large-address monitoring.
- Coin Metrics Community on-chain observations.
- Deribit public derivatives observations.
- Existing FRED and CFTC registries, collectors, and disabled-until-smoked policy.
- Raw artifact storage, observation normalization, parser versioning, source health, evidence
  grounding, daily briefing, personalization, and data-integrity guardrails.

The implementation must not rebuild these datasets under new WorldMonitor-derived names.

## 5. Removed Integrations

`last30days`, `ai-berkshire`, and `daily_stock_analysis` are removed from:

- seed data;
- default research-import parameters;
- user-facing labels and empty-state copy;
- documentation that implies a runtime adapter exists;
- existing sample research rows through a scoped data migration.

Generic `research_runs`, `evidence_items`, `forecast_points`, `model_evaluations`, and normalized
import infrastructure remain because Macro Event Risk and Kronos require provenance and evaluation
history.

## 6. Delivery Scope

### 6.1 Global Event Risk

Initial upstream candidates are registered but disabled until live-smoked:

| Source | Purpose | Credential posture |
|---|---|---|
| GDELT | Geopolitical news and event activity | Public, no key |
| GDACS | Multi-hazard disaster alerts | Public, no key |
| USGS | Earthquake observations | Public, no key |
| NASA EONET | Natural-event corroboration | Public, no key |
| ACLED | Protest, conflict, and political violence | Free account/key |
| UCDP | Historical conflict observations | Public API subject to provider terms |
| OFAC | Sanctions actions and entities | Official public data |
| WTO | Trade restrictions and trade-policy context | Official public data |

Phase-one collection prioritizes GDELT, GDACS, USGS, and NASA EONET because they can be tested
without credentials. ACLED, UCDP, OFAC, and WTO are added only after the core event contract is
stable.

All sources normalize into an `event_observations` contract containing:

- source and source-event key;
- event type and subtype;
- occurred, first-observed, last-observed, and effective timestamps;
- country, region, coordinates, and strategic-location identifiers;
- provider severity fields and normalized severity;
- fatalities or affected-population fields when supplied by the source;
- source reliability tier, URL, and raw-artifact reference;
- parser version, quality flags, and freshness status.

Deduplication combines category, geographic distance, time distance, and normalized entity/title
similarity. A cluster stores every corroborating source but contributes one event to downstream risk
metrics.

### 6.2 Temporal Baseline and Event Risk

RadarAsset maintains rolling baselines by event type, region, weekday, and month. Welford online
mean/variance updates are used for streaming z-scores without requiring unbounded raw-history scans.
Raw observations remain in PostgreSQL for audit and event-study rebuilds.

The versioned `macro-event-risk-v1` score is deterministic:

| Component | Weight |
|---|---:|
| Provider-normalized severity | 30% |
| Event-frequency anomaly versus baseline | 25% |
| Independent source corroboration | 20% |
| Strategic relevance to energy, trade, or major economies | 15% |
| Confirming market stress in oil, gold, FX, or volatility | 10% |

The score requires at least 60% fresh-weight coverage. Below that threshold it is withheld rather
than rescaled from the remaining inputs. The methodology version and component values are returned
with every score.

### 6.3 Energy/Oil Pulse

The first official energy provider is the U.S. Energy Information Administration. Its source remains
disabled until `EIA_API_KEY` is present and a bounded production smoke passes.

The initial metric set is:

- WTI and Brent level, 1-day, 7-day, and 30-day change;
- Brent-WTI spread;
- crude-oil inventory level and weekly change;
- U.S. crude production level and weekly change;
- refinery utilization when available through the approved EIA series;
- rolling 20-day realized volatility;
- return and volatility z-scores against 90-day baselines;
- inventory surprise when CryptoCraft supplies comparable forecast and actual values.

The versioned `energy-oil-shock-v1` score is deterministic:

| Component | Weight |
|---|---:|
| Seven-day oil-return anomaly | 35% |
| Oil-volatility anomaly | 25% |
| Inventory surprise or inventory-change anomaly | 25% |
| Brent-WTI spread anomaly | 15% |

It also requires 60% fresh-weight coverage. Missing forecast data uses the inventory-change anomaly,
not a fabricated surprise.

### 6.4 Global Macro Context

BIS integrations add:

- central-bank policy rates;
- real effective exchange rates;
- credit-to-GDP gaps or ratios where the upstream series supports the requested country.

Existing FRED series continue to provide liquidity, rates, real-yield, dollar, inflation, and growth
inputs. Existing CFTC collectors continue to provide positioning. BIS data is contextual evidence in
the first version and does not alter the current `macro-risk-asset-regime-v1` weights until sufficient
history supports a separate calibration decision.

### 6.5 Supply-Chain Risk

Supply-chain intelligence is a second-phase module built after Global Event Risk and Energy/Oil Pulse
are stable. It will cover:

- official navigation warnings;
- strategic chokepoint event counts;
- public shipping-rate series available through approved official or licensed sources;
- disruption duration and geographic concentration;
- cross-confirmation with oil-price and event-risk anomalies.

Live AIS vessel tracking, military-aircraft tracking, webcams, satellites, and the WorldMonitor map
stack are outside the initial scope. A compact 2D event map may be added later as a drill-down only if
it materially improves event interpretation.

## 7. BTC and XAU Event-Impact Study

The event study measures association and historical reaction; it does not claim causality.

For each qualifying event cluster:

1. Align the event to the first tradable timestamp after `occurred_at`.
2. Use continuous UTC bars for BTC.
3. Use the next available market close for XAU when the event occurs outside its trading calendar.
4. Calculate forward return, maximum adverse excursion, maximum favorable excursion, and realized
   volatility over 1-day, 3-day, 7-day, and 30-day horizons.
5. Compare each event with matched control windows from the same asset, weekday, and volatility
   regime, excluding windows around other high-severity events.
6. Report raw return, matched-control abnormal return, sample size, median, interquartile range,
   hit rate, and deterministic bootstrap confidence intervals.

Interpretation gates:

- fewer than 5 comparable historical events: `INSUFFICIENT DATA`;
- 5 to 19 events: `THIN SAMPLE`, descriptive statistics only;
- at least 20 events: full distribution and confidence interval;
- stale asset prices or stale event sources: no new impact calculation;
- overlapping events remain visible but are flagged as confounded.

## 8. Kronos BTC Shadow Evaluation

Kronos runs as an isolated optional module in the Python quant worker. Phase one uses the MIT-licensed
Kronos-small model without fine-tuning.

### 8.1 Reproducibility

- Pin model and tokenizer revisions.
- Record file checksums, runtime version, device, model parameters, random seed, and input-data
  fingerprint for every run.
- Use only observations available at each forecast timestamp.
- Store forecast distributions in `forecast_points` and evaluation results in `model_evaluations`.

### 8.2 Evaluation

- Asset: BTC only.
- Frequency: daily first.
- Input: up to 512 point-in-time OHLCV observations.
- Forecast horizons: 1, 3, and 7 days.
- Evaluation: anchored walk-forward out-of-sample.
- Benchmarks: random walk, historical drift, simple momentum, and EMA trend.
- Metrics: MAE, MASE, directional accuracy, Spearman IC across forecast dates, interval coverage,
  calibration error, and performance by market regime.
- Minimum public evaluation history: 180 out-of-sample forecasts.

Kronos remains `SHADOW / EXPERIMENTAL` regardless of initial performance. It does not contribute to
Market Pulse, portfolio impact, AI action suggestions, alert severity, or any decision score. Moving
it out of shadow requires a later explicit product decision backed by stable out-of-sample evidence.

## 9. UI and Information Design

### 9.1 Hierarchy

Every tab follows the same hierarchy:

1. No more than four summary cards.
2. One primary chart answering the main trend question.
3. One comparison or distribution visualization.
4. A compact evidence table for detailed inspection.
5. Source health and methodology details behind progressive disclosure.

Charts and tables carry units, timezone, as-of timestamp, freshness, sample size, and methodology
version. Color is not the only state indicator; labels and icons accompany positive, negative, stale,
limited, and unavailable states.

### 9.2 Macro Quant Pulse Tabs

| Tab | Primary view | Secondary view | Detail table |
|---|---|---|---|
| Regime | Existing macro trend chart | Component contribution bars | Current macro metrics |
| Event Risk | Risk timeline by category | Category x horizon BTC/XAU heatmap | Deduplicated events |
| Energy | WTI/Brent and oil-shock trend | Inventory/production change bars | Energy observations |
| Supply Chain | Deferred until phase two | Deferred until phase two | Deferred until phase two |

### 9.3 Gold Views

- Driver cards: real yield, USD pressure, oil shock, CFTC positioning.
- Multi-series normalized trend chart for XAU, real yield, USD, and oil.
- Event-impact interval chart for 1D/3D/7D/30D reactions.
- Event-category comparison table with sample size and confidence.

### 9.4 Crypto Views

The existing Crypto tabs remain unchanged. A `Macro Link` tab adds:

- BTC versus liquidity, real yield, dollar pressure, and oil-shock normalized trends;
- BTC event-impact heatmap;
- the three highest-relevance macro events selected by the existing personalization engine;
- evidence links and sample-size warnings.

Stablecoin, mempool, ETF, on-chain, derivatives, fund-flow, and Fear & Greed content is not duplicated.

### 9.5 Kronos View

`BTC Forecast (Experimental)` contains:

- a fan chart with median and forecast intervals;
- benchmark-comparison table;
- rolling error and directional-accuracy chart;
- history table showing forecast timestamp, horizon, predicted range, realized value, and error;
- persistent `SHADOW / NOT USED IN DECISIONS` label.

### 9.6 Responsive Rules

- Desktop summary cards use a four-column maximum.
- Tablet uses two columns.
- Mobile uses one or two columns based on card content.
- Wide evidence tables become labeled stacked rows on mobile rather than unreadable horizontal
  spreadsheets.
- Tabs remain horizontally scrollable on small screens.
- No continuous ticker or animation may move fast enough to impair reading.

## 10. API and Storage Boundaries

New APIs return domain-specific views rather than exposing raw provider payloads:

- `GET /api/smart-insights/macro/events`
- `GET /api/smart-insights/macro/energy`
- `GET /api/smart-insights/macro/event-impact?asset=BTC|XAU`
- `GET /api/smart-insights/forecast/BTC?model=kronos-small`

The worker writes normalized observations and versioned calculations to PostgreSQL. API routes are
read-only and organization-scoped. Provider credentials remain server-side and never appear in API
responses or browser bundles.

## 11. Failure Handling

- Parser schema drift fails the collector without publishing partial observations.
- Network failures retain the previous snapshot with a visible stale marker when still within the
  configured stale-on-error window.
- Expired data cannot contribute to a fresh composite score.
- A missing provider key hides or disables the source rather than generating repeated failed calls.
- Conflicting source values remain separate evidence rows and set a contradiction quality flag.
- Event deduplication uncertainty is preserved; questionable clusters are not silently merged.
- Kronos model-download, checksum, inference, or input failures publish a failed provider run and no
  forecast points.
- AI summaries receive only grounded metric bundles and cannot manufacture missing scores.

## 12. Verification Strategy

### 12.1 Unit and Contract Tests

- Provider payload parsing with saved fixtures.
- Event normalization and geographic/time deduplication.
- Temporal baseline and z-score calculations.
- Event-risk and oil-shock coverage gates.
- BTC/XAU timestamp alignment and forward-return calculations.
- Matched-control selection and deterministic bootstrap intervals.
- Kronos input-window construction with explicit no-lookahead assertions.
- Mobile data-table transformation and status-label rendering.

### 12.2 Integration Tests

- Collector to raw artifact to normalized observation to signal snapshot.
- Source-health transitions: healthy, stale, failed, disabled, recovered.
- Organization scoping on all new API routes.
- Existing Crypto, Macro, Gold, daily briefing, and portfolio-impact behavior remains intact.

### 12.3 Live-Smoke Gate

For every new source:

1. register as disabled;
2. run a bounded request in the deployment environment;
3. validate schema, timestamps, units, record count, and freshness;
4. persist and read back a normalized observation;
5. verify source-health output;
6. enable only that passing source in the code-owned enabled set.

### 12.4 Browser QA

- Desktop, tablet, and mobile layouts.
- Tab navigation and evidence drill-down.
- Chart tooltips, units, timezones, and empty states.
- No seed/live ambiguity.
- No fast ticker or animation that impairs reading.
- Existing Smart Insights blocks and styling remain recognizable.

## 13. Implementation Sequence

1. Remove the three rejected integrations and scoped seed rows.
2. Add storage contracts for event observations, clusters, baselines, and event impacts.
3. Add disabled source definitions and collectors for phase-one public event sources.
4. Add EIA and BIS collectors, initially disabled.
5. Implement event normalization, deduplication, and temporal baselines.
6. Implement Energy/Oil Pulse calculations.
7. Implement BTC/XAU event-impact studies.
8. Add API view models and routes.
9. Add Macro, Gold, and Crypto tabbed chart/card/table views in the existing style.
10. Apply migrations and live-smoke each source before enabling it.
11. Implement the isolated Kronos BTC shadow runner and evaluation UI.
12. Run regression, browser, data-integrity, and performance verification before merge or push.

## 14. Acceptance Criteria

- No user-facing or seeded reference to `last30days`, `ai-berkshire`, or `daily_stock_analysis`
  remains.
- No WorldMonitor AGPL source code or asset is included in RadarAsset.
- Event Risk and Oil Pulse publish only when fresh-weight coverage is at least 60%.
- Every score exposes components, evidence, freshness, sample size, and methodology version.
- BTC/XAU impact tables distinguish insufficient, thin, and adequate samples.
- The UI prioritizes readable charts, compact comparison tables, and no more than four summary cards
  per tab.
- Existing Smart Insights blocks and styles remain recognizable.
- New sources remain disabled until their deployment live smoke passes.
- Kronos output remains visibly experimental and cannot affect any decision or portfolio signal.
- All affected unit, integration, build, and browser regression checks pass before delivery.
