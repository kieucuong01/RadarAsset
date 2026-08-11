# Portfolio Backtest Builder and Favorite Assets

**Status:** Approved design
**Date:** 2026-08-11
**Product:** RadarAsset / Financial Platform
**Scope:** Quant Lab, Portfolio Optimizer, Mock Portfolio favorites, and the quant worker

## Purpose

Quant Lab must backtest a user-defined portfolio rather than a fixed FPT, BTC, and XAU basket. The user enters one total capital amount, adds or removes any asset for which RadarAsset has a supported historical dataset, assigns an independent versioned strategy and parameter set to each asset, chooses an allocation method, and runs one reproducible portfolio backtest.

Mock Portfolio must also expose favorite assets. Favorites, current holdings, and direct asset search are convenient entry points into Quant Lab, but none of them limits the Quant Lab asset universe.

## Product Decisions

1. Quant Lab starts with no mandatory symbols. FPT, BTC, and XAU are not hard-coded legs.
2. A run contains between 1 and 10 unique assets.
3. Every asset leg has its own strategy version, normalized parameters, allocation, and leverage.
4. The user enters one positive total capital value. Leg notional is derived from allocation basis points.
5. Allocation supports equal weight, manual weight, and Portfolio Optimizer modes.
6. The optimizer changes allocation only. It never changes an asset's strategy, parameters, or leverage.
7. Quant Lab may select any system-supported asset, regardless of whether it is held or favorited.
8. A system-supported asset is an active Asset with an eligible active Dataset Version for the selected timeframe. Unavailable combinations remain visible but cannot be run.
9. Adding a favorite with no eligible dataset queues free-provider ingestion when the symbol is supported by an approved provider adapter.
10. New backtests use normalized portfolio return accounting. They do not claim to be a broker cash ledger or perform real cross-currency settlement.

## User Journeys

### Build a portfolio backtest

1. The user opens **Quant Lab > Backtest & Risk Engine**.
2. The user enters total capital, timeframe, date range, fee, and slippage.
3. The user chooses **Add asset** and searches the complete supported asset catalog.
4. The user adds one or more eligible assets and may remove any leg.
5. Each new leg receives the first runnable strategy with its default parameters and market-compliant leverage.
6. Equal allocation is applied by default.
7. The user may edit weights manually or request optimized weights.
8. The user selects a different strategy and parameters independently for each leg.
9. The UI validates allocations, datasets, strategy compatibility, parameters, warm-up, and leverage.
10. The server resolves immutable datasets and strategy versions and queues one portfolio run.
11. Results show aggregate portfolio performance and per-asset contribution, metrics, trades, and signals.

### Open Quant Lab from another surface

- A holding or favorite exposes **Backtest**.
- The action opens `/quant-lab?symbols=VNM,BTC` with those symbols preselected if they are eligible.
- The user can still add or remove assets and configure every leg before submitting.
- URL input is treated as a preference only. The server never trusts it as proof of support or authorization.

### Add a favorite

1. The user searches a symbol from Mock Portfolio.
2. RadarAsset resolves the symbol through its approved provider catalog.
3. The existing tenant-scoped Watchlist is updated; no second favorites table is introduced.
4. If data is ready, **Backtest** is enabled.
5. If data is missing but the provider supports ingestion, an idempotent ingestion request is queued and the item shows **Loading data**.
6. If no approved source supports the symbol/timeframe, the item shows **Unsupported** and cannot start a run.

## Quant Lab Builder

### Global configuration

The builder owns:

- Total capital: positive number, maximum `100,000,000,000`.
- Timeframe: `1d` or `1h`.
- Requested performance range.
- Fee in basis points, bounded to `[0, 100]`.
- Slippage in basis points, bounded to `[0, 200]`.
- Allocation mode: `equal`, `custom`, or `optimized`.

Changing timeframe or date range revalidates all legs and invalidates an older optimizer proposal. It does not silently remove a leg or replace a strategy.

### Asset leg

Every leg displays and persists:

- Asset symbol, display name, market, venue, quote currency, and data-health state.
- Allocation percentage and derived initial notional.
- Strategy code and immutable semantic version.
- Strategy parameters generated from catalog metadata.
- Leverage, bounded by both the product rule and `Asset.maxLeverage`.
- Warm-up and requested-range eligibility.
- Remove action.

Asset symbols are unique within a run. The builder supports 1 to 10 legs. Ten is an MVP safety limit for worker cost and UI clarity, not a permanent product limit.

### Allocation rules

Allocations are represented as integer basis points and must sum to exactly `10,000`.

#### Equal mode

- This is the default.
- Adding or removing a leg redistributes all basis points deterministically.
- Remainder basis points are assigned in stable symbol order so the total remains exactly `10,000`.

#### Custom mode

- Editing either percentage or notional switches the builder to custom mode.
- Notional and basis points update each other from total capital.
- Adding a leg in custom mode gives it zero basis points and leaves submission disabled until the user produces a valid total.
- Removing a leg does not silently redistribute the removed allocation.
- **Distribute equally** remains available as an explicit reset.

#### Optimized mode

- **Optimize allocation** sends the selected assets, timeframe, date range, total capital, and risk-aversion setting to the shared optimizer service.
- The optimizer uses completed historical closes from the same active immutable dataset versions that a submitted run would use.
- Returns use the overlapping data window and exclude assets without enough common observations.
- The MVP objective is long-only mean-variance utility with full investment, no borrowing, no shorting, and a maximum 70% weight per asset when more than one asset is present.
- One asset receives 100%.
- Results are rounded deterministically to basis points and repaired to sum to `10,000`.
- The optimizer returns expected return, volatility, Sharpe estimate, observation count, dataset IDs, and warnings.
- Applying the proposal sets mode to `optimized`. A later manual edit changes it to `custom`.
- If optimization fails or has insufficient overlapping data, the existing allocations remain unchanged.

The current illustrative browser-only Portfolio Optimizer is not authoritative for this flow. Its allocation math must be moved behind a shared tested engine and both tabs must consume the same API contract.

## Supported Asset Catalog

`GET /api/quant/assets?q=&timeframe=&from=&to=` returns bounded search results from the Asset, Provider Instrument, Dataset, and active Dataset Version records.

Each result includes:

- `symbol`, `name`, `market`, `venue`, `currency`, and `maxLeverage`.
- Dataset readiness for `1d` and `1h`.
- Coverage start/end, row count, freshness, and public provider attribution.
- `backtestable` plus a stable reason code when false.
- Whether ingestion can be requested.

Search is case-insensitive, paginated, and server-bounded. It does not call third-party providers on every keystroke. Provider instrument catalogs are synchronized periodically and queried locally.

An asset is eligible for a leg only when the chosen timeframe has one active, quality-passed Dataset Version with enough bars for the selected strategy warm-up and requested range. Stale data is visible and explicitly labeled; product policy decides whether it is research-runnable, but it is never presented as current.

## Backtest Contract

New submissions use a portfolio contract:

```json
{
  "timeframe": "1d",
  "from": "2025-01-01",
  "to": "2026-01-01",
  "totalCapital": 100000,
  "allocationMode": "custom",
  "feeBps": 10,
  "slippageBps": 5,
  "legs": [
    {
      "symbol": "VNM",
      "allocationBps": 3000,
      "leverage": 1,
      "strategyCode": "ma_crossover",
      "strategyVersion": "1.0.0",
      "strategyParameters": { "fastPeriod": 10, "slowPeriod": 30 }
    },
    {
      "symbol": "BTC",
      "allocationBps": 7000,
      "leverage": 1,
      "strategyCode": "turtle_breakout",
      "strategyVersion": "1.0.0",
      "strategyParameters": { "entryPeriod": 20, "exitPeriod": 10 }
    }
  ]
}
```

The server:

1. Normalizes symbols and rejects duplicates.
2. Requires 1 to 10 legs and exactly `10,000` allocation basis points.
3. Resolves each Asset, Strategy Version, and active Dataset Version.
4. Validates market/timeframe compatibility, parameters, warm-up, leverage, and range.
5. Derives leg initial notional from total capital and allocation.
6. Builds a canonical portfolio hash from sorted immutable leg descriptors and global execution settings.
7. Writes the run and all legs transactionally before queuing work.

The old single-strategy request remains readable for existing run history but is not emitted by the new UI.

## Data Model

### QuantRun

QuantRun remains the tenant-owned aggregate job and stores:

- Organization, user, status, progress, timeframe, total parameters, engine version, and aggregate metrics.
- Canonical portfolio hash.
- Allocation mode and total capital in the normalized parameters document.
- Existing top-level `strategyVersionId`, `strategyName`, and `datasetVersionIds` remain nullable compatibility fields for legacy runs.
- One-to-many `legs` relation.

### QuantRunLeg

New immutable child record:

- `id`, `quantRunId`, `assetId`, `datasetVersionId`, and `strategyVersionId`.
- `symbolSnapshot`, `marketSnapshot`, and `currencySnapshot` for durable display.
- `allocationBps`, `initialNotional`, and `leverage`.
- Normalized strategy parameters and per-leg implementation hash.
- Per-leg status, progress, metrics, and sanitized error code.
- Unique `(quantRunId, assetId)`.
- Indexes on run, asset, dataset version, and strategy version.

Referenced dataset and strategy versions use `Restrict` deletion. A run must never silently point at a replacement implementation or dataset.

### QuantRunArtifact

Artifacts gain optional `quantRunLegId` and required `scopeKey`:

- Aggregate artifacts use `scopeKey = "aggregate"` for portfolio equity, drawdown, contribution, manifest, and summary trades.
- Per-leg artifacts use `scopeKey = "leg:<quantRunLegId>"` for equity, drawdown, trades, signals, benchmark, and metrics.
- `(quantRunId, scopeKey, kind)` is unique and replaces the legacy `(quantRunId, kind)` constraint.
- `quantRunLegId` is null only for aggregate or legacy artifacts and otherwise references QuantRunLeg with cascade deletion.

Artifact payloads remain schema-versioned, checksummed, row-counted, and size-bounded.

## Worker Semantics

1. Claim one QuantRun through the existing leased queue.
2. Verify the aggregate hash and every leg's strategy/dataset hashes.
3. Run each leg with its own strategy, parameters, warm-up, leverage, fees, and slippage.
4. Scale each leg's normalized return path by its initial notional.
5. Align aggregate valuation on the union of completed timestamps, carrying only the latest completed valuation for a closed market; never synthesize OHLC bars or future prices.
6. Sum leg values into aggregate equity and compute aggregate drawdown and risk metrics.
7. Persist per-leg and aggregate artifacts idempotently.
8. Mark the aggregate run successful only when all required legs succeed. A leg failure fails the run with a stable public error and retains bounded diagnostics.

Because VN equities, crypto, and gold use different currencies and calendars, aggregate capital is labeled **normalized simulation capital**. Returns and contribution are valid dimensionless comparisons, but the MVP does not claim real FX conversion or settlement cash accounting.

## Results UI

The result screen contains:

- Aggregate equity, drawdown, total return, volatility, Sharpe, maximum drawdown, fees, and slippage.
- Allocation versus realized contribution by asset.
- Per-asset cards/tabs with strategy version, parameters, dataset version, metrics, trades, Buy/Sell markers, and Buy & Hold comparison.
- Reproducibility manifest containing all asset, dataset, strategy, allocation, and engine identifiers.
- **Apply strategy to Mock Portfolio** per successful leg, not one global strategy action.

Unavailable metrics render as unavailable, never zero. The UI distinguishes normalized simulation capital from a broker portfolio value.

## Mock Portfolio Favorites

The existing tenant-scoped Watchlist is the single source of truth for favorites.

Mock Portfolio adds a **Favorite assets** panel with:

- Search and add, remove, price, change, alert, dataset state, and ingestion state.
- **Backtest**, **Buy/Sell**, and alert actions.
- Backtest handoff through encoded symbols, with server-side revalidation in Quant Lab.

`POST /api/watchlist` becomes capable of resolving an approved provider instrument and creating the local Asset mapping when safe. If historical data is absent, it creates an idempotent ingestion request for supported free providers. `DELETE /api/watchlist/:id` removes only the tenant/user favorite and never deletes shared Asset or market data.

Favorites do not create zero-quantity Portfolio Positions and therefore cannot distort holdings, allocation, PnL, or risk metrics.

## APIs

- `GET /api/quant/assets`: supported asset search and dataset eligibility.
- `POST /api/quant/allocations/optimize`: immutable-dataset allocation proposal.
- `POST /api/quant/runs`: portfolio run creation.
- `GET /api/quant/runs/:id`: aggregate and per-leg progress/results.
- `GET /api/watchlist`: favorite assets with data and ingestion state.
- `POST /api/watchlist`: add or update a favorite and optionally queue ingestion.
- `DELETE /api/watchlist/:id`: remove a favorite within tenant/user scope.
- `POST /api/market/ingestion-requests`: idempotent on-demand ingestion for approved instruments when invoked outside watchlist creation.

All mutation routes use the existing tenant context and capability checks. Client-supplied organization, user, asset IDs, dataset IDs, and strategy IDs are ignored or rejected.

## Error Handling

Stable public error codes include:

- `ASSET_NOT_FOUND`
- `ASSET_NOT_SUPPORTED`
- `ASSET_DUPLICATE`
- `ASSET_LIMIT_EXCEEDED`
- `DATASET_UNAVAILABLE`
- `DATASET_RANGE_INSUFFICIENT`
- `DATASET_OVERLAP_INSUFFICIENT`
- `INGESTION_ALREADY_QUEUED`
- `STRATEGY_NOT_SUPPORTED_FOR_ASSET`
- `STRATEGY_PARAMETERS_INVALID`
- `ALLOCATION_TOTAL_INVALID`
- `LEVERAGE_LIMIT_EXCEEDED`
- `OPTIMIZER_UNAVAILABLE`
- `OPTIMIZER_INSUFFICIENT_DATA`
- `PORTFOLIO_RUN_FAILED`

Errors expose actionable messages but never provider response bodies, secrets, database URLs, stack traces, or cross-tenant identifiers.

## Security and Isolation

- Quant runs, legs, favorites, ingestion requests, and strategy assignments are tenant-scoped where ownership applies.
- Shared Asset, Provider Instrument, Dataset, and Strategy Version records are read-only to normal users.
- Viewers may read eligible assets and existing runs but may not create runs, favorites, ingestion requests, assignments, or transactions.
- Symbol input is normalized and validated against the local provider catalog; it is never interpolated into code, shell commands, SQL, or URLs without an adapter-owned mapping.
- Strategy execution remains allow-listed. Users cannot upload or execute notebooks or Python.
- Search, leg count, date range, parameters, artifact sizes, and optimizer observations are bounded.
- On-demand ingestion is idempotent and rate-limited per user, organization, provider, symbol, and timeframe.

## Testing

### Contract and allocation tests

- Accept arbitrary supported symbols and reject malformed or duplicate symbols.
- Require 1 to 10 legs and exactly `10,000` basis points.
- Equal allocation is deterministic, including remainder basis points.
- Custom notional and percentage remain consistent with total capital.
- Each leg validates its own strategy and parameters.
- Market and database leverage limits are both enforced.

### Optimizer tests

- Uses the exact active Dataset Version IDs returned in the proposal.
- Rejects insufficient overlap without changing existing allocation.
- Enforces long-only, full investment, and concentration bounds.
- Produces deterministic basis points summing to `10,000`.
- Portfolio Optimizer and Quant Lab consume the same optimizer contract.

### Worker tests

- Different strategies run correctly in the same portfolio run.
- Changing one leg strategy changes the canonical hash.
- Aggregate equity equals the sum of aligned leg values.
- Closed-market carry-forward never reads a future bar.
- Retry does not duplicate legs or artifacts.
- One failed leg fails the aggregate run with a stable error.

### Persistence and tenant tests

- Two organizations cannot read or mutate each other's runs, legs, favorites, ingestion requests, or assignments.
- Favorite removal cannot delete a shared Asset or Dataset.
- Provider catalog and active Dataset Version resolution are server-derived.
- Legacy runs remain readable after migration.

### Browser QA

- Empty builder, add asset, remove asset, and no fixed-symbol defaults.
- Search all system-supported assets, independent of holdings and favorites.
- Configure different strategies and parameter forms for two legs.
- Equal, custom, and optimized allocation transitions.
- Invalid totals and unavailable datasets disable submit with visible reasons.
- Favorite-to-Quant-Lab handoff and later add/remove behavior.
- Aggregate and per-leg result navigation.
- Desktop and 390px mobile layouts without page-level horizontal overflow.
- No relevant console errors or framework overlays.

## Delivery Sequence

1. Generalize symbol and per-leg strategy contracts with strict validation.
2. Add QuantRunLeg schema, migration, compatibility mapping, and tenant integration tests.
3. Add supported asset catalog API and client.
4. Build deterministic allocation helpers and shared optimizer API.
5. Replace fixed BacktestWorkbench legs with the portfolio builder UI.
6. Generalize worker dispatch and aggregate artifact generation.
7. Add aggregate and per-leg results.
8. Extend Watchlist and surface Favorite assets in Mock Portfolio.
9. Add idempotent on-demand ingestion handoff for supported free providers.
10. Run unit, integration, migration, Python, build, and browser QA before merge.

## Deferred Scope

- Broker/exchange execution and real cash settlement.
- Automatic trading from strategy signals.
- Short selling, derivatives, margin interest, and portfolio-level borrowing.
- FX conversion and multi-currency cash ledger.
- User-uploaded code or notebooks.
- Optimizer objectives beyond the shared long-only mean-variance MVP.
- More than 10 legs per run.
- Assets without an approved provider adapter and quality-passed historical data.

## Acceptance Criteria

1. Quant Lab no longer submits FPT, BTC, and XAU unless the user selected them.
2. A user can add or remove any asset returned by the system-supported asset catalog.
3. A user can configure a different runnable strategy and parameters for every selected asset.
4. Total capital can be distributed equally, edited manually, or populated by the shared Portfolio Optimizer.
5. Allocations are exact, deterministic, and validated to 100%.
6. One run persists immutable per-leg asset, dataset, strategy, allocation, leverage, and parameter identity.
7. The worker produces reproducible aggregate and per-leg results without look-ahead.
8. Results explain per-asset contribution and normalized portfolio performance.
9. Mock Portfolio favorites reuse Watchlist, can hand off to Quant Lab, and do not alter holdings or PnL.
10. Supported favorites without data can queue idempotent free-provider ingestion and show its state.
11. Legacy runs remain readable.
12. Tenant isolation, capability, migration, optimizer, worker, and browser checks pass.
