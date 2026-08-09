# Multi-Market Backtesting SaaS Design

## Goal

Evolve Quant Insight Radar into a multi-tenant SaaS where users build rule-based strategies and run reproducible backtests over Vietnamese equities, crypto spot, and XAU/USD spot using daily and hourly bars.

The initial capacity target is 500-5,000 registered users and 20-50 concurrently executing backtests. The design must preserve the existing Next.js, Prisma, PostgreSQL, and Python foundation while moving expensive compute and large time-series artifacts out of the web request path.

## Product Scope

### Included in the MVP

- Multi-tenant authentication, organizations, memberships, and data isolation.
- A visual rule builder that produces a versioned JSON strategy definition.
- Daily and hourly backtests.
- Vietnamese equities: long-only cash or margin with configurable leverage capped at 2x.
- Crypto: spot-only, long-only.
- XAU/USD: spot-only, long-only.
- Historical OHLCV ingestion through replaceable provider adapters.
- Versioned market rules, transaction costs, financing costs, datasets, strategies, and engines.
- Asynchronous execution with cancellation, retry, timeout, progress, quotas, and auditability.
- Reproducible metrics, equity curves, drawdowns, order/trade ledgers, and downloadable reports.
- Private or closed-beta operation while the platform depends on research-only or internal-use data sources.

### Explicitly excluded from the MVP

- Arbitrary user-supplied Python or JavaScript.
- Tick, order-book, or sub-hourly backtests.
- Short selling, crypto futures, perpetual funding, and derivatives.
- Live order execution or broker/exchange account connectivity.
- Portfolio optimization and AI prediction engine rewrites unrelated to backtesting.
- Kafka, Kubernetes, Ray, ClickHouse, or a general-purpose microservice platform.
- Public commercial redistribution of market data without a provider license that permits it.

## Architecture Decision

Use a control-plane and compute-plane architecture.

### Next.js control plane

Keep Next.js 16, React 19, TypeScript, Tailwind, shadcn/Radix, Recharts/ECharts, Zod, Prisma, and PostgreSQL.

The web application owns:

- Authentication and organization membership.
- Strategy authoring and validation feedback.
- Backtest submission, cancellation, history, and result presentation.
- Quota and usage presentation.
- Signed artifact download links.
- Administrative dataset and worker-health views.

The web process never runs a backtest or performs large market-data scans inside a request.

### PostgreSQL control database

PostgreSQL remains the transactional source of truth for application state, metadata, summaries, and job coordination records. Large price histories, equity curves, and trade ledgers do not live in Prisma-managed transactional tables.

The existing `MarketBar` table remains available during migration and for small UI queries. Immutable production datasets progressively move to Parquet. The app must not maintain two independent canonical datasets: every migrated bar set has one immutable `DatasetVersion`, and PostgreSQL rows are treated as a cache or compatibility projection of that version.

### Redis and Celery execution queue

Redis is the queue broker, short-lived progress store, rate-limit store, and lease/semaphore store. Celery distributes work to Linux Python workers.

Queues:

- `backtest-standard`: normal user backtests.
- `backtest-priority`: reserved for administrative or future paid-plan priority.
- `data-ingestion`: provider downloads, normalization, and validation.

Celery messages contain only a `runId`. The worker reloads the authoritative run, strategy version, dataset version, cost model, and market-rule version from PostgreSQL.

Production workers run in Linux containers. Windows local development uses Docker Desktop or WSL2 because production behavior must match the supported worker runtime.

### Python quant engine

Use Python 3.12, Polars, NumPy, DuckDB, PyArrow, and Celery. Add Numba only after profiling proves a numerical loop is a bottleneck.

The engine is a project-owned, event-driven bar simulator. A third-party backtesting framework may be used as a test oracle during development, but it is not the domain source of truth because Vietnamese margin, market rules, reproducibility, and the rule-builder DSL require explicit behavior under project control.

### Object storage

Use Cloudflare R2 through its S3-compatible API in production. MinIO is the local-development implementation. Keep storage access behind a small project-owned interface so a future provider migration does not affect the domain.

Object storage holds:

- Raw provider responses retained for provenance when terms permit.
- Normalized Parquet market datasets.
- Equity, drawdown, exposure, order, and trade artifacts.
- JSON manifests and downloadable reports.

Objects are private. The API issues short-lived signed URLs after checking organization ownership.

## Reliable Job Lifecycle

### Submission

1. The API authenticates the session and resolves organization membership server-side.
2. Zod validates the request shape and the DSL validator validates strategy semantics.
3. The API resolves immutable `StrategyVersion`, `DataBundleVersion`, `MarketRuleVersion`, `CostModelVersion`, and `EngineVersion` records.
4. The API creates `BacktestRun(status=queued)` and an `OutboxEvent` in one PostgreSQL transaction.
5. The dispatch scheduler publishes eligible outbox events to Redis and marks them delivered. Publishing is retryable.

This transactional outbox prevents a committed run from being lost if Redis is unavailable between the database commit and queue publication.

### Dispatch and fairness

One dispatch-scheduler service combines transactional-outbox delivery, fair organization scheduling, and capacity reservation. It dispatches queued runs fairly across organizations instead of allowing one organization to occupy every worker.

Default technical limits:

- Two concurrently running backtests per organization.
- Fifty queued backtests per organization.
- Fifty global execution slots.
- Ten-minute wall-clock timeout per standard run.
- Fifty instruments per run.
- Ten years of daily bars or five years of hourly bars per run.
- Five million bar events after universe and date filtering.

Limits are stored as plan configuration rather than hard-coded business entitlements. Administrators may override an organization without code changes.

Before publishing a run, the dispatch scheduler atomically reserves global and organization capacity in Redis. The reservation becomes the worker lease when the task is claimed. Redis leases have an expiry and workers renew them with heartbeats. A publish failure releases the reservation; a worker crash releases capacity after expiry. A reconciler makes an expired, non-terminal run eligible for retry. PostgreSQL remains the authoritative run state.

### Execution

1. A worker atomically claims the run only if it is still queued.
2. It claims and begins renewing the capacity lease reserved by the dispatch scheduler.
3. It verifies artifact checksums and loads only required Parquet partitions and columns.
4. It validates the normalized DSL and required lookback again.
5. It runs the deterministic simulation and periodically writes progress and heartbeats.
6. It writes artifacts to a temporary object prefix.
7. It writes a checksum manifest, promotes the completed prefix, and commits result summaries in PostgreSQL.
8. It changes the run to `succeeded`, `failed`, or `cancelled` and releases leases.

Artifact publication is atomic from the application's perspective: PostgreSQL never points to an incomplete manifest.

### State model

Allowed states are `queued`, `running`, `succeeded`, `failed`, and `cancelled`.

- Cancellation is represented by `cancelRequestedAt`; the final state becomes `cancelled` at a safe checkpoint.
- A transient infrastructure failure may retry the same run ID.
- A deterministic strategy, validation, or data error is not retried.
- Retry is idempotent and cannot create a second committed artifact set.

### Reproducibility and cache

Every run stores:

- Strategy version and normalized DSL hash.
- Data-bundle version and manifest checksum.
- Market-rule version.
- Cost-model version.
- Engine version and container image digest.
- Random seed, even when the current engine has no stochastic component.
- Submitted and effective date ranges.
- Timezone and base currency.

The run fingerprint is a SHA-256 hash of these inputs. A completed result may be reused only within the same organization. Cross-organization result reuse is disabled because a strategy is private intellectual property.

## Multi-Tenant Domain Model

### Identity and ownership

Use Better Auth with the Prisma adapter and database-backed sessions.

Add:

- `Organization`: tenant boundary.
- `Membership`: user, organization, and role.
- `PlanLimit`: configurable concurrency and usage limits.
- `UsageLedger`: append-only run and compute usage records.
- `AuditEvent`: security and administrative actions.

Every strategy, version, run, result, and artifact manifest contains `organizationId`. APIs derive this identifier from the authenticated session; they never trust an organization ID supplied by the client.

Roles in the MVP are `owner`, `admin`, `editor`, and `viewer`. Only owner/admin can manage members and organization settings. Editor can create strategies and runs. Viewer is read-only.

### Instrument catalog

Extend the existing `Asset` model rather than introduce a competing instrument table.

Add a globally unique canonical key such as:

- `VN:HOSE:FPT`
- `CRYPTO:BINANCE:BTCUSDT`
- `METAL:OTC:XAUUSD`

Instrument metadata includes venue, MIC when available, timezone, price currency, base/quote assets, tick size, quantity step, board lot, status, and provider-symbol mappings. Public APIs use asset ID or canonical key. Plain ticker symbol is presentation data and is no longer assumed globally unique.

### Strategy model

- `Strategy`: mutable identity, owner organization, name, description, and archive state.
- `StrategyVersion`: immutable normalized DSL, schema version, validation status, required warm-up bars, creation author, and hash.
- Editing a strategy always creates a new version. Historical runs never point at a mutable strategy body.

### Dataset model

- `DataProvider`: adapter name, terms URL, and operational state.
- `ProviderInstrument`: mapping from canonical asset to provider symbol.
- `Dataset`: market, timeframe, and adjustment policy identity.
- `DatasetVersion`: immutable manifest, coverage, checksum, quality result, and license scope.
- `DataBundleVersion`: immutable run-ready manifest that references all required dataset versions, FX conversion data, corporate actions, and provider mappings for a multi-market backtest.
- `DataQualityIssue`: gaps, duplicates, invalid OHLC, stale ranges, and corporate-action warnings.
- `CorporateAction`: split, cash dividend, symbol change, and effective timestamps for Vietnamese equities.

License scope is one of `research_only`, `internal_non_display`, or `commercial`. The production feature flag prevents a public commercial workspace from selecting a dataset whose scope does not permit that use.

### Execution model

- `BacktestRun`: ownership, immutable version references, status, progress, timestamps, fingerprint, cancellation request, error code, and summary metrics.
- `RunArtifact`: type, object key, checksum, byte size, row count, and schema version.
- `OutboxEvent`: reliable queue publication.
- `EngineVersion`: semantic version, Git SHA, container digest, and supported DSL versions.
- `MarketRuleVersion`: venue calendar and execution constraints.
- `CostModelVersion`: commissions, taxes, spreads, slippage, financing, and currency-conversion assumptions.

Metrics stored directly on `BacktestRun` are limited to values needed for listings and comparisons. Full time series and ledgers stay in artifacts.

## Rule-Builder DSL

The UI produces a JSON abstract syntax tree. The server normalizes key ordering and numeric representation before hashing and storage.

Top-level fields:

- `schemaVersion`
- `universe`
- `timeframe`: `1d` or `1h`
- `dateRange`
- `benchmark`
- `entry`
- `exit`
- `positionSizing`
- `portfolioConstraints`
- `riskControls`
- `execution`

### Expression system

Expressions are typed nodes, not text formulas. Supported v1 nodes include:

- Price fields: open, high, low, close, volume.
- Indicators: SMA, EMA, RSI, MACD, ATR, Bollinger Bands, rolling high/low, return, and volume average.
- Comparisons: greater/less/equal and cross above/below.
- Boolean groups: all, any, and not.
- Constants and percentage offsets.

Each indicator declares its output type and lookback. The validator rejects incompatible comparisons, recursive definitions, unknown fields, invalid periods, excessive lookbacks, and expressions whose timeframe differs from the strategy timeframe.

### Position and risk nodes

Supported v1 sizing:

- Fixed percentage of available equity.
- Equal weight across active signals.
- Volatility-targeted sizing using ATR.

Supported v1 exits and controls:

- Signal exit.
- Percentage or ATR stop loss.
- Percentage or ATR take profit.
- Maximum holding bars.
- Maximum position weight.
- Maximum portfolio gross leverage, capped at 2x for Vietnamese equities and 1x for crypto/XAU spot.
- Maximum concurrent positions.
- Cash reserve percentage.

The engine never evaluates user strings with `eval`, imports user modules, or executes user code.

## Backtest Semantics

### Clock and signal timing

All stored timestamps are UTC. Each instrument retains its venue timezone and calendar for session construction and UI display.

The default execution rule is conservative and explicit:

- Indicators at bar `t` use information available at or before bar `t` close.
- A signal generated at bar `t` may first execute at bar `t+1` open.
- No same-close fill is allowed in the MVP.
- Missing bars do not create synthetic prices. The last price may be carried only for valuation, never for execution.
- Warm-up bars are loaded before the requested start date but do not create trades or performance.

These rules prevent common look-ahead bias.

### Orders and fills

MVP order types are market-next-open, stop, and take-profit. Limit-entry authoring is deferred.

Fills apply in this order:

1. Venue/session eligibility.
2. Available cash, margin, lot size, tick size, and minimum quantity checks.
3. Base fill price from the next eligible bar.
4. Configured spread and slippage against the strategy.
5. Commissions, taxes, and other cost-model charges.

If a stop and take-profit are both reachable inside one OHLC bar and their intrabar sequence is unknowable, the engine uses the adverse outcome. The result manifest records this collision rule.

Orders that cannot be filled are rejected with a structured reason; they are never silently dropped.

### Accounting

The engine maintains cash, unsettled cash, borrowed cash, positions, average cost, realized PnL, accrued financing, fees, taxes, and marked equity.

- Vietnamese equities are long-only. Gross exposure may not exceed the lower of the user rule and the asset/market maximum of 2x.
- Margin eligibility and leverage are asset-specific, versioned inputs. Non-eligible assets remain cash-only.
- Maintenance margin and forced-liquidation behavior are versioned market rules rather than hidden constants.
- Settlement lag and unsettled-cash reuse are versioned market rules; a run is rejected if the selected Vietnamese dataset has no compatible rule version.
- Crypto and XAU/USD are spot-only with gross leverage capped at 1x. Borrowed cash created for Vietnamese-equity margin cannot fund crypto or XAU/USD orders.
- XAU/USD financing or overnight cost is applied only when present in the selected cost model.

The reporting base currency is configurable, with USD and VND supported initially. FX conversion uses a versioned dataset and records the conversion timestamp policy. USDT-quoted crypto requires either a versioned USDT/USD series or an explicit 1.0 peg assumption; the latter is recorded in the manifest and shown as a result warning.

### Corporate actions and survivorship

Vietnamese equity datasets distinguish raw and adjusted prices. A dataset manifest declares its adjustment policy.

- Splits adjust quantities and cost basis or are represented consistently in adjusted bars, never both.
- Cash dividends are explicit cash-flow events when total-return mode is enabled.
- Delisted and renamed instruments remain addressable by canonical asset ID.
- A fixed hand-selected universe is supported in the MVP.
- Point-in-time index membership and survivorship-bias-free screeners are deferred until licensed constituent history exists.

The UI warns when a universe or dataset can introduce survivorship bias.

## Market-Data Pipeline

### Adapter boundary

Each provider adapter implements discovery, historical fetch, incremental fetch, normalization, rate-limit reporting, and provenance output. Provider-specific fields do not enter the engine.

Initial research adapters:

- Vietnamese equities: `vnstock`-based research adapter or user-imported CSV.
- Crypto: Binance public Spot kline adapter.
- XAU/USD: Twelve Data or user-imported CSV.

These adapters do not imply commercial redistribution rights. The platform records terms and license scope for each dataset version and operates as a private beta until licensed sources replace restricted data.

### Raw, normalized, and published layers

1. Raw landing: provider payload plus request metadata and checksum.
2. Normalized staging: canonical asset IDs, UTC timestamps, decimal normalization, and source metadata.
3. Quality validation: duplicate, gap, OHLC, calendar, staleness, and coverage checks.
4. Published dataset: immutable Parquet partitions plus manifest and quality summary.

Partition layout:

```text
datasets/{datasetId}/{version}/
  market=VN/timeframe=1d/asset={assetId}/year=2026/part-*.parquet
  market=VN/timeframe=1h/asset={assetId}/year=2026/month=08/part-*.parquet
  manifest.json
```

Canonical bar columns are asset ID, timestamp, timeframe, open, high, low, close, volume, quote volume when available, source, ingestion timestamp, and quality flags. Decimal values remain decimals through normalization and are converted to floating arrays only inside controlled numerical calculations.

Publication is immutable. Corrections create a new dataset version instead of mutating data used by completed runs.

## Result Contract

PostgreSQL summary metrics include:

- Initial and final equity.
- Total return and CAGR.
- Annualized volatility.
- Sharpe, Sortino, and Calmar ratios.
- Maximum drawdown and recovery duration.
- Win rate, profit factor, expectancy, and trade count.
- Turnover, total fees, taxes, financing, and slippage cost.
- Average and maximum gross exposure and leverage.
- Benchmark return, alpha, beta, and tracking error when aligned data exists.

Artifact schemas:

- `equity.parquet`: timestamp, cash, borrowed cash, market value, gross/net exposure, equity, benchmark, and drawdown.
- `orders.parquet`: submitted time, asset, side, type, requested quantity, status, reason, and linked trade.
- `trades.parquet`: entry/exit, quantities, prices, costs, realized PnL, return, bars held, and exit reason.
- `positions.parquet`: position snapshots at reporting frequency.
- `period_returns.parquet`: daily, monthly, and yearly returns.
- `manifest.json`: version references, hashes, assumptions, warnings, artifact checksums, and schemas.

The UI must surface warnings for restricted data, missing corporate actions, insufficient history, survivorship risk, and cost models with zero values.

## API Contract

Primary routes:

- `GET/POST /api/strategies`
- `GET/PATCH /api/strategies/:id`
- `POST /api/strategies/:id/versions`
- `POST /api/strategies/validate`
- `GET/POST /api/backtests`
- `GET /api/backtests/:id`
- `POST /api/backtests/:id/cancel`
- `GET /api/backtests/:id/artifacts`
- `POST /api/backtests/:id/artifacts/:artifactId/url`
- `GET /api/instruments`
- `GET /api/datasets`
- `GET /api/system/quant-capacity`

Submission returns HTTP 202 and a queued run. Validation errors return 400, authentication failures 401, membership/role failures 403, missing resources 404, quota conflicts 409 or 429, and unavailable dependencies 503.

The run detail endpoint returns summary state and progress but not full artifact bodies. The UI polls it every two to three seconds while queued or running, with exponential backoff when the page is backgrounded.

## Security

- Validate a real database session in every protected server route.
- Scope every tenant query by server-resolved organization ID.
- Use parameterized Prisma or SQL queries.
- Parse DSL with strict allow-listed schemas and complexity limits.
- Do not use `eval`, dynamic imports, shell execution, or arbitrary file paths from DSL input.
- Store provider and object-storage credentials only in the ingestion/worker environment.
- Give web and worker services separate least-privilege database roles.
- Use private buckets and short-lived signed artifact URLs.
- Encrypt transport connections and managed storage at rest.
- Rate-limit login, strategy validation, run submission, status polling, and signed-URL creation.
- Record member, strategy, run, quota, and administrative changes in the audit log.
- Redact secrets and raw provider credentials from logs and error messages.
- Scan dependencies and container images in CI.

No broker connectivity or real-money order execution is part of this security boundary.

## Failure Handling and Observability

Use structured JSON logs with correlation fields: request ID, organization ID, run ID, worker ID, strategy version, data-bundle version, and engine version.

Collect:

- API latency and error rate.
- Queue depth and oldest queued age per queue.
- Active, available, expired, and reclaimed execution leases.
- Run duration, failure code, timeout rate, cancellation latency, and memory peak.
- Dataset freshness, provider errors, gaps, and last successful publication.
- Object-storage errors and artifact sizes.

Use OpenTelemetry-compatible tracing and metrics. Error reporting may use Sentry, but the domain does not depend on a specific hosted vendor.

Failure codes are stable machine-readable values such as `DSL_INVALID`, `DATASET_INCOMPLETE`, `LICENSE_RESTRICTED`, `QUOTA_EXCEEDED`, `ENGINE_TIMEOUT`, `ENGINE_OOM`, `ARTIFACT_WRITE_FAILED`, and `WORKER_LOST`.

The UI shows an actionable user message and a support correlation ID. Internal traces retain technical detail without exposing secrets.

## Testing Strategy

### DSL tests

- Schema and semantic validation.
- Type mismatches and excessive complexity.
- Normalization and stable hashing.
- Strategy-version immutability.

### Engine tests

- Golden fixtures with hand-calculated fills, cash, margin, costs, and PnL.
- No-look-ahead fixtures proving next-bar execution.
- Stops and take-profit collision behavior.
- Missing bars, session boundaries, lot/tick rounding, rejected orders, and insufficient cash.
- Margin interest, maintenance rules, liquidation, settlement, dividends, and splits.
- Crypto 24/7 and XAU session behavior.
- Same inputs produce byte-equivalent summary and logically equivalent artifacts.

### Data tests

- Provider contract fixtures.
- UTC and venue-time conversion.
- Deduplication, OHLC invariants, gap detection, staleness, and checksum stability.
- Correction publishes a new version and does not alter completed-run inputs.

### Queue and API tests

- Transactional outbox recovery.
- Duplicate delivery and worker retry idempotency.
- Lease expiry and reclaim.
- Fair organization scheduling and quota enforcement.
- Cancellation at each execution stage.
- Tenant isolation and role authorization for every route.
- Signed URL ownership and expiry.

### System verification

- End-to-end rule-builder to rendered-result flow.
- Desktop and mobile result rendering.
- Fifty concurrent representative jobs with bounded queue latency and no lost or duplicated runs.
- Worker termination during execution followed by safe retry.
- PostgreSQL and Redis transient outage drills.
- Full Vitest, Python test suite, TypeScript, ESLint, production build, migration checks, and container health checks in CI.

## Deployment Topology

Production topology:

- Next.js web/API deployment on the existing web host.
- Managed PostgreSQL with automated backups and point-in-time recovery.
- Managed Redis with authentication and persistence appropriate for queue recovery.
- Private Cloudflare R2 object storage through its S3-compatible API.
- Linux container service for the combined dispatch scheduler, ingestion workers, and quant workers.
- Separate autoscaling policies for ingestion and backtest queues.

Start with enough CPU-backed worker slots for 20 concurrent runs and allow horizontal scale to 50. Scale on queue age and active leases, not raw HTTP traffic.

Local development uses Docker Compose for PostgreSQL, Redis, MinIO, the dispatch scheduler, and workers. Next.js may continue to run with the bundled Node 24 runtime on Windows. A synchronous single-run developer command remains available for deterministic debugging without Redis.

## Migration from the Current Application

This program is intentionally decomposed because it is too large for one safe implementation plan. Each phase receives its own focused implementation plan and verification gate. The first implementation phase is the multi-tenant control-plane foundation; the data plane and real engine do not begin until tenant isolation is proven.

1. Introduce Better Auth, organizations, tenant ownership, and replace the demo-user lookup without changing the current Portfolio experience.
2. Add strategy, immutable version, backtest run, version catalog, artifact, usage, audit, and outbox models.
3. Add the Redis/Celery dispatch scheduler and a compatibility task that can execute the current deterministic worker path.
4. Introduce the canonical asset key and provider mapping while keeping existing symbol routes compatible.
5. Build data adapters, quality gates, Parquet publication, and dataset-version selection.
6. Implement and golden-test the DSL validator and event-driven engine.
7. Connect the Rule Builder and Quant Lab to real queued runs and replace every static/synthetic backtest result with run artifacts.
8. Add quota, cancellation, signed downloads, monitoring, and 50-job load verification.
9. Release as a private beta with explicit data-source and license disclosure.
10. Replace research-only providers before public commercial launch.

Each migration step must leave the application deployable. Existing simulated UI remains clearly labeled until the real engine output replaces it.

## Completion Criteria

- Authenticated organizations cannot read or mutate one another's strategies, runs, or artifacts.
- A rule-builder strategy is immutable once used by a run and contains no executable user code.
- Every completed result is reproducible from recorded version references and checksums.
- Signals cannot fill on information unavailable at the execution time.
- Vietnamese equity cash/margin, crypto spot, and XAU/USD spot rules are explicit and versioned.
- Data corrections never silently change a completed result.
- Queue retry, duplicate delivery, cancellation, worker loss, and dependency outages do not create missing or duplicated committed runs.
- The platform sustains 20 concurrent runs initially and passes a controlled 50-job concurrency test before the 5,000-user target is claimed.
- Quant Lab displays real run metrics and artifacts; static or synthetic backtest KPIs and trade lists are removed or retained only in explicitly labeled demos.
- Free research data is not represented as commercially licensed market data.
- Repository tests, Python tests, type checks, lint, production build, migrations, container health checks, security checks, browser QA, and load verification pass before release.
