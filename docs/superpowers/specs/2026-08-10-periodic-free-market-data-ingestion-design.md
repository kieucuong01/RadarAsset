# Periodic Free Market Data Ingestion Design

## Goal

Replace research fixtures as the active backtest data source with scheduled, observable, research-only ingestion for Binance Spot, Vietnamese equities through Vnstock, and XAU/USD daily data from MSN through Vnstock. The system must keep the last known-good immutable dataset active whenever an upstream source fails.

## Scope and Provider Routing

The first production-MVP universe remains intentionally small:

- `CRYPTO:BINANCE:BTCUSDT`: direct Binance public Spot klines, provider symbol `BTCUSDT`.
- `VN:HOSE:FPT`: Vnstock v4 free market-data adapter, provider symbol `FPT`.
- `METAL:OTC:XAUUSD`: Vnstock v4 commodity adapter using symbol `XAUUSD`, with MSN recorded as the upstream source.

Each asset supports `1h` and `1d`. All bars are normalized to UTC. Datasets remain marked `research_only`; no source is represented as commercially licensed. A live ingestion run never falls back to generated or fixture rows. Fixtures remain available only through an explicit test/bootstrap command and cannot become active through the scheduled ingestion entrypoint.

Free-source capabilities can change. The FPT `1h` feed is capability-probed at runtime. If it is not available, the run records `unavailable`, leaves the last good version active, and reports the condition in data health. It does not resample daily data into hourly bars.

## Architecture

The Python quant worker gains a standalone ingestion orchestrator invoked by an external scheduler. Windows Task Scheduler is the documented local/default scheduler; cron or the hosting platform's scheduled-job feature invokes the same CLI in deployment. The application does not add Redis, Celery, APScheduler, or another permanently running process for six feeds.

The implementation is split into focused units:

- Provider adapters fetch and normalize bounded external responses into the existing `Bar` contract.
- A snapshot merger combines the active immutable version with a freshly fetched overlap window and removes duplicate timestamps deterministically.
- The existing publication boundary validates quality, computes a canonical checksum, and publishes a full immutable `DatasetVersion` only when content changed.
- The ingestion orchestrator acquires a database advisory lock and processes each asset/timeframe independently.
- A run repository persists operational status without mixing ingestion operations with research-agent `ProviderRun` records.
- An authenticated data-health API and the Quant Lab dataset manifest expose actual provider, coverage, freshness, and last ingestion status.

## Scheduling and Windows

The supported commands are `all`, `hourly`, `daily`, and a single asset/timeframe selection. Defaults are:

- Hourly: invoke at minute 10 of every hour and ingest only closed `1h` bars.
- Daily: invoke at `01:15 UTC` and ingest only closed `1d` bars.
- Initial backfill: 730 calendar days for `1d` and 60 calendar days for `1h`.
- Incremental overlap: refetch 10 calendar days for `1d` and 3 calendar days for `1h`.

The overlap permits providers to correct recent bars. The merger rebuilds the complete candidate snapshot from the prior active version plus the overlap. If its checksum matches the active version, the run is `unchanged` and no new dataset version is created.

The CLI exits `0` when all selected feeds succeed, are unchanged, or are skipped because an equivalent run already owns the lock; `2` when one or more feeds fail or are unavailable while others complete; and `1` for invalid configuration or a fatal database/bootstrap error. Scheduler logs therefore distinguish partial provider degradation from an orchestration failure.

## Provider Behavior

### Binance

The adapter uses the fixed allow-listed HTTPS endpoint `https://data-api.binance.vision/api/v3/klines`. It paginates with a maximum of 1,000 rows per request, advances by the last open time, rejects non-monotonic pages, and enforces a configured maximum page count. HTTP `429` honors `Retry-After`; transient `429` and `5xx` responses receive at most three attempts with exponential backoff and jitter. Redirects are rejected.

### Vnstock and XAU/USD

The adapter imports Vnstock v4 lazily so unit tests and non-live worker commands do not contact a provider. Equity requests use `FPT`; commodity requests use `XAUUSD`, not the old `Gold` fixture label. Provider-returned frames are validated against a strict required-column allowlist and a maximum row count before normalization. Naive Vietnamese equity timestamps are interpreted in `Asia/Ho_Chi_Minh`; commodity timestamps follow the provider's documented timezone and are converted to UTC.

Live verification of Vnstock 4.0.5 showed that its commodity route uses MSN daily series. It does not provide genuine hourly XAU/USD candles: requesting `1h` only resamples daily observations. The adapter therefore records `client_provider=vnstock` and `upstream_provider=msn` for D1, while H1 returns `unsupported_timeframe`. A future keyed Dukascopy or paid fallback can replace the adapter without changing datasets or the backtest engine.

## Data Model and State Transitions

Add `MarketIngestionRun` with:

- Selected provider, canonical asset, timeframe, scheduled time, start time, and finish time.
- Status: `running`, `succeeded`, `unchanged`, `skipped`, `failed`, or `unavailable`.
- Attempt count, fetched-row count, published dataset-version ID, stable error code, sanitized error message, and JSON metadata.

Each asset/timeframe receives its own run and transaction. Before provider I/O, the orchestrator tries a PostgreSQL advisory lock derived from provider, asset, and timeframe. A busy lock produces `skipped` metadata with reason `already_running` and performs no fetch.

On success, publication and the terminal run update commit together. On provider or validation failure, the run becomes `failed` or `unavailable`, but the active dataset pointer is untouched. Orphaned `running` rows older than two hours are surfaced as stale failures by the next invocation.

## Quality, Freshness, and Product Behavior

Only closed bars are eligible for publication. Normalized rows must satisfy finite positive OHLC values, `low <= open/close <= high`, non-negative volume, unique strictly increasing timestamps, and the existing market-aware gap policy. Provider responses and merged snapshots are capped to prevent unbounded memory or database growth.

Data health reports per asset/timeframe:

- Active provider and upstream provider.
- Active dataset version, coverage, row count, checksum, and last published time.
- Last ingestion status and sanitized error code.
- Freshness: `fresh`, `stale`, `unavailable`, or `fixture`.

Freshness thresholds are 90 minutes for `1h` and 36 hours for `1d`, evaluated against the last closed-bar boundary rather than wall-clock age alone. Quant Lab displays the status and provider beside each selected dataset. A fixture version is visibly labeled and cannot be described as live.

## Security and Failure Handling

Trust boundaries are third-party HTTP responses, Vnstock-returned data frames, environment configuration, and database state. Endpoint URLs and provider symbols are code-owned allowlists, not CLI or user-provided URLs, preventing SSRF through ingestion configuration. Requests use HTTPS, bounded connect/read timeouts, redirect rejection, page/row caps, and bounded retries.

No API key is required for the selected MVP providers. Logs and stored errors exclude response bodies, environment values, connection strings, stack traces, and authentication material. SQL remains parameterized. The CLI accepts only allow-listed asset and timeframe values. Provider failures never deactivate or delete an existing good dataset.

## Testing and Completion Evidence

- Provider contract tests cover Binance pagination, `Retry-After`, retry exhaustion, non-monotonic pages, closed-bar filtering, and response caps.
- Vnstock tests use injected fake frames to cover FPT/XAU routing, timezone conversion, schema validation, capability unavailability, and the `XAUUSD` provenance correction.
- Orchestrator tests prove independent feed handling, advisory-lock behavior, unchanged-checksum skipping, overlap replacement, partial-failure exit code, and preservation of the active version after failure.
- PostgreSQL integration tests prove `MarketIngestionRun` transitions and atomic dataset publication against a migrated test database.
- TypeScript tests cover the authenticated data-health response and tenant-safe presentation of sanitized status.
- A local live smoke fetches each provider without publishing first, then publishes one bounded run. FPT `1h` may truthfully finish as `unavailable`; every other selected feed must either publish valid bars or produce a provider-specific failure with the old dataset preserved.
- Final verification includes full Python tests, database integration tests, Vitest, TypeScript, ESLint, production build, Prisma migration status, dependency audit, and local browser inspection of Quant Lab data-source labels.

## Out of Scope

- Paid provider subscriptions or Twelve Data as an automatic fallback.
- Tick, minute, or sub-hour data.
- More symbols, exchanges, commodities, or asset discovery.
- Redis, Celery, distributed queues, object storage, or Parquet.
- Automated trading or broker order submission.
- Silent synthetic gap filling or daily-to-hourly resampling.
