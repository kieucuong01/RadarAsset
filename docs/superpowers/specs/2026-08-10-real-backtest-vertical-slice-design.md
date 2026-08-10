# Real Backtest Vertical Slice Design

## Goal

Replace the Quant Lab backtest demo with one reproducible, tenant-scoped MA-crossover workflow that runs through the database queue and Python worker over versioned 1D or 1H datasets for FPT, BTC/USDT, and XAU/USD.

## Scope

This slice implements the smallest complete path from normalized historical bars to rendered results. It does not add Redis, Celery, Parquet, MinIO, arbitrary rule authoring, or live trading. Those remain later scale phases from the multi-market platform design.

Representative canonical assets are:

- `VN:HOSE:FPT`, market `vn_equity`, currency `VND`, long-only, maximum gross leverage `2.0`.
- `CRYPTO:BINANCE:BTCUSDT`, market `crypto_spot`, currency `USDT`, long-only, maximum gross leverage `1.0`.
- `METAL:OTC:XAUUSD`, market `metal_spot`, currency `USD`, long-only, maximum gross leverage `1.0`.

Both `1d` and `1h` are supported. All timestamps are normalized to UTC.

## Data Model

The existing `MarketBar` table remains a compatibility projection for market cards and portfolio marking. Backtests use new immutable records:

- `DataProvider`: provider identity, terms URL, license scope, and operational status.
- `ProviderInstrument`: provider symbol mapping for a canonical `Asset`.
- `Dataset`: one canonical asset plus one timeframe and adjustment policy.
- `DatasetVersion`: immutable version metadata, coverage, row count, SHA-256 checksum, quality state, missing-bar count, source metadata, and active flag.
- `DatasetBar`: immutable normalized OHLCV row owned by one dataset version.
- `DataQualityIssue`: structured duplicate, gap, invalid-OHLC, ordering, or coverage finding.
- `QuantRunArtifact`: tenant-owned JSON artifact for `equity`, `drawdown`, `trades`, or `manifest`, including checksum and row count.

`QuantRun` gains timeframe, progress, strategy hash, selected dataset-version IDs, engine version, and artifacts. A completed run therefore points to exact immutable inputs and exact output checksums.

## Ingestion and Quality

Provider adapters normalize external rows into a shared bar contract. The production adapter boundary supports the Vnstock free package for FPT, Binance public Spot klines for BTC/USDT, and Vnstock's public market-data layer for gold/XAU. All such datasets are marked `research_only`; the UI never presents them as commercially licensed.

The publication function:

1. Sorts rows by timestamp and rejects duplicate timestamps.
2. Validates finite positive OHLC values, `low <= open/close <= high`, and non-negative volume.
3. Detects missing expected bars using market-aware calendars.
4. Computes SHA-256 over a canonical JSON representation with stable decimal formatting.
5. Creates a new immutable dataset version and bars transactionally.
6. Marks the prior version inactive only after the new version is committed.

Corrections create another version and never mutate rows used by a completed run.

## Strategy and Engine

The API accepts one strict allow-listed strategy:

```json
{
  "strategy": "ma_cross",
  "timeframe": "1d",
  "fastPeriod": 5,
  "slowPeriod": 20,
  "initialCapital": 100000,
  "feeBps": 10,
  "slippageBps": 5,
  "legs": [
    { "symbol": "FPT", "leverage": 2 },
    { "symbol": "BTC", "leverage": 1 },
    { "symbol": "XAU", "leverage": 1 }
  ]
}
```

The server clamps neither invalid leverage nor unknown values silently. It rejects them. Every leg's leverage is validated against versioned asset constraints: FPT `<=2`, BTC/XAU `<=1`. Short orders are absent from the DSL and engine.

For every asset sleeve:

- Indicators for bar `t` use closes through `t` only.
- A cross generated at bar `t` creates a pending order.
- The earliest fill is bar `t+1` open.
- Buy fill price is `open * (1 + slippageBps / 10000)`.
- Sell fill price is `open * (1 - slippageBps / 10000)`.
- Fees are applied to both sides.
- Position quantity never becomes negative.
- Crypto and XAU cannot borrow; FPT may use the requested leverage up to `2x` inside its isolated capital sleeve.

Each sleeve starts with an equal share of initial capital. Curves are aligned on the union of timestamps using last-known values for valuation only, never for execution. The worker returns real metrics, equity, drawdown, trades, and a reproducibility manifest.

## Queue and API Flow

1. `POST /api/quant/runs` authenticates the tenant, validates the payload with Zod, resolves active dataset versions, hashes the normalized strategy, and creates a queued run.
2. The Python worker atomically claims one queued run with `FOR UPDATE SKIP LOCKED`, reloads the exact dataset versions, executes the engine, and transactionally commits summary metrics plus artifacts.
3. `GET /api/quant/runs/:id` remains tenant-scoped and returns status, progress, summary metrics, and artifacts only for the active organization.
4. Quant Lab polls every two seconds while the run is queued/running and renders only returned engine artifacts. Static backtest KPIs, generated equity, and short trades are removed from the backtest tab.

## Security and Failure Handling

Trust boundaries are the HTTP payload, tenant session, provider responses, and queued JSON. The route derives organization and user IDs from the server session, validates bounded strings/numbers/arrays, and never accepts an organization ID. The worker implements an allowlist and never evaluates user code, imports a user path, or executes a shell command from parameters.

Malformed strategy, missing active dataset, checksum mismatch, invalid bars, and deterministic engine errors fail the run with stable error codes and generic UI messages. Internal stack traces are not returned by the API. Tenant filters cover runs and artifacts.

## Testing and Completion Evidence

- TypeScript unit tests cover strict submission validation, stable strategy hashing, dataset quality/checksum behavior, and market leverage constraints.
- Python golden tests hand-calculate next-open fills, fees, slippage, position quantity, PnL, and drawdown; they also prove no same-bar fill and no short position.
- Integration tests cover dataset publication immutability and tenant run/artifact isolation against a migrated test database.
- Browser E2E submits a real run, executes the worker, polls to success, and verifies rendered real metrics/trades/equity on desktop plus a mobile overflow check.
- Full Vitest, Python tests, TypeScript, ESLint, production build, migration, and security audit gates run before completion is claimed.
