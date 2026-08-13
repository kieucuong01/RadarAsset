# Smart Insights Personal Decision Cockpit Design

## Goal

Turn Smart Insights from a sample-heavy overview into a personal, evidence-backed decision cockpit for non-commercial investment research. The first complete scope is Crypto, Macro, and Gold. AI Research Workbench remains the interpretation engine behind the cockpit; deterministic collectors and quant calculations remain the source of every number.

The product helps a personal investor answer four questions each day:

1. What changed materially?
2. Why does it matter to the investor's portfolio and interests?
3. What event or risk is approaching?
4. What should the investor inspect before changing an allocation?

It does not place trades, fabricate missing observations, or let an LLM invent quantitative scores.

## Current state

- Smart Insights already has the visual shell, watchlist actions, data-status badges, research-run APIs, evidence records, theses, forecasts, and tenant-aware portfolio data.
- Binance Spot, Vnstock/VCI research data, and MSN-via-Vnstock XAU daily data already enter the immutable market dataset pipeline.
- The current Smart Insights ticker, news, economic calendar, Fear & Greed value, on-chain pulse, daily thesis, and suggested actions still contain hard-coded or seeded values.
- `SmartInsights.tsx` combines data loading, sample fallbacks, state, and rendering in one large component.
- Existing sample and simulated states are useful in tests and an explicitly labelled demo environment, but they must not be used as a production-runtime fallback.

## Scope

### Included

- A source registry and scheduled collection for Crypto, Macro, and Gold.
- API-first ingestion with a private self-hosted Firecrawl sidecar for approved HTML/PDF sources.
- CryptoCraft as the primary economic-calendar source, collected through Firecrawl for internal, non-commercial research.
- Immutable raw snapshots, normalized observations, data-quality checks, lineage, freshness, and reconciliation.
- Deterministic daily metrics, signal detection, regime scores, event-risk scores, and data-confidence scores.
- AI Research Workbench synthesis constrained to validated evidence.
- Personal ranking based on interests, watchlist, portfolio exposure, time horizon, and risk preference.
- A daily briefing, market detail panels, calendar, evidence drawer, and source-health panel using the existing UI style.
- Historical briefing replay and later outcome measurement.

### Not included

- Broker connectivity, automatic order placement, or portfolio rebalancing.
- Vietnam-equity insight metrics in this phase. Existing Vietnam market ingestion remains untouched.
- Bypassing login, captcha, paywall, access controls, or `robots.txt`.
- Republishing raw third-party reports or the raw CryptoCraft calendar.
- Treating an address as a verified investor or claiming that a balance change is a confirmed whale buy or sell.
- Using AI output as a substitute for missing market data.

## Chosen architecture

Use a hybrid, API-first architecture:

```text
Official/community APIs -----+
                             +--> collector jobs --> immutable raw snapshots
Firecrawl allow-listed pages +                             |
                                                           v
                                              deterministic parsers
                                                           |
                                                           v
                                           validation + reconciliation
                                                           |
                                                           v
                                              metric observations
                                                           |
                                                           v
                                               quant signal engine
                                                           |
                                                           v
                                                evidence bundles
                                                           |
                                                           v
                                            AI Research Workbench
                                                           |
                                                           v
                                           grounding + policy verifier
                                                           |
                                                           v
                                             portfolio relevance
                                                           |
                                                           v
                                          Personal Decision Cockpit
```

Next.js remains the authentication, tenant, API, and presentation boundary. The Python quant worker owns external collection, parsing, numerical transforms, source scheduling, and research-run production. PostgreSQL remains the system of record.

Firecrawl runs as a private service reached over REST. It is not imported into the Next.js process and is not exposed publicly. The default local address is configurable through `FIRECRAWL_API_URL`; credentials, if enabled, are supplied through environment configuration. Self-hosting owns authentication, TLS, persistence, backup, capacity, monitoring, and AGPL compliance.

## Source policy

Every source is registered with:

```text
code
name
market
collection_mode: api | firecrawl | manual | disabled
license_scope: research_only | attribution_required | approved | prohibited
source_url
terms_url
schedule
freshness_sla
parser_version
quality_tier
enabled
```

Only allow-listed URLs are passed to Firecrawl. Source terms and `robots.txt` still apply even though the product is non-commercial. A collector may be technically capable of reading a page and still remain disabled by source policy.

### Initial source registry

| Domain | Source | Mode | Use |
|---|---|---:|---|
| Crypto | Binance Public Spot | API | OHLCV, price, volume, return, volatility, drawdown |
| Crypto | Alternative.me Fear & Greed | API | Daily index and history with attribution |
| Crypto | Farside BTC/ETH/SOL ETF tables | Firecrawl | Daily per-fund and total ETF flows |
| Crypto | CoinShares Digital Asset Fund Flows | Firecrawl | Weekly asset, region, and AUM flows |
| Crypto | Coin Metrics Community | API | Daily adjusted transfer and on-chain economic metrics for non-commercial research |
| Crypto | mempool.space | API | BTC fee, mempool, block, hashrate, and difficulty data |
| Crypto | DefiLlama | API | Stablecoin supply, TVL, DEX, fee, and bridge metrics supported by public endpoints |
| Crypto | Deribit public market data | API | DVOL, funding, open interest, mark/index data |
| Crypto | BitInfoCharts rich list | Firecrawl | Large-address balance-change research proxy |
| Macro | CryptoCraft Calendar | Firecrawl | Primary event calendar, actual, forecast, previous, and impact |
| Macro | BLS, BEA, Federal Reserve, NY Fed | API/file | Official releases and rates used to validate and enrich calendar observations |
| Macro | FRED | API | Selected series whose individual reuse terms permit research use |
| Macro/Gold | CFTC COT | API/file | Weekly BTC, USD, index, and gold futures positioning |
| Gold | Existing XAU research feed | API adapter | XAU/USD daily price until a stronger permitted source replaces it |
| Gold | World Gold Council | Firecrawl/manual | Gold ETF and central-bank data at the source's actual frequency |

The source registry must keep attribution and license metadata next to every observation. Provider acceptance is tested per metric; the presence of a public page is not proof that every downloadable dataset is permitted.

Before a source is enabled outside tests, a bounded opt-in live smoke must fetch the current source, parse at least one current effective period, preserve its source link, and pass the same validation path used by scheduled jobs. Fixtures prove deterministic behavior but do not prove that a live source is reachable, current, or still structurally compatible.

## Firecrawl collection rules

### General rules

- Scrape a specific allow-listed URL rather than crawling an entire domain.
- Preserve the returned source URL, final URL, HTTP metadata, Markdown/HTML/JSON, observed time, parser version, and SHA-256 content hash.
- Store screenshots only for parser debugging and only when configured; they are not displayed in the cockpit.
- Prefer deterministic table parsing. Firecrawl structured JSON extraction may assist discovery, but an LLM-extracted number is not publishable until deterministic validation succeeds.
- Do not interact with login, captcha, cookie wall requiring consent beyond normal public navigation, or access-control challenges.
- Respect provider rate limits and back off on `429` and `5xx` responses.
- Raw content is internal research evidence. The UI displays normalized facts, attribution, and links rather than republishing source pages.

### CryptoCraft Calendar

CryptoCraft is the primary calendar source for this phase.

- Crawl the current week every two hours.
- Crawl the next week every twelve hours.
- From thirty minutes before until ninety minutes after a high-impact event, retry every fifteen minutes to capture the published actual value.
- Normalize source times to UTC while retaining the source timezone and the user's display timezone.
- Create a stable event identity from normalized country/currency, event name, scheduled instant, and source detail URL; source revisions update the same event instead of creating duplicates.
- Store `event_at_utc`, `display_timezone`, `country`, `currency`, `event_name`, `impact`, `actual`, `forecast`, `previous`, `detail_url`, `source_url`, `observed_at`, and `raw_snapshot_hash`.
- Mark the source `research_only`, link back to CryptoCraft, and do not expose a bulk raw-calendar export.
- If the page is blocked or changes structure, retain the latest valid event rows with their original observation time and expose `STALE` or `UNAVAILABLE`; never invent an actual value.

## Scheduling and effective dates

The default product timezone is `Asia/Bangkok`, configurable per deployment and user. Scheduler storage and calculations use UTC.

| Data family | Canonical frequency | Effective-date rule |
|---|---:|---|
| Crypto Spot price | Existing hourly/daily schedules | Closed provider bar only |
| Crypto ETF BTC/ETH/SOL flows | Daily per trading date | One canonical observation per source trading date |
| Fear & Greed | Daily | Provider index date |
| On-chain metrics | Daily | Closed UTC day only |
| CoinShares fund flows | Weekly | Reported period end, not crawl date |
| CryptoCraft events | Event-driven plus scheduled refresh | Scheduled event time and source revision |
| Official macro series | Source release frequency | Official reference period plus release time |
| CFTC positioning | Weekly | Report date and publication date stored separately |
| Gold ETF/central-bank data | Actual source frequency | Reported period end; never interpolated to daily |

ETF, Fear & Greed, and on-chain collection are daily requirements. If a daily source has not posted the new effective date, the worker retries inside the source-specific update window. The last valid observation remains queryable but becomes stale after its freshness SLA. A late ETF update recalculates dependent signals and refreshes the briefing rather than copying the previous flow into a new date.

Every observation stores three distinct times:

- `effective_at`: the market or reporting period to which the value belongs.
- `published_at`: when the provider says it became available, when supplied.
- `observed_at`: when the platform fetched it.

## Persistence model

Reuse `DataProvider` for provider identity, terms, research-only scope, and status. Reuse `ProviderRun` for collection telemetry linked to a `ResearchRun` when a run produces research output. Reuse existing immutable `DatasetVersion` rows for price bars.

Add the following bounded models for non-bar observations:

### `InsightRawSnapshot`

```text
id
provider_id
source_url
effective_at nullable
published_at nullable
observed_at
content_hash
content_type
storage_locator
parser_version
status: fetched | validated | quarantined
error_code nullable
metadata json
```

Large raw bodies are stored as private artifacts; PostgreSQL stores a locator and checksum. A unique constraint on provider, source URL, and content hash makes fetches idempotent.

### `MetricDefinition`

```text
id
code unique
market: crypto | macro | gold
name
unit
frequency
direction
methodology_version
freshness_sla_minutes
metadata json
```

### `MetricObservation`

```text
id
metric_definition_id
provider_id
asset_id nullable
raw_snapshot_id
effective_at
published_at nullable
observed_at
value decimal
dimensions json
quality_status
quality_flags json
```

The natural uniqueness key is metric definition, provider, asset, effective time, and canonicalized dimensions. Revised provider values create a new observation revision linked to the new snapshot; queries select the latest validated revision as known at the requested replay time.

### `SignalSnapshot`

```text
id
market
asset_id nullable
effective_at
methodology_version
score decimal nullable
label
data_confidence decimal
coverage decimal
inputs json
status
created_at
```

### `UserInsightPreference`

```text
id
organization_id
user_id
markets json
assets json
base_currency
investment_horizon
risk_tolerance
alert_preferences json
updated_at
```

The active portfolio and watchlist remain authoritative for holdings and tracked assets; preferences do not duplicate positions.

### `DailyBriefing`

```text
id
organization_id
user_id
research_run_id
effective_at
timezone
model_name
prompt_version
methodology_version
status
market_summary json
data_confidence decimal
created_at
```

Workbench output continues to create `AiInsight` and `EvidenceItem` rows under the briefing's tenant-scoped `ResearchRun`. A Workbench-produced `AiInsight` must have a non-null `researchRunId`; the cockpit does not query legacy unscoped seed insights.

### `DailyBriefingItem`

```text
id
daily_briefing_id
ai_insight_id
rank
section: primary_change | risk_alert
relevance_score
relevance_components json
supporting_evidence_ids json
contradicting_evidence_ids json
affected_assets json
time_horizon
risk_scenarios json
suggested_check_template
confidence
outcomes json
created_at
```

The unique briefing/rank constraint makes ordering deterministic within a revision. Evidence IDs must belong to the same tenant-scoped research run. Outcome jobs update only the `outcomes` object; they never rewrite the original insight, ranking, or evidence set.

## Validation and publication

Collection and publication are separate steps.

1. Fetch and hash the raw response.
2. Parse into typed provider rows.
3. Validate required fields, units, timestamps, ranges, and duplicates.
4. Reconcile table totals and cross-source invariants where available.
5. Quarantine invalid snapshots without changing the active observation set.
6. Publish normalized observations in one database transaction.
7. Recalculate only the dependent metrics and signals.
8. Trigger a briefing refresh only when a materially relevant validated signal changed.

Required failure codes include:

```text
PROVIDER_UNAVAILABLE
RATE_LIMITED
ROBOTS_BLOCKED
SCHEMA_DRIFT
INVALID_RESPONSE
MISSING_REQUIRED_FIELD
INVALID_UNIT
INVALID_TIMESTAMP
DUPLICATE_CONFLICT
RECONCILIATION_FAILED
STALE_SOURCE
GROUNDING_REJECTED
```

An invalid or late source cannot overwrite the last known-good observation. Partial market availability is normal: Crypto may remain available while a Macro or Gold source is stale.

## Metric contract

Every metric returned to the application includes:

```text
metric_code
market
asset nullable
value
unit
effective_at
published_at nullable
observed_at
delta_1d nullable
delta_7d nullable
percentile nullable
z_score nullable
provider_code
source_url
methodology_version
quality_status
freshness_status: FRESH | STALE | UNAVAILABLE | CONFLICTING
```

Percentiles and z-scores use only valid, point-in-time observations available at the calculation time. Daily rolling windows contain valid daily observations, not repeated calendar-day forward fills. Input values are winsorized at the 1st and 99th percentiles only when the metric definition declares that policy.

### Common transforms

- Return: close-to-close simple return for UI; log return for volatility and correlation.
- Realized volatility: annualized standard deviation of daily log returns, using 365 for crypto and 260 for XAU research data.
- Drawdown: `close / running_peak - 1` over the declared horizon.
- Rolling z-score: `(x - rolling_mean) / rolling_std`, with a zero-variance window returning unavailable rather than zero.
- Empirical percentile: rank among valid historical observations in the declared lookback, including the current observation.
- Signed percentile score: `direction * (2 * percentile - 1) * 100`, clamped to `[-100, 100]`.
- Surprise: `actual - forecast` in the source unit.
- Surprise z-score: surprise divided by the trailing standard deviation of surprises for the same event series; unavailable until at least eight prior releases exist.

The default score lookback is three years where history exists. A metric declares a shorter fixed lookback when the provider has less history; the UI shows the applied lookback.

## Crypto metrics

### Market and regime

- BTC, ETH, and SOL return for 1D, 7D, and 30D.
- Realized volatility, 30D/90D drawdown, volume z-score, trend, and momentum.
- BTC dominance, selected-universe breadth, and BTC/ETH/SOL correlations.

### Sentiment

- Alternative.me Fear & Greed current value, 1D/7D change, and one-year percentile.
- It is labelled as a Bitcoin/market sentiment measure, not an asset-specific ETH or SOL score.

### ETF and institutional flow

- Farside per-fund and total BTC/ETH/SOL daily flow.
- Rolling 5D and 20D net flow, flow streak, flow percentile, and price-flow divergence.
- CoinShares weekly asset and regional flow, 4W/12W rolling flow, and reported AUM.

### On-chain and network

- Adjusted transfer value, MVRV, NVT, SOPR, NUPL, and supported large-transfer thresholds.
- BTC mempool backlog, recommended fees, block fees, hashrate, and difficulty.
- Stablecoin total supply and 7D/30D change.
- Supported DeFi TVL, DEX volume, fee/revenue, and bridge-flow metrics.

### Derivatives

- Funding, open interest, basis where a validated source is available, and Deribit DVOL for BTC/ETH.

### Large-address proxy

- Rich-address balance change over 1D/7D/30D after excluding known exchanges, custodians, miners, government, and other labelled entities.
- The UI calls this `Large-address balance change`, never `whale buy/sell`.
- Coverage is the share of tracked balance associated with a reviewed entity label or reviewed unknown cohort; confidence falls when label coverage is low.

## Macro metrics

- CryptoCraft event actual, forecast, previous, impact, countdown, surprise, and historical surprise z-score.
- US 2Y, 10Y, 2s10s curve, 10Y real yield, Fed Funds, SOFR, Fed balance sheet, reverse repo, and Treasury General Account when supported by permitted series.
- DXY or a permitted USD-pressure proxy and its momentum/volatility.
- CPI, Core CPI, PCE, payroll, unemployment, and GDP values and release surprises.
- CFTC positioning for BTC, gold, USD, and selected equity-index futures.
- Cross-asset rolling correlation and volatility regime.

`Event Risk Score` is non-directional on `[0, 100]`. Each upcoming event receives base severity 100/60/25 for high/medium/low impact. It is multiplied by a time factor of 1.0 inside 24 hours, 0.7 inside three days, and 0.4 inside seven days, then by portfolio sensitivity on `[0.5, 1.0]`. The market score is the maximum event score in the next seven days. Events beyond seven days do not contribute.

## Gold metrics

- XAU/USD return, momentum, realized volatility, and drawdown.
- Rolling correlation and beta to real yield, USD pressure, BTC, and selected equity benchmarks.
- CFTC managed-money net position, weekly delta, and historical percentile.
- Gold ETF holdings and flows at the source's actual frequency.
- Central-bank purchase/reserve observations at the source's actual frequency.
- Gold regime derived from momentum, real yield, USD, ETF flow, positioning, and central-bank demand.

No weekly or monthly Gold observation is interpolated into a daily fact. Its latest effective period is displayed with freshness and contributes to a daily score only while inside its metric-specific SLA.

## Deterministic scores

All input metrics are converted to signed percentile scores on `[-100, 100]`. A positive score means supportive for that market; the metric definition contains the direction. For example, higher real yields and a stronger USD are negative for Gold, while positive ETF flow is positive for the corresponding asset.

### Crypto Regime Score

```text
20% momentum
25% ETF/institutional flow
15% stablecoin/market liquidity
20% on-chain/network
10% derivatives
10% sentiment
```

### Macro Risk-Asset Regime Score

```text
30% liquidity
25% rates and real yields
20% USD pressure
15% growth/inflation surprise
10% positioning
```

Event Risk remains a separate non-directional risk score and does not get added as if it were bullish or bearish.

### Gold Regime Score

```text
20% momentum
25% real yields
20% USD pressure
15% ETF flow
10% CFTC positioning
10% central-bank demand
```

Group and market scores renormalize across available inputs only when at least 60% of the configured weight is fresh and valid. Below 60%, the score is unavailable. The UI labels scores as:

```text
[-100, -40] strongly negative
(-40, -15] negative
(-15, 15) neutral
[15, 40) constructive
[40, 100] strongly positive
```

Market-specific UI wording may translate these labels without changing thresholds.

### Data Confidence

For each input:

```text
input_confidence = quality_tier * freshness_factor * validation_factor
```

- `quality_tier`: 1.0 official/direct API, 0.85 reviewed community API, 0.70 deterministic Firecrawl table, 0.50 heuristic/address-labelled data.
- `freshness_factor`: 1.0 fresh, linearly declining to 0.5 at the SLA boundary, then 0 when stale.
- `validation_factor`: 1.0 passed, 0.7 passed with non-critical warnings, 0 for quarantined/conflicting observations.

Market Data Confidence is the configured-weighted mean of input confidence multiplied by fresh configured-weight coverage. It is reported on `[0, 100]` and caps AI confidence.

## Signal detection

A candidate signal is created when any of these conditions becomes true:

- Absolute rolling z-score is at least 2.0.
- Empirical percentile enters the bottom or top 5%.
- A market or group regime label changes.
- Flow changes sign and its magnitude is at least one trailing standard deviation.
- A high-impact event enters the next 24 hours or receives an actual value.
- Two accepted sources differ beyond the metric's declared reconciliation tolerance.
- A source becomes stale or recovers when that change affects a visible score.

Signals are deduplicated by metric/market/asset, effective time, signal type, and methodology version. Recalculation from the same immutable inputs produces the same quantitative signal.

## AI Research Workbench

The Workbench does not inspect the open web independently when generating a briefing. It receives only validated signal snapshots, metric observations, source metadata, relevant historical comparisons, and permitted evidence excerpts.

### Evidence bundle

Each candidate contains:

```text
signal_id
metric observations and calculation inputs
supporting evidence IDs
contradicting evidence IDs
source URLs and effective times
data-confidence ceiling
affected market/assets
historical percentile and comparable outcomes
```

### Structured AI output

```text
headline
what_changed
why_it_matters
supporting_evidence_ids
contradicting_evidence_ids
affected_assets
time_horizon
risk_scenarios
suggested_check_template
confidence
```

The grounding verifier rejects the entire item when:

- Any mentioned number cannot be matched exactly to an evidence observation after declared formatting.
- The model changes a unit, effective date, asset, or time horizon.
- A required evidence ID is missing or inaccessible to the active tenant.
- Contradicting evidence supplied to the model is omitted from a high-confidence conclusion.
- AI confidence exceeds Data Confidence.

If AI is unavailable or rejected, validated metrics and signals remain visible. No sample explanation replaces the failed output.

Suggested checks come from a fixed allow-list:

```text
MONITOR
REVIEW_ALLOCATION
CHECK_DRAWDOWN_OR_STOP_POLICY
REDUCE_EVENT_RISK_FOR_REVIEW
WAIT_FOR_CONFIRMATION
NO_ACTION_INSUFFICIENT_DATA
```

The AI may explain a template but may not create an order, exact trade size, guaranteed forecast, or ungrounded price target.

## Personalization

The user selects interested markets, assets, base currency, horizon, risk tolerance, and alert preferences. Watchlist and active portfolio positions supply asset interest and exposure.

Each insight receives a relevance score on `[0, 100]`:

```text
35% portfolio exposure relevance
25% signal magnitude
15% event proximity
15% explicit user interest
10% data confidence
```

- Exposure relevance is the affected absolute portfolio weight divided by the largest current absolute asset weight, capped at 100. A broad Macro signal uses the weighted sum of mapped portfolio sensitivities.
- Signal magnitude is `min(abs(z_score) / 3, 1) * 100`; regime changes and source conflicts use 100.
- Event proximity uses 100 inside 24 hours, 70 inside three days, 40 inside seven days, and zero later.
- Explicit interest is 100 for a selected market/asset, 60 for a watchlist-only match, and zero otherwise.
- Data confidence is the signal's calculated confidence.

The daily briefing selects at most three primary changes, ordered by relevance, with at most two additional risk alerts. Market Overview may show lower-relevance signals, but `Needs attention today` is personalized.

## Daily briefing and replay

The default briefing is produced at 08:00 in the deployment's configured product timezone, initially `Asia/Bangkok`. Validated late ETF data or a high-impact event actual may refresh the same effective-day briefing with a new immutable revision.

Each revision freezes:

- Metric and signal IDs.
- Source snapshots and data availability known at creation time.
- Formula and methodology versions.
- Model, prompt version, structured output, and grounding result.
- Portfolio weights and preferences used for relevance.
- Final displayed briefing items.

Outcome jobs later attach 1D/7D/30D market responses without rewriting the original briefing. Evaluation reports hit rate, false-alert rate, confidence calibration, and signal outcome distribution; they do not claim causal investment performance without an explicit backtest contract.

## Personal Decision Cockpit UI

Preserve the existing visual language: rounded cards, border/background tokens, current green/red/neutral semantics, Lucide icons, current typography, responsive spacing, dark/light themes, and `DataStatusBadge`. Do not introduce a new UI library or redesign unrelated pages.

### Page order

1. **Daily Decision Brief** — market stance, three important changes, 24-hour risk, generation time, overall Data Confidence, and evidence access.
2. **Portfolio Impact** — affected allocation, assets, direction, severity, quantitative reason, and suggested checks. Without a portfolio, it prompts the user to choose markets/assets.
3. **Market Regime Strip** — Crypto, Macro, and Gold cards with regime, component scores, and Data Confidence.
4. **Market Detail Tabs** — Crypto, Macro, and Gold metric panels.
5. **CryptoCraft Calendar** — next 24 hours and seven days, impact filters, countdown, actual/forecast/previous, surprise, portfolio relevance, source attribution, and research-only badge.
6. **Evidence Drawer** — source value, formula, history, source link, effective/observed time, supporting/contradicting evidence, and quality warnings.
7. **Data Health** — provider status, latest update, freshness, API/Firecrawl mode, parser version, and latest typed failure.

Metric cards show value, delta, percentile, and freshness. Longer history and methodology open in the evidence drawer so the default page remains decision-oriented rather than becoming a dense terminal.

### Component boundary

Split the current monolith into focused components:

```text
DecisionBrief
PortfolioImpact
MarketRegimeStrip
CryptoPanel
MacroPanel
GoldPanel
EconomicCalendar
EvidenceDrawer
DataHealthPanel
```

Shared query hooks own API loading and typed error states. Components do not contain fallback market numbers. Loading, empty, stale, conflicting, partial, and unavailable states use the current design tokens.

## API boundaries

Add tenant-aware read endpoints with bounded date windows:

```text
GET /api/smart-insights/briefing?date=
GET /api/smart-insights/regimes
GET /api/smart-insights/metrics?market=&asset=&from=&to=
GET /api/smart-insights/calendar?from=&to=&impact=
GET /api/smart-insights/evidence/:id
GET /api/smart-insights/data-health
GET/PUT /api/smart-insights/preferences
```

The worker uses the existing protected research-import boundary or a purpose-built token-protected internal import endpoint for validated observation batches. Browser clients never call Firecrawl or third-party providers directly. Evidence access enforces the active tenant for user-specific research while global public market observations remain read-only.

## Error and degradation behavior

| Failure | Required behavior |
|---|---|
| Provider or Firecrawl timeout | Bounded retry with backoff; retain last valid observation |
| HTML or PDF structure change | Quarantine snapshot with `SCHEMA_DRIFT`; alert Data Health |
| Required parse field missing | Do not publish affected rows |
| ETF per-fund total mismatch | `RECONCILIATION_FAILED`; do not activate that date |
| Source exceeds freshness SLA | Show `STALE`; remove its score weight and lower confidence |
| Accepted sources conflict | Store both; show `CONFLICTING`; AI cannot silently choose |
| AI mentions ungrounded data | Reject the full briefing item |
| AI/model unavailable | Keep deterministic cockpit; explanation unavailable |
| CryptoCraft blocked | Keep timestamped last calendar, never fabricate new actuals |
| One market unavailable | Other markets continue independently |

Secrets, cookies, tokens, and full private raw payloads never enter logs or browser responses.

## Testing

### Collector contract tests

- Recorded API, HTML, and PDF fixtures; CI does not depend on live providers.
- Pagination, timeout, retry, rate-limit, redirects, malformed payload, and maximum-size behavior.
- Firecrawl allow-list enforcement and rejection of disallowed URLs.

### Parser snapshot tests

- Farside, CoinShares, BitInfoCharts, CryptoCraft, and World Gold Council fixtures.
- Schema-drift fixtures must quarantine rather than partially publish.
- Numeric locale, missing cells, table totals, revised values, duplicate rows, timezone, and unit handling.

### Quant golden tests

- Return, realized volatility, drawdown, z-score, percentile, flow windows, surprise, score direction, coverage renormalization, and Data Confidence.
- Closed-day enforcement for on-chain data and no daily forward-fill for weekly/monthly facts.
- Point-in-time replay proves no future revision leaks into an older calculation.

### Workbench grounding tests

- Unknown evidence, invented number, wrong unit, wrong date, omitted contradiction, overconfident conclusion, and disallowed suggested action are rejected.
- Model failure does not remove deterministic metrics.

### Tenant and API tests

- Preferences, portfolio exposures, evidence, and briefing revisions stay inside the active organization/user boundary.
- Query windows, validation, permissions, and internal worker-token checks fail closed.

### UI tests

- Loading, fresh, stale, conflicting, partial, unavailable, and no-portfolio states.
- Market tabs, calendar filters/countdowns, evidence drawer, source links, and responsive overflow.
- Guards assert that production runtime contains no hard-coded market values or sample insight fallback.

### End-to-end replay

Replay one frozen day from snapshots through parsing, metrics, signals, grounded briefing, personalization, and API/UI output. The same input and methodology versions must produce the same quantitative outputs.

## Observability

Data Health and operational logs expose:

- Collector success rate and duration.
- Latest effective/observed time and freshness by source.
- Retry count, rate limits, quarantined snapshots, and schema drift.
- Parser and methodology versions.
- Metric coverage and Data Confidence.
- Grounding rejection rate and briefing coverage.

Jobs are idempotent and use a lease/lock so concurrent schedulers cannot publish the same effective period twice. Job states are `queued`, `running`, `succeeded`, `failed`, or `quarantined`.

## Delivery sequence

This design is delivered as vertical slices sharing the same contracts:

1. Source registry, raw snapshots, observation schema, provenance, and freshness.
2. Private Firecrawl sidecar client, allow-listing, artifact storage, and parser framework.
3. Crypto price/sentiment/ETF/on-chain/derivatives collectors and metrics.
4. CryptoCraft Calendar and Macro collectors, event surprise, and Macro scoring.
5. Gold collectors and Gold scoring.
6. Signal engine, Data Confidence, evidence bundles, Research Workbench grounding, and replay.
7. Preferences, portfolio relevance, and briefing revisions.
8. Cockpit components, typed APIs, and removal of runtime sample values.
9. Full verification, scheduler documentation, Data Health, and end-to-end replay evidence.

Each slice must publish real validated data through its UI before the next source family is considered complete. A card backed only by a fixture remains test/demo-only and is not counted as delivery.

## Acceptance criteria

- Smart Insights production runtime contains no hard-coded or seeded market number, calendar event, thesis, or news fallback.
- Every visible metric exposes provider, source link, effective time, observation time, freshness, quality, and methodology version.
- Crypto ETF BTC/ETH/SOL flows have one canonical observation for each source trading date; Fear & Greed and on-chain observations have one canonical observation for each closed UTC calendar day.
- CoinShares and CFTC remain weekly; Gold ETF and central-bank observations keep their actual source frequency.
- CryptoCraft Calendar is collected through Firecrawl on the approved schedule and displayed as attributed, internal `research_only` normalized facts.
- Every number in an AI briefing item resolves to a permitted evidence observation.
- AI failure never causes fabricated or sample content to appear.
- Stale, conflicting, quarantined, and unavailable data are visibly distinct from fresh data.
- A failed provider cannot take down unrelated markets or the overall cockpit.
- Briefing priority changes predictably with portfolio exposure and user interests.
- Crypto, Macro, and Gold each expose real metrics, history, deterministic scores, and Data Confidence.
- A past briefing can be replayed from the observations, formula versions, portfolio snapshot, prompt version, and model identity available at that time.
- Every enabled source has passed a bounded live smoke through its production parser and validation path; fixture-only collectors remain disabled outside tests/demo.
- Contract, parser, quant, grounding, tenant, API, UI, and frozen-day replay tests pass.
