# Quant Production Readiness Design

## Goal

Complete the Quant workflow from trustworthy market data through queued backtests, robustness
diagnostics, Mock Portfolio forward testing, and actionable notifications for Vietnamese equities,
crypto, and XAU/USD.

## Existing foundation retained

- Portfolio Backtest Builder already supports arbitrary catalog assets, per-leg strategies and
  parameters, cash, allocation modes, costs, rebalancing, and contributions.
- Quant runs already use PostgreSQL queued/running/succeeded/failed records and a Python worker.
- Result artifacts already include equity, drawdown, trades, metrics, portfolio contribution,
  cash flow, benchmark, and robustness.
- Successful run legs can already create Strategy Assignments in Mock Portfolio; new immutable
  datasets enqueue evaluation jobs that can create signals, snapshots, and notifications.
- Market ingestion already publishes immutable raw datasets and exposes health/readiness APIs.

The implementation extends these contracts instead of creating parallel systems.

## 1. Backtest-normalized Vietnamese equity data

### Corporate actions

Add an immutable, source-attributed `CorporateAction` ledger for Vietnamese equities. Supported
action types are `cash_dividend`, `stock_dividend`, `split`, `rights_issue`, and `symbol_change`.
Every row stores the provider event ID, public/ex-right/record/payment dates when present, cash per
share, distribution ratio, subscription ratio and price, source payload, normalized status, and a
deterministic checksum.

The free VCI company-events feed is the MVP source. Ambiguous events are retained as rejected or
unverified records; they are never silently converted into adjustment factors. Re-ingestion is
idempotent by provider plus provider event ID.

### Adjustment policy

Raw dataset versions remain immutable and audit-visible. The derived `total_return` dataset is a
separate dataset identity. Daily Vietnamese bars are backward adjusted using verified actions:

- stock dividends and splits use the verified quantity ratio;
- cash dividends use the ex-right reference close and cash per share;
- rights issues require both a verified subscription ratio and exercise price;
- the same event is never applied both to prices and position quantities;
- hourly adjusted datasets use the daily factor applicable to each local trading date.

A total-return version is published only when all corporate-action events inside the raw coverage
are classified and required numeric fields are present. Otherwise adjusted mode is unavailable and
the UI explains which action blocks it. No price-gap inference is allowed.

### Timezone, calendar, and gaps

All stored bars remain UTC. Session construction starts in `Asia/Ho_Chi_Minh` and converts expected
bar timestamps to UTC. A versioned HOSE calendar contains sessions, closures, and supported hourly
bar anchors. Provider market-event data may extend the calendar, but unverified closures cannot be
invented.

Missing bars create quality issues. They are never synthesized for signals or executions. A last
known close may be carried only for portfolio valuation and the manifest records that rule.

### Survivorship

Provider-instrument synchronization marks missing instruments inactive rather than deleting their
identity or historical datasets. Catalog snapshots store symbol, venue, listing status, and
observation time. A backtest using a hand-selected set remains valid, but a set derived from the
current listing catalog carries `CURRENT_LISTING_UNIVERSE` until point-in-time membership and
delisted history are proven complete.

### UI and manifests

Every selected leg and completed run shows one of:

- `RAW — Unadjusted`
- `TOTAL RETURN — Adjusted`

The asset picker reports availability for both policies. Run manifests include adjustment policy,
source corporate-action checksum/coverage, calendar version, missing-bar count, valuation gap rule,
and survivorship warnings. Adjusted mode is disabled if any selected leg lacks an eligible version.

## 2. End-to-end backtest

The existing builder remains the entry point. Any catalog asset with an eligible dataset can be
added or removed, and each leg keeps its own immutable strategy version and parameters. Submission
returns a persisted queued run, the worker produces real artifacts, and the UI polls until a
terminal status.

Successful results must render Active Portfolio, Equity Curve, Drawdown, KPIs, and Trade List from
stored artifacts. Each successful leg can be applied to Mock Portfolio only if its source dataset
and strategy version still pass eligibility checks. Applying creates a Strategy Assignment and a
non-actionable initial snapshot; later datasets can create actionable Buy/Sell signals.

## 3. Production job execution

Extend run status to `queued`, `running`, `succeeded`, `failed`, `cancel_requested`, `cancelled`, and
`timed_out`. A tenant-scoped cancel endpoint transitions queued runs immediately and running runs
cooperatively. Workers check cancellation between legs and expensive robustness evaluations.

Leases are renewed during work. A stale-run recovery pass marks exhausted leases `timed_out` or
requeues them within a bounded attempt policy. Progress is monotonic and reflects completed phases.

The run fingerprint is the existing normalized portfolio hash plus engine version and immutable
dataset/strategy inputs. A new submission reuses a succeeded run only within the same organization
and only when all immutable references match. Cached responses identify their source run.

Concurrency verification must prove 20 and 50 simultaneous claim attempts do not double-claim a
run, bypass tenant isolation, or create duplicate artifacts. It must also record queue latency and
completion/error counts rather than claiming CPU throughput from mocks.

## 4. Production ingestion operations

The repository keeps one scheduler boundary for hourly and daily jobs. Deployment documentation and
templates must run catalog sync, ingestion, bounded retry, and health verification. Queue creation
and retry remain idempotent for provider instrument plus timeframe while an active request exists.

Health reports include freshness, missing dataset count, backlog age, recent provider failures, and
last successful scheduler run. Quant Lab surfaces stale/unavailable warnings without presenting
fixtures as live data.

## 5. Strategy validation

The current chronological holdout remains, but wording must state it is a diagnostic rather than
parameter fitting. Walk-forward artifacts use expanding train windows and future-only test windows.
Parameter neighbours are bounded, valid strategy configurations evaluated on the same immutable
data. Results label stability `stable`, `mixed`, `fragile`, or `not_evaluated` and surface sample,
out-of-sample, and sensitivity warnings in the UI.

## 6. Forward testing and notifications

Active assignments are evaluated exactly once per dataset version. Each evaluation records a
forward snapshot and can create at most one signal per assignment, dataset, type, and signal time.
Signals support `suggested`, `reviewed`, `executed`, and `dismissed`. Executing a signal can prefill a
Mock Portfolio transaction; dismissing or reviewing does not mutate holdings.

Forward performance shows strategy equity versus its benchmark and backtest reference metrics from
the source run. Notifications are persisted, tenant/user scoped, deduplicated by signal, and shown
in the existing notification center.

## Error and safety rules

- Never fabricate prices, actions, fills, dividends, FX, or historical universe membership.
- Provider credentials, response bodies, and database URLs are not logged.
- Existing active raw versions remain usable when a derived adjusted publication fails.
- Tenant ownership is enforced at every API and cache lookup.
- Provider terms remain `research_only`; this does not establish commercial redistribution rights.

## Verification evidence

Completion requires schema migration tests, unit and integration tests for derivation and tenant
scope, real database publication of at least one adjusted Vietnamese equity, a real queued run using
that version, browser-visible policy/warning labels, successful apply-to-portfolio and subsequent
signal evaluation, concurrency results for 20 and 50 claimers, scheduler/health evidence, full test
and production build success, a clean intended commit, and verified local listeners on ports 3100
and 8100.
