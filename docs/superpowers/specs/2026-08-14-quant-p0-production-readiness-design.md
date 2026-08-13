# Quant P0 Production Readiness Design

**Date:** 2026-08-14
**Status:** Approved for planning
**Scope:** Production ingestion, missing-bar quality, historical correctness, and end-to-end Quant verification.

## 1. Objective

Complete the remaining Quant P0 work in this fixed order:

1. make the full market-data universe converge through production ingestion;
2. distinguish valid exchange closures from genuine missing bars and enforce dataset eligibility;
3. make historical raw/adjusted lineage and survivorship limitations auditable;
4. prove the complete authenticated Quant workflow and concurrent backtest capacity.

The implementation extends the existing PostgreSQL request queue, Python ingestion and quant
workers, immutable dataset versions, Next.js APIs, and Quant health UI. It does not add Redis,
Celery, another scheduler, synthetic OHLC bars, or a paid data provider.

## 2. Global Constraints

- Free providers remain the MVP data source; unavailable observations remain explicit.
- Raw and adjusted dataset versions are immutable after publication.
- Missing bars are never filled with invented prices or copied candles.
- Backtest eligibility fails closed when a severe data-quality issue affects the requested range.
- Provider failures, scheduler outcomes, worker progress, and quality exclusions use stable error
  codes; raw provider errors are not exposed to users.
- Tenant-owned runs, assignments, signals, and portfolio transactions remain organization-scoped.
- The canonical local stack remains `node scripts/dev-local.mjs`, web port `3100`, and engine port
  `8100`.
- Each P0 is independently tested, reviewed, committed, and operationally verified before the next
  P0 begins.

## 3. P0.1 — Production Ingestion Convergence

### 3.1 Scheduler and worker responsibilities

`scripts/run-market-ingestion.ps1` remains the only scheduled entry point. A scheduled invocation
must synchronize provider instruments, enqueue due identities idempotently, record queue counts,
and exit within a bounded scheduler window. It must not synchronously wait for the entire HOSE,
crypto, and XAU universe to finish.

`process_ingestion_requests.py --watch` remains the long-running data worker. It claims requests
through PostgreSQL leases, renews the lease during provider I/O, retries retryable failures with a
bounded exponential delay, and terminalizes exhausted requests. A worker heartbeat records the
last active time and current request identity without creating a second queue system.

Hourly scheduling queues only supported `1h` instruments that are due. Daily scheduling queues
only supported `1d` instruments, then runs corporate-action synchronization and adjusted
publication as separately observable stages. One failed provider cannot prevent unrelated
providers from being queued.

### 3.2 Health and failure policy

Health separates these facts:

- latest scheduler enqueue success;
- latest active ingestion-worker heartbeat;
- queued/running request count and oldest eligible request age;
- last successful dataset publication by market/timeframe;
- failures grouped by provider, stable error code, and retryability.

A current provider failure does not automatically invalidate previously fresh immutable data.
Readiness becomes failed when a required dataset is missing/stale, the oldest eligible backlog is
older than six hours, no scheduler enqueue has succeeded in 25 hours, or the worker heartbeat is
older than fifteen minutes while due work exists. Recent terminal provider failures remain visible
as degraded diagnostics even after data becomes fresh.

### 3.3 Acceptance

- A scheduler command returns after enqueue/stage orchestration rather than draining 400+ assets.
- Concurrent same-command scheduling creates no duplicate active request identity.
- A killed worker request is safely reclaimed after lease expiry; an active lease is never stolen.
- The full configured universe eventually reaches an empty due backlog under a running worker.
- Windows install verification fails non-zero when tasks are absent or inaccessible.
- The production verifier returns structured scheduler, worker, backlog, freshness, and provider
  evidence.

## 4. P0.2 — Missing Bars and Dataset Quality

### 4.1 Versioned market calendars

Expected timestamps come from an explicit calendar contract:

- HOSE: Asia/Ho_Chi_Minh sessions, lunch break, weekends, known exchange holidays, and exceptional
  closures for the supported historical interval;
- Crypto spot: continuous UTC 24/7 daily and hourly bars;
- XAU/USD spot: 24/5 trading with the documented daily rollover and known full-market closures.

Every published dataset records its calendar version. A date outside the certified calendar range
is not silently treated as a normal session; it produces a stable `CALENDAR_RANGE_UNVERIFIED`
quality issue.

### 4.2 Gap classification

Quality validation considers only the asset's active listing interval and classifies each expected
gap as one of:

- `EXPECTED_CLOSURE`: weekend, holiday, or defined market closure; not counted as missing;
- `LISTING_INACTIVE`: before listing, after delisting, or an explicitly retained inactive period;
  not counted as missing;
- `SUSPENSION_UNVERIFIED`: potential trading suspension without authoritative confirmation;
  warning and no synthetic bar;
- `PROVIDER_GAP`: expected session absent from provider data;
- `CALENDAR_RANGE_UNVERIFIED`: expected schedule cannot be certified.

The dataset version stores missing count by severity plus bounded issue ranges rather than one
opaque aggregate only. Existing `missingBarCount` remains the count of genuine provider gaps for
backward compatibility.

### 4.3 Eligibility

- `passed`: no provider gaps and calendar is certified for the requested range;
- `warning`: bounded non-critical gaps that do not intersect the requested Backtest interval, or
  explicitly disclosed unverified suspension ranges;
- `quarantined`: provider gaps or uncertified calendar ranges intersect the requested interval,
  invalid OHLC, duplicates, or non-monotonic timestamps.

Backtest and Optimizer selectors must inspect issue ranges, not only the dataset-level label. The
asset picker shows coverage, calendar version, genuine gap count, and the reason a requested range
is unavailable.

### 4.4 Acceptance

- Golden tests cover Tet/HOSE holidays, lunch breaks, crypto weekends, XAU weekends, listing dates,
  delisting dates, suspensions, and real provider gaps.
- Recomputing quality is deterministic for identical bars and calendar version.
- No test or production path manufactures an OHLC bar for a missing timestamp.
- The operational report explains the existing missing-bar total by market, timeframe, provider,
  classification, and affected date range.

## 5. P0.3 — Historical Correctness and Survivorship

### 5.1 Listing history

Provider catalog snapshots retain every observed instrument and its observation timestamp. Asset
listing history records first seen, last seen, active/inactive/delisted status, venue, symbol, and
provider evidence. A symbol disappearing from one snapshot is not immediately declared delisted;
it becomes inactive only after the configured confirmation window or an explicit provider status.

Inactive and delisted assets remain searchable for historical Backtest when an eligible immutable
dataset covers the requested interval. Current-listing filters are never used as a substitute for
a historical constituent universe.

### 5.2 Survivorship disclosure

The platform records the earliest date from which catalog snapshots form a retained universe.
Backtests beginning earlier carry a structured `SURVIVORSHIP_COVERAGE_PARTIAL` warning containing
the certified start date. The UI displays this warning in the builder and result provenance.

The MVP does not claim reconstructed historical HOSE index constituents. It provides retained
instrument history from the system's first verified snapshot forward and explicit partial coverage
before that date.

### 5.3 Raw and adjusted audit

For a fixed VN validation basket containing cash dividends, stock dividends/splits, rights issues,
and inactive symbols, verification records:

- raw provider/version/checksum/coverage;
- corporate-action source, ex-date, verification state, and checksum;
- adjusted parent version, price and quantity factors, calendar version, and checksum;
- invariant evidence that post-event raw bars remain unchanged.

Any unresolved price-affecting event blocks total-return eligibility for the affected range. The
verification report compares selected computed ex-date factors with independently calculated
expected values; it does not copy external adjusted prices into the dataset.

### 5.4 Acceptance

- Inactive/delisted symbols remain queryable and are never erased by catalog synchronization.
- A historical Backtest cannot silently present the current universe as a complete past universe.
- The VN validation basket passes factor/lineage checks or returns a stable, explicit block reason.
- Backtest results persist dataset, calendar, adjustment, catalog-coverage, and quality provenance.

## 6. P0.4 — Authenticated E2E and Capacity Proof

### 6.1 Functional workflow

Automated browser/API verification uses an isolated test organization and real migrated test
database. It exercises:

1. sign in and select the active organization;
2. choose one eligible VN equity, one crypto asset, and XAU when source availability permits;
3. assign an independently selected supported strategy to each leg;
4. run the portfolio Backtest and wait for a terminal result;
5. verify Active Portfolio, Equity Curve & Drawdown, KPI cards, Trade List, provenance, and warnings;
6. apply an eligible leg to Mock Portfolio;
7. publish the next immutable dataset version and evaluate the assignment;
8. review or execute the resulting signal through the atomic signal-linked transaction path;
9. confirm the forward snapshot and in-app notification.

The test never falls back to fixtures when it claims provider-backed production readiness. If XAU
or another provider is unavailable, that scenario is recorded as a blocked external dependency,
while deterministic contract/E2E tests continue against immutable test datasets clearly labeled
as test data.

### 6.2 Concurrency and performance

A database-backed load harness submits 20 and then 50 distinct portfolio Backtests across multiple
organizations. It records queue delay, execution duration, terminal status, retry count, worker
lease behavior, database connection usage, CPU, and memory.

Acceptance targets for the MVP test environment are:

- no duplicate claim or cross-tenant artifact;
- no run remains `running` after its deadline plus recovery window;
- cancellation remains durable under concurrent claim;
- at least 99% of valid runs reach a correct terminal state;
- p95 queue delay and execution duration are reported, not hidden behind a pass/fail label;
- worker and database limits are documented from the measured environment before deployment.

These targets validate correctness and operability; they do not promise a universal latency SLA
for free upstream providers.

### 6.3 Release gate

Quant P0 is production-ready only when all of the following are true:

- complete Vitest, Python, TypeScript, Prisma, and production build verification passes;
- ingestion verifier is healthy for the configured universe;
- at least one observed hourly and one observed daily scheduled run succeed in the deployment
  environment;
- authenticated E2E passes without console errors or horizontal overflow at desktop and mobile;
- 20/50-run capacity reports contain no correctness, tenant-isolation, lease, or terminal-state
  failure;
- `main` is clean, pushed, and the canonical local stack returns HTTP 200 on ports 3100 and 8100.

## 7. Delivery Sequence

1. P0.1 scheduler/worker separation, observability, operational convergence, review, and commit.
2. P0.2 calendar and gap classification, dataset eligibility, reporting, review, and commit.
3. P0.3 listing history, survivorship provenance, VN adjustment audit, review, and commit.
4. P0.4 authenticated E2E, concurrency harness, measured report, review, and commit.
5. Full verification, push `main`, restart local, and report code health separately from external
   provider and deployment-scheduler evidence.

## 8. Explicit Non-goals

- Paid data feeds or guaranteed free-provider uptime.
- Fundamental financial-statement ingestion and P/B, P/E, ROE execution.
- Email, Telegram, or browser-push delivery.
- Historical reconstruction of every HOSE index constituent before retained catalog snapshots.
- Redis, Celery, Kafka, Kubernetes, or another orchestration platform.
- Synthetic missing candles, forward-filled prices, or deletion of failed historical versions.
