# Strategy Backtest, Signal Alerts, and Mock Portfolio Integration

**Status:** Approved design
**Date:** 2026-08-11
**Product:** RadarAsset / Financial Platform
**Scope:** Quant Lab Backtest and Mock Portfolio

## Purpose

Quant Lab must be a strategy-testing workbench rather than a single hard-coded moving-average demo. A user should be able to select assets they hold, test a versioned strategy against immutable historical data, understand whether the strategy was effective for each asset, and then apply that exact strategy configuration to the asset for ongoing BUY/SELL alerts.

Alerts must connect to Mock Portfolio. A signal may prepare a simulated Buy or Sell transaction, but the user must review and confirm it before the transaction changes portfolio quantity, cost basis, or realized PnL.

The first supported universe remains:

- FPT on 1d and 1h data.
- BTC/USDT on 1d and 1h data.
- XAU/USD on 1d data.

XAU/USD 1h remains unavailable until a real, stable hourly provider is integrated. The product must never substitute fixture or resampled daily data while presenting it as live hourly data.

## Product Principles

1. Backtest and live signal evaluation use the same strategy implementation.
2. Indicators at bar `t` use only information available at or before bar `t` close.
3. A signal confirmed at bar `t` may first execute at bar `t+1` open.
4. Strategy code is allow-listed and versioned; uploaded notebooks and arbitrary Python are never executed.
5. Dataset version, checksum, strategy version, normalized parameters, and engine version are retained for reproducibility.
6. No strategy signal automatically changes Mock Portfolio in the MVP.
7. Stale or insufficient data produces an explicit unavailable state rather than a synthetic signal.
8. Strategy effectiveness is reported per asset. Multi-asset comparison uses normalized percentage curves and does not pretend that cross-currency cash balances are directly fungible.

## User Journeys

### Backtest assets held in Mock Portfolio

1. The user opens Mock Portfolio.
2. The user selects one or more holdings and chooses **Backtest Strategy**.
3. Quant Lab opens with those assets preselected.
4. The user selects one strategy, timeframe, date range, strategy parameters, initial notional, fee, slippage, and permitted leverage.
5. The web API validates and queues a reproducible run.
6. The worker evaluates each selected asset independently, then builds normalized comparison artifacts.
7. The UI renders per-asset performance, signal points, trade ledger, risk metrics, and Buy & Hold comparison.

### Apply a successful strategy

1. The user reviews a successful per-asset result.
2. The user chooses **Apply Strategy** for that asset.
3. The system shows the exact strategy version, parameters, timeframe, data freshness, and reference backtest metrics.
4. Confirmation creates an active Strategy Assignment for the portfolio and asset.
5. If an assignment already exists for that portfolio and asset, it is archived and replaced in the same transaction.
6. Initial evaluation records the current state as a snapshot. It is visible to the user but does not create a misleading historical notification.

### Receive and act on a signal

1. Market ingestion publishes a new active dataset version.
2. An idempotent evaluation job is created for each matching active assignment.
3. The signal worker evaluates the new bar using the assigned strategy version and parameters.
4. A notification is created only when the position state changes between flat and long.
5. Mock Portfolio shows the strategy, signal, confirmation close, expected next-bar execution semantics, and indicator explanation.
6. The user chooses **Review Buy** or **Review Sell**.
7. The existing transaction dialog opens with asset, side, reference price, strategy signal, and note prefilled.
8. The user chooses quantity and confirms.
9. The portfolio transaction is persisted with a link to the originating signal and the existing accounting logic recomputes positions, average cost, realized PnL, and performance.

## Strategy Catalog

The catalog is code-owned and materialized as immutable Strategy Version records. A catalog entry declares:

- Stable strategy code and display name.
- Semantic version.
- Category and description.
- Parameter schema and defaults.
- Supported timeframes and markets.
- Required warm-up bars.
- Signal states and long-only compatibility.
- Implementation checksum.
- Source attribution and modification notice where applicable.
- Active, deprecated, or research-only status.

The initial runnable strategies are below.

### MA Crossover

**Code:** `ma_crossover`
**Version:** `1.0.0`

- BUY when the fast SMA crosses above the slow SMA at bar close.
- SELL when the fast SMA crosses below the slow SMA at bar close.
- Parameters: `fastPeriod` and `slowPeriod`.
- Validation requires `2 <= fastPeriod < slowPeriod <= 400`.
- Required warm-up is `slowPeriod` bars.

This replaces the current `ma_cross` special case with a catalog-backed strategy while preserving its conservative next-bar execution behavior.

### Turtle Breakout

**Code:** `turtle_breakout`
**Version:** `1.0.0`

- BUY when close exceeds the highest high of the previous `entryPeriod` completed bars.
- SELL when close falls below the lowest low of the previous `exitPeriod` completed bars.
- The current bar is excluded from both rolling extrema.
- Parameters: `entryPeriod` and `exitPeriod`.
- Defaults: entry 20 bars and exit 10 bars.
- Validation requires periods in `[2, 250]`.
- Required warm-up is the larger period plus one bar.

The attached notebook is treated as inspiration only because its signal directions are inverted relative to conventional Turtle breakout semantics.

### Signal Rolling Reversal

**Code:** `signal_rolling_reversal`
**Version:** `1.0.0`

- This is a causal, long-only mean-reversion strategy derived from the attached signal-rolling notebook.
- While flat, BUY after `confirmationBars` consecutive lower closes.
- While long, SELL after `confirmationBars` consecutive higher closes.
- Counters reset when the expected sequence breaks or after a state transition.
- Parameter: `confirmationBars` in `[2, 20]`, default 4.
- Required warm-up is `confirmationBars + 1` bars.

The strategy name includes “Reversal” so users do not confuse it with a trend-following rule.

### ABCD Causal Pattern

**Code:** `abcd_causal`
**Version:** `1.0.0`

- Uses only confirmed alternating pivots.
- A pivot is recognized only after `pivotRightBars` later bars have closed; its signal timestamp is the recognition bar, never the historical pivot bar.
- A bullish pattern consists of confirmed pivots high A, low B, lower high C, and lower low D with retracement and extension ratios inside the configured bounds. It produces BUY after bullish D is confirmed.
- A bearish pattern consists of confirmed pivots low A, high B, higher low C, and higher high D with ratios inside the configured bounds. It produces SELL after bearish D is confirmed.
- Parameters: left and right pivot confirmation bars, minimum and maximum BC retracement ratio, and minimum and maximum CD extension ratio.
- Default ratio bands are BC `[0.382, 0.886]` and CD `[1.13, 1.618]`.
- All pivot and ratio parameters are strictly bounded to prevent excessive runtime.

The attached ABCD notebook cannot be used directly because it scans future indices, is quartic in the number of bars, and assigns signals retrospectively. The causal implementation intentionally changes those semantics.

## Notebook Adaptation Policy

The referenced Stock-Prediction-Models notebooks are Apache License 2.0 material. Adapted strategy documentation must retain attribution and state that the implementation was modified.

The deterministic rule notebooks inform the four initial strategies. The Policy Gradient, Q-Learning variants, Actor-Critic variants, Curiosity, Evolution Strategy, Neuro-Evolution, and Novelty Search notebooks are research references rather than production-ready strategies because they:

- Target Python 3.6 and TensorFlow 1-era APIs.
- Train and evaluate on the same price series.
- Do not provide a strict train, validation, and out-of-sample test boundary.
- Do not share the production execution, fee, slippage, and portfolio accounting engine.
- Do not persist deterministic seeds, model artifacts, or reproducibility manifests.

ML/RL strategies are deferred until an offline training pipeline provides deterministic seeds, train/validation/test ranges, versioned model artifacts, evaluation metrics, and inference-only signal execution. They may appear as disabled “ML/RL Research” catalog entries but cannot be applied to a portfolio.

## Backtest Semantics

### Asset selection

- The user may select supported assets from Mock Portfolio or from the supported asset catalog.
- Unsupported holdings remain visible but display **Historical dataset unavailable**.
- A run may contain one or more assets, but each asset is simulated independently using identical strategy parameters unless the UI explicitly exposes a per-asset override in a future version.
- Per-asset absolute results are labeled in the dataset quote currency.
- The multi-asset summary uses equal-weight normalized return curves indexed to 100. It is a comparison artifact, not a cross-currency cash account.

### Clock and execution

- All persisted timestamps are UTC.
- Signals are evaluated at completed bar close.
- Market execution uses the next eligible bar open.
- Missing bars never create executable synthetic prices.
- Warm-up bars may precede the requested performance start date but may not create trades or performance.
- Fee and adverse slippage are applied by the shared execution engine.
- FPT leverage is capped at 2x. BTC and XAU spot are capped at 1x.
- The MVP is long-only: position state is `flat` or `long`.

### Benchmark and metrics

Each per-asset result includes:

- Total return and Buy & Hold return.
- Final equity in the asset quote currency.
- CAGR when the tested interval is at least 365 calendar days.
- Annualized volatility.
- Sharpe and Sortino ratios when enough returns exist.
- Maximum drawdown.
- Trade count, win rate, profit factor, total fees, and slippage cost.
- Exposure percentage and average holding duration.

The UI must report unavailable metrics as unavailable rather than zero.

## Shared Strategy Interface

Every runnable strategy implements a project-owned interface conceptually equivalent to:

```text
metadata() -> StrategyMetadata
validate(parameters) -> NormalizedParameters
required_warmup(parameters) -> integer
evaluate(completed_bars, parameters, prior_state) -> StrategyDecision
```

`StrategyDecision` contains:

- `state`: flat or long.
- `signal`: BUY, SELL, or HOLD.
- `signalAt`: completed bar timestamp.
- `confirmationClose`.
- `reasonCode`.
- Bounded indicator snapshot safe for UI display.

The strategy never creates portfolio transactions or directly changes cash. The shared engine owns fills and accounting.

## Data Model

### StrategyVersion

Immutable global catalog record:

- `id`, `code`, `version`, `name`, and `category`.
- `status`: active, deprecated, or research-only.
- `parameterSchema` and `defaultParameters` JSON.
- `supportedMarkets` and `supportedTimeframes` JSON arrays.
- `implementationHash`.
- `sourceAttribution` and `modificationNotice`.
- `createdAt`.
- Unique `(code, version)`.

Referenced versions are never edited. A behavior change creates a new semantic version.

### QuantRun changes

- Add required `strategyVersionId` for new backtests.
- Retain the normalized strategy parameters in the existing parameters document.
- Derive `strategyHash` from strategy version, parameters, timeframe, assets, execution settings, and dataset versions.
- Remove the worker claim condition tied to the literal name “MA Crossover Backtest”.
- Store engine version independently of strategy version.
- Add a bounded `signals` artifact per asset.
- Add per-asset metrics plus normalized aggregate metrics.

### StrategyAssignment

Tenant-scoped active or archived configuration:

- `id`, `organizationId`, `userId`, `portfolioId`, and `assetId`.
- `strategyVersionId`.
- `sourceQuantRunId` referencing the successful run used when applying the strategy.
- `timeframe` and normalized parameters.
- `status`: active, paused, or archived.
- `lastEvaluatedDatasetVersionId`, `lastEvaluatedAt`, and current flat/long state.
- `createdAt`, `updatedAt`, and optional `archivedAt`.
- At most one active assignment per portfolio and asset in the MVP.

Replacement archives the previous assignment and creates the new assignment atomically.

### StrategyEvaluationJob

Durable PostgreSQL queue item:

- `id`, `organizationId`, `assignmentId`, and `datasetVersionId`.
- `status`, `attemptCount`, `availableAt`, `lockedAt`, `startedAt`, `finishedAt`, and sanitized error code.
- Unique `(assignmentId, datasetVersionId)` for idempotency.
- Workers claim jobs with `FOR UPDATE SKIP LOCKED`.

### StrategySignal

Tenant-scoped signal record:

- `id`, `organizationId`, `assignmentId`, `assetId`, and `strategyVersionId`.
- `datasetVersionId`, `signalAt`, and `createdAt`.
- `signal`: BUY, SELL, HOLD, or INITIAL_SNAPSHOT.
- `previousState` and `nextState`.
- `confirmationClose`, `reasonCode`, and indicator snapshot.
- `strategyHash` and dataset checksum.
- `actionStatus`: informational, pending, acted, or dismissed.
- Unique `(assignmentId, datasetVersionId, signalAt)`.

HOLD evaluations update assignment progress but do not create user notifications. INITIAL_SNAPSHOT records current state at assignment activation without claiming that a new market event occurred.

### Notification

The MVP provides an in-app notification record:

- Tenant and user ownership.
- Optional `strategySignalId`.
- Notification type, title, summary, created time, and read time.
- Unique signal notification per user.

Email, Telegram, mobile push, and webhook delivery are deferred. A transactional outbox may be added when external channels are introduced.

### PortfolioTransaction change

- Add nullable `sourceSignalId`.
- A signal may produce at most one confirmed mock transaction in the MVP.
- The transaction side must match the signal side.
- Existing position and oversell validation remains authoritative.
- A SELL signal with no available holding remains informational and cannot create a transaction.

## APIs

### Strategy catalog

`GET /api/quant/strategies`

- Returns only active, supported catalog metadata and bounded parameter schemas.
- Research-only entries may be returned with `runnable: false` for transparent roadmap display.

### Backtest runs

`POST /api/quant/runs`

- Accepts strategy code/version, normalized parameter candidate, asset list, timeframe, range, notional, fee, slippage, and leverage.
- The server resolves the immutable strategy version, validates parameters, chooses active eligible datasets, computes the canonical hash, and queues the run.

`GET /api/quant/runs/:id`

- Remains tenant-scoped and returns per-asset plus normalized aggregate artifacts.

### Strategy assignments

`POST /api/strategy-assignments`

- Requires a successful tenant-owned source run for the same asset, strategy version, timeframe, and parameters.
- Requires portfolio write and backtest create capability.
- Archives any active assignment for the same portfolio and asset, then creates and schedules the replacement atomically.

`PATCH /api/strategy-assignments/:id`

- Allows pause, resume, or archive.
- Parameter or strategy changes require a replacement assignment; they do not mutate history.

### Signals and notifications

`GET /api/portfolio/strategy-signals`

- Returns tenant-scoped assignment status and the latest bounded signal details for portfolio holdings.

`GET /api/notifications` and `PATCH /api/notifications/:id`

- Load notifications and mark them read.

### Portfolio transactions

The existing transaction endpoint accepts optional `sourceSignalId`. The server verifies tenant ownership, signal state, side, portfolio, asset, and one-action constraint before recording the transaction.

## Worker Architecture

The current one-shot backtest worker becomes a durable process with two bounded job handlers:

- `BACKTEST_RUN` claims queued Quant Runs.
- `SIGNAL_EVALUATION` claims Strategy Evaluation Jobs.

PostgreSQL remains the MVP queue. Redis and Celery are unnecessary until measured concurrency or latency requires them.

The worker loop:

1. Claims one available job with a lease.
2. Validates strategy version and implementation hash.
3. Loads immutable dataset bars and verifies checksum.
4. Enforces warm-up and requested range.
5. Evaluates strategy signals.
6. Runs the shared event-driven execution engine for a backtest, or writes the latest state transition for live evaluation.
7. Commits result, signal, notification, and assignment progress atomically where applicable.
8. Retries only transient errors with bounded attempts and backoff.
9. Marks stale leases recoverable without duplicating artifacts or notifications.

Ingestion must enqueue evaluation only after the new dataset version is active. An unavailable, quarantined, or stale dataset does not enqueue an actionable signal evaluation.

## Quant Lab UI

### Configuration panel

- Asset source toggle: **From Mock Portfolio** or **Select manually**.
- Supported asset multi-select with explicit data-health state.
- Strategy selector with category, version, description, and research-only badges.
- Dynamic parameter form generated from safe catalog metadata.
- Timeframe, date range, initial notional, fee, slippage, and leverage controls.
- Unsupported asset/timeframe combinations are disabled with a reason.

### Results

- Overall normalized summary.
- Per-asset tabs or cards.
- Price chart with BUY and SELL markers.
- Strategy equity versus Buy & Hold.
- Drawdown chart.
- Risk and trade metrics.
- Trade ledger and reproducibility manifest.
- **Apply Strategy** appears only on successful, tenant-owned, supported per-asset results.

## Mock Portfolio UI

Each holding exposes:

- Active strategy and timeframe.
- Current strategy state.
- Latest BUY, SELL, HOLD, INITIAL_SNAPSHOT, DATA STALE, or EVALUATION FAILED status.
- Confirmation price and time.
- Reference backtest summary.
- **Backtest**, **Replace Strategy**, **Pause**, and contextual **Review Buy/Sell** actions.

Desktop may add compact strategy and signal columns. Mobile uses an expandable holding detail panel to avoid horizontal overflow.

The notification center shows unread strategy signals. A notification explains:

- Asset, strategy, and version.
- Signal and indicator reason.
- Confirmation close and bar time.
- Next-bar execution rule.
- Data source and freshness.
- Link to the review transaction dialog.

## Error Handling

Stable public error codes include:

- `STRATEGY_NOT_FOUND`
- `STRATEGY_NOT_RUNNABLE`
- `STRATEGY_PARAMETERS_INVALID`
- `STRATEGY_VERSION_MISMATCH`
- `DATASET_UNAVAILABLE`
- `DATASET_STALE`
- `DATASET_CHECKSUM_MISMATCH`
- `INSUFFICIENT_WARMUP`
- `ASSIGNMENT_CONFLICT`
- `SOURCE_RUN_MISMATCH`
- `SIGNAL_ALREADY_ACTED`
- `SIGNAL_SIDE_MISMATCH`
- `POSITION_UNAVAILABLE`
- `WORKER_LOST`
- `ENGINE_TIMEOUT`
- `ENGINE_FAILED`

User-visible messages remain actionable and do not expose database URLs, provider bodies, stack traces, or cross-tenant identifiers.

## Security and Tenant Isolation

- Strategy, assignment, signal, notification, and transaction routes require the existing tenant context.
- Viewers may read portfolio signals and backtest results but may not create runs, assignments, or transactions.
- Organization, user, portfolio, run, assignment, signal, and transaction relations are revalidated server-side; client-supplied organization IDs are ignored or rejected.
- No uploaded code, arbitrary paths, shell commands, `eval`, or dynamic user imports.
- Parameter schemas enforce numeric bounds and strategy complexity limits.
- Indicator snapshots have an allow-listed, size-bounded shape.
- Logs and errors are sanitized.

## Testing

### Strategy unit and golden tests

- Golden signal sequences for all four initial strategies.
- Boundary tests for every parameter schema.
- Warm-up tests.
- Deterministic output and implementation-hash tests.
- Turtle current-bar exclusion test.
- Rolling Reversal counter reset tests.
- ABCD delayed pivot-recognition tests.

### No-look-ahead tests

- Append future bars and verify that all earlier decisions remain unchanged.
- Verify signal-at-close and next-open fill separation.
- Verify warm-up bars cannot create performance or trades.
- Verify ABCD signals appear at pivot confirmation time, not at the historical pivot.

### Backtest/live parity

- Replay a historical dataset one version at a time through live evaluation.
- Compare the resulting transitions with the signals artifact from a full backtest using the same strategy version and parameters.
- Require identical timestamps, states, reason codes, and indicator snapshots.

### Persistence and isolation

- Two-organization integration tests for runs, assignments, jobs, signals, notifications, and source-linked transactions.
- Replacement archives only the matching tenant assignment.
- Duplicate ingestion or job retry creates no duplicate signal or notification.
- Viewer capability tests.
- A source signal from another portfolio or organization cannot create a transaction.

### Accounting integration

- BUY signal review creates a correctly linked transaction and weighted average cost.
- SELL signal review enforces available quantity and updates realized PnL.
- A signal cannot be acted on twice.
- Paused or archived assignments produce no new evaluations.

### Browser QA

- Portfolio holding to prefilled Quant Lab flow.
- Each strategy’s dynamic parameter form.
- Successful run to Apply Strategy.
- Ingestion to signal notification.
- Signal to prefilled review transaction and updated holding.
- Desktop and 390px mobile viewport with no page-level horizontal overflow.
- No relevant console errors or framework overlays.

## Delivery Sequence

1. Introduce Strategy Version catalog and shared strategy interface.
2. Port MA Crossover to the generic interface and preserve golden behavior.
3. Add Turtle Breakout, Signal Rolling Reversal, and ABCD Causal with no-look-ahead tests.
4. Generalize request contracts, worker dispatch, artifacts, metrics, and Quant Lab strategy selection.
5. Add Mock Portfolio asset preselection and per-asset backtest results.
6. Add Strategy Assignment persistence and Apply Strategy flow.
7. Convert the one-shot worker into a durable, recoverable worker loop.
8. Add ingestion-driven Strategy Evaluation Jobs and backtest/live parity coverage.
9. Add Strategy Signals, in-app notifications, and Mock Portfolio signal surfaces.
10. Link reviewed signals to confirmed mock transactions.
11. Run focused unit, integration, build, and browser QA before merge.

## Deferred Scope

- Arbitrary user Python or notebook execution.
- Visual custom rule builder authoring.
- Automatic trade execution.
- Broker or exchange connectivity.
- Email, Telegram, mobile push, SMS, and webhooks.
- ML/RL training and inference.
- Live XAU/USD 1h signals.
- Additional Vietnamese equities, crypto pairs, metals, and FX until ingestion, licensing, and quality gates exist.
- Multi-currency portfolio cash accounting and FX conversion.
- Multiple simultaneous active strategies for one portfolio asset.

## MVP Acceptance Criteria

The feature is complete when:

1. A user can select a supported portfolio holding and run any of the four initial strategies with validated parameters.
2. Results show real per-asset signals, fills, metrics, Buy & Hold comparison, and reproducibility metadata.
3. A successful per-asset result can create exactly one active assignment for that portfolio asset.
4. A new eligible dataset version produces an idempotent strategy evaluation.
5. A state transition creates exactly one tenant-scoped signal notification.
6. The user can review the signal and confirm one linked mock transaction.
7. Portfolio quantity, average cost, realized PnL, and transaction history update through the existing accounting domain.
8. Backtest and incremental live evaluation produce identical signals for the same data and parameters.
9. Stale, unsupported, or insufficient data cannot produce an actionable alert.
10. Tenant isolation, capability, no-look-ahead, worker recovery, and desktop/mobile browser tests pass.
