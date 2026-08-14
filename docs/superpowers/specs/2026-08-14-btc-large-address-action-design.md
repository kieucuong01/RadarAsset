# BTC Large-Address Action Design

## Goal

Add a BTC-only large-address activity module to `Market Pulse -> Crypto` in Smart Insights. The module uses daily snapshots and confirmed on-chain transactions to help a personal investor see whether a reviewed cohort of large BTC addresses is accumulating, distributing, transferring to known exchanges, or becoming active after dormancy.

Every published number must come from stored, attributable data. The feature may describe an evidence-backed state such as `Accumulation`, `Neutral`, or `Distribution`; it must not claim that an address is a verified investor or turn the proxy into a direct buy/sell instruction.

## Product decisions

- Asset scope: BTC only.
- Canonical update frequency: one closed daily snapshot in UTC.
- Discovery universe: ranks 1-100 from the BitInfoCharts richest-address page, with a minimum current balance of 1,000 BTC.
- Exclusions: known exchanges, custodians, mining pools, governments, and special entities such as recovery, hack, Mt. Gox, or Satoshi-labelled addresses.
- Acquisition: Scrapling discovers and refreshes the BitInfoCharts cohort; mempool.space verifies balances and obtains the on-chain transactions needed for conservative flow classification.
- Interpretation: quantitative state plus a separate confidence score, never an automatic trade recommendation.
- Presentation: preserve every existing Smart Insights block and add the new module using the current cards, typography, spacing, colors, and responsive conventions.

## Current state and constraints

The repository already contains `BitInfoChartsCollector`, per-address balance observations, labelled-entity exclusions, common-cohort balance change, entrant/exit dimensions, and the `HEURISTIC_ADDRESS_COHORT` quality flag. The BitInfoCharts source is currently disabled: on 2026-08-14, the normal Scrapling fetch received Cloudflare 403 and the bounded stealth attempt timed out. A fixture-backed parser is not evidence that the live source is available.

The existing `mempool-space` collector covers network metrics, but not the address watchlist and transaction classification defined here. This feature extends the existing Smart Insights observation and signal contracts rather than creating a separate analytics subsystem.

BitInfoCharts availability and on-chain availability are independent. If discovery is temporarily blocked, the worker may continue verifying the last validated watchlist against the blockchain while reporting that the universe is stale. It must not present the watchlist as freshly discovered.

## Chosen architecture

```text
BitInfoCharts top 100 --Scrapling--> universe discovery + exclusion rules
                                              |
                                              v
                                  validated BTC watchlist
                                              |
                                              v
mempool.space address/transaction APIs --> on-chain verifier
                                              |
                                              v
                              raw snapshots + metric observations
                                              |
                                              v
                              deterministic daily metric engine
                                              |
                                              v
                       signal snapshot + confidence calculation
                                              |
                                              v
                         existing Smart Insights API and Crypto UI
```

### 1. Universe discovery

The existing BitInfoCharts production parser remains the only discovery parser in this scope. It must:

1. accept ranks 1-100 only;
2. reject rows without a valid BTC address or balance;
3. retain addresses with at least 1,000 BTC;
4. apply the existing code-owned exclusion categories;
5. keep unresolved labels as `unknown` rather than asserting that they are individuals;
6. store source URL, observation time, parser version, raw snapshot hash, cohort version, exclusion reason, and label status.

An address can enter or leave the universe when a new validated discovery snapshot changes the ranked cohort or the label registry. These membership changes are stored explicitly and are not counted as balance accumulation.

The 1,000 BTC floor is evaluated only when accepting a new discovery snapshot. An intervening on-chain balance change does not silently rewrite cohort membership before the next validated discovery revision.

### 2. On-chain verifier

For every active watchlist address, the worker retrieves the current confirmed chain balance and new confirmed transactions since the previous accepted snapshot. Requests use bounded pagination, provider-aware rate limiting, retry with backoff, response-size limits, and a per-run deadline. A single failed address does not fail the entire batch.

The verifier stores only the raw provider artifacts and normalized facts required for replay and calculation. It does not mirror full blockchain history. Recent transaction pagination stops once it reaches the previous accepted snapshot cutoff. If the cutoff cannot be reached within configured bounds, that address receives incomplete transaction coverage and its flows are excluded from the composite score.

Confirmed address balance is derived from funded output value minus spent output value. Transactions below the confirmation policy remain visible as pending evidence but do not enter the daily score. The default publication policy is at least six confirmations at the daily cutoff; the applied confirmation count is stored with every flow observation.

### 3. Entity and exchange labels

The first release uses a reviewed, code-owned registry of known exchange and excluded-entity addresses. Every label entry contains:

```text
address
entity_name
entity_type
source_url
reviewed_at
registry_version
confidence: verified | reviewed | heuristic
```

Only `verified` and `reviewed` exchange labels may classify exchange flow. Heuristic and unknown counterparties remain `unknown`. Updating labels creates a new registry version so historical results remain reproducible. An administrative label-management UI is outside this scope.

### 4. Persistence and publication

Reuse the existing Smart Insights data contracts:

- `InsightRawSnapshot` for BitInfoCharts and mempool.space provider artifacts;
- `MetricObservation` for per-address balances, cohort aggregates, flows, breadth, concentration, dormant events, coverage, and diagnostics;
- `SignalSnapshot` for the daily composite state and confidence;
- the existing data-health path for enabled/disabled, freshness, parser version, and last-run status.

The daily job is idempotent. The natural observation identity remains metric, provider, BTC asset, effective UTC day, and canonical dimensions. A revised provider artifact creates a new immutable revision; the active query selects the latest validated revision available at replay time.

## Metric definitions

All balance comparisons use the intersection of addresses present in both comparison snapshots. This `common cohort` rule prevents membership churn from appearing as accumulation or distribution. Entrants and exits are reported separately.

### Net accumulation

For horizon `h` in 1, 7, or 30 valid daily observations:

```text
common_h = addresses(current) intersection addresses(t-h)
net_accumulation_h = sum(balance_current[a] - balance_t-h[a] for a in common_h)
```

The metric is unavailable until both endpoints exist and meet coverage requirements. It is denominated in BTC and accompanied by the common address count and common-cohort balance coverage.

### Accumulation breadth

For each common-cohort address:

```text
material_threshold[a] = max(10 BTC, 0.1% * balance_t-h[a])
```

An address is accumulating when its change exceeds the threshold, distributing when its change is below the negative threshold, and unchanged otherwise.

```text
accumulation_breadth_h = accumulating_count / common_address_count
distribution_breadth_h = distributing_count / common_address_count
```

### Direct exchange flows

A `large address -> exchange` flow requires a tracked address among the transaction inputs and a reviewed exchange address among the outputs. An `exchange -> large address` flow requires a reviewed exchange address among the inputs and a tracked address among the outputs.

At transaction level, attributed flow is capped by both the tracked address's confirmed net decrease or increase and the value directly connected to the reviewed exchange side. The transaction is deduplicated by transaction ID before daily aggregation. Change, self-transfer, multi-entity, and unresolved counterparties are not guessed; unassignable value remains `unknown`.

```text
exchange_flow_pressure = large_to_exchange_btc - exchange_to_large_btc
```

A positive value is potential distribution pressure. A negative value is potential accumulation pressure. It is not proof of a sale or purchase.

### Dormant activation

An address activates from dormancy when it has no confirmed outgoing transaction for at least 180 days and then sends at least 10 BTC. The event includes destination classification and attributed amount.

The feature does not infer dormancy on a new address without sufficient history. It requires either 180 days of continuous accepted platform observations or a validated historical backfill reaching the last outgoing transaction. Until then, dormant status is `unavailable`.

### Concentration

```text
top_10_concentration = sum(balance of top 10 active cohort addresses)
                       / sum(balance of all active cohort addresses)
```

The UI labels this as `Top 10 / tracked Top 100`, not as a share of all BTC supply. The metric includes the active cohort size and its change from the prior accepted snapshot.

### Entrants and exits

Publish entrant count, entrant balance, exit count, and exit balance for every universe revision. These values explain cohort changes but do not enter net accumulation or the composite score.

## Whale Action Score

The UI label is `Whale Action Score`, followed by the qualifier `large-address proxy`. The methodology and tooltips use `large address` consistently and never use phrases such as `whale bought` or `whale sold`.

The score combines four directional components:

| Component | Weight | Positive direction |
|---|---:|---|
| Common-cohort 1D net accumulation | 35% | balance accumulation |
| Daily exchange flow pressure | 30% | net exchange-to-large-address flow |
| 1D accumulation breadth | 20% | more addresses accumulating |
| Daily dormant flow direction | 15% | reviewed exchange-to-dormant-address value exceeds dormant-address-to-reviewed-exchange value |

Each component uses its daily value and a trailing 90-valid-day robust z-score. The robust z-score is `(x - median) / (1.4826 * MAD)`, winsorized to `[-3, 3]`, then divided by three to map it to `[-1, 1]`. When MAD is zero, calculation falls back to the ordinary trailing mean and standard deviation; when both dispersions are zero, an unchanged current value maps to zero and a non-comparable value is unavailable. Exchange flow pressure is sign-inverted so exchange outflow contributes positively. Unknown dormant destinations are neutral, not positive. A valid day with no qualifying dormant event publishes a zero dormant-flow value rather than missing data.

```text
raw_score = 100 * (
    0.35 * accumulation_component
  + 0.30 * exchange_flow_component
  + 0.20 * breadth_component
  + 0.15 * dormant_component
)
```

The displayed score is clamped to `[-100, 100]`:

- `30` to `100`: Accumulation
- `-29` to `29`: Neutral
- `-100` to `-30`: Distribution

The score is unavailable until at least 30 valid daily observations exist for every required component. From day 30 through day 89 it carries a `CALIBRATING` flag; at 90 valid days it becomes fully calibrated. Raw balances and available horizon metrics appear before the composite score becomes eligible.

## Data Confidence Score

Confidence is separate from direction and does not silently shrink or improve the raw action score.

| Confidence component | Weight |
|---|---:|
| Accepted address-balance coverage | 30% |
| Complete transaction-window coverage | 25% |
| Reviewed-label coverage of attributable flows | 25% |
| Universe freshness and continuity | 20% |

Each component is on `[0, 1]`; the weighted result is shown on `[0, 100]`. Confidence below 60 suppresses the directional label and composite score while preserving attributable raw metrics. Snapshot address coverage below 90% adds `PARTIAL_ADDRESS_COVERAGE`. A discovery snapshot older than its 48-hour SLA adds `STALE_UNIVERSE` and lowers only the universe component.

When no counterparty-relevant transfer occurred on a valid day, reviewed-label coverage is 1 because no unresolved value was required for classification, and both exchange-flow directions are zero. When transfers occurred, label coverage is reviewed-attributable external value divided by all external value considered for the tracked cohort.

## UI design

Add `BTC Large-Address Activity` inside the existing Crypto Market Pulse layout without removing, renaming, or restyling existing blocks.

### Summary row

- Whale Action Score with `large-address proxy` qualifier;
- state label: Accumulation, Neutral, Distribution, Calibrating, or Unavailable;
- Data Confidence Score;
- last on-chain update, last universe refresh, and data-status badge.

### Primary chart

- 30-day and 90-day views;
- bars for daily common-cohort net accumulation;
- overlay line for accumulation breadth;
- 1D, 7D, and 30D horizon summary controls.

### Exchange-flow chart

- green bars for exchange-to-large-address flow;
- red bars for large-address-to-exchange flow;
- line for exchange flow pressure;
- tooltip with BTC amount, confirmed transaction count, label coverage, and confidence.

### Structure chart

- Top 10 / tracked Top 100 concentration line;
- counts of accumulating, distributing, and unchanged addresses;
- entrants and exits displayed separately from balance change.

### Activity table

Rows contain shortened address, confirmed balance change, action type, reviewed counterparty or `unknown`, dormant days when eligible, transaction time, source link, and confidence. Transaction links open the configured blockchain explorer.

### Data-state rules

- `Live`: current accepted on-chain data and universe within SLA.
- `Delayed`: expected daily cutoff has passed but the current accepted snapshot is still inside the stale boundary.
- `Stale`: source or universe has exceeded its SLA.
- `Dữ liệu mẫu`: explicit demo rows only; never mixed with live charts or score calculations.
- `Unavailable`: insufficient or rejected data; no fabricated fallback.

On mobile, KPI cards use the existing horizontal overflow pattern, charts remain full-width, and the activity table becomes stacked cards. Existing Smart Insights blocks retain their current responsive behavior.

## Scheduling, failure handling, and source enablement

The worker runs after the closed UTC-day cutoff. Collection, validation, and publication remain separate:

1. refresh the universe when due;
2. load the latest validated watchlist;
3. fetch confirmed balances and transactions;
4. quarantine malformed or incomplete provider results;
5. publish accepted observations atomically;
6. calculate eligible horizons, score, and confidence;
7. refresh API data-health and UI output.

Failures are isolated by provider and address. Retryable rate limits and provider errors use bounded backoff. Invalid data cannot replace the last known-good observation. No forward-filled balance is stamped as a new observation.

`bitinfocharts-top-addresses` remains disabled until a bounded live smoke reaches the real table and the production parser returns non-empty, validated current observations. The new address-verification path uses source code `mempool-btc-large-addresses` and remains disabled until migration, production-parser live smoke, and database publication smoke succeed. Enabling one source does not automatically enable the other.

## API contract

Extend the existing Crypto Market Pulse response with one optional `largeAddressActivity` object. Absence or unavailability of the module must not break existing response fields.

```text
largeAddressActivity:
  asset: BTC
  effectiveAt
  observedAt
  universeObservedAt
  score nullable
  state
  confidence
  calibrationStatus
  horizons: 1d | 7d | 30d metrics
  exchangeFlows[]
  concentrationSeries[]
  breadthSeries[]
  notableActivity[]
  entrantsExits
  coverage
  qualityFlags[]
  sources[]
  methodologyVersion
```

Every series point carries its effective time and quality status. Source items include provider code, source URL, observed time, parser or methodology version, and freshness state.

## Testing strategy

### Unit and fixture tests

- BitInfoCharts ranks, 1,000 BTC floor, exclusions, unknown labels, and source metadata;
- mempool.space address balance normalization, bounded pagination, transaction cutoff, and confirmation policy;
- conservative transaction-level exchange attribution and transaction-ID deduplication;
- common-cohort 1D/7D/30D calculations;
- material-change threshold and breadth counts;
- entrant/exit isolation;
- dormant eligibility, insufficient-history behavior, and direction classification;
- concentration denominator and zero/missing cases;
- robust normalization, composite weights, calibration floor, and score thresholds;
- confidence components, coverage gates, and stale-universe behavior;
- idempotent observation publication and replay-time revision selection.

### Contract and UI tests

- optional API extension preserves all existing Smart Insights fields;
- live, delayed, stale, calibrating, sample, partial, and unavailable states;
- charts do not combine sample and live series;
- low confidence hides the directional conclusion but leaves valid raw metrics;
- source and explorer links are present and safe;
- desktop and mobile rendering preserve all pre-existing Smart Insights blocks.

### Live qualification

Before enabling a source:

1. apply the database migration;
2. run its bounded live smoke through the production fetcher, parser, and validator;
3. verify a current effective period, non-empty expected observations, provenance, and no provider-body leak in CLI output;
4. run a database publication smoke and read the rows back through the application query path;
5. enable only that source code;
6. run an end-to-end daily collection and verify the local UI against database-backed data.

A blocked BitInfoCharts smoke is an external availability result, not permission to enable the source or substitute fixtures.

## Acceptance criteria

- BTC-only daily large-address data is stored with provenance and distinct effective, observed, and universe-refresh times.
- The Top 100, 1,000 BTC floor, and entity exclusions are deterministic and replayable.
- Common-cohort metrics cannot be distorted by entrants or exits.
- Exchange flows use reviewed direct counterparties only; unknown value remains unknown.
- The score is deterministic, point-in-time, withheld during insufficient history or confidence, and never includes seed data.
- UI prioritizes charts and tables, matches the existing style, and preserves all existing Smart Insights blocks.
- Data health distinguishes live on-chain verification from stale or unavailable universe discovery.
- Every enabled source has migration, live-smoke, publication, and application-read evidence.

## Out of scope

- ETH, SOL, or multi-chain whale tracking;
- intraday alerts or mempool websocket monitoring;
- automatic portfolio changes or trade execution;
- paid Arkham or Whale Alert integration;
- probabilistic clustering of addresses into beneficial owners;
- an administrative entity-label editor;
- bypassing provider access controls or enabling a source from fixture-only evidence.
