# Quant Data and Strategy Production Design

**Date:** 2026-08-14  
**Status:** Approved for planning  
**Scope:** Quant Lab ingestion operations, Vietnam adjusted datasets, Quant UI localization, and database-backed custom strategies.

## 1. Objective

Complete four workstreams in this fixed order:

1. make free-provider ingestion observable and recoverable in production;
2. publish financially safe adjusted Vietnam equity datasets;
3. remove Vietnamese mojibake and complete VI/EN coverage throughout Quant Lab;
4. replace Strategy Lab browser storage with tenant-scoped, immutable database versions.

The implementation reuses the existing PostgreSQL/Prisma schema, Python ingestion workers,
Next.js APIs, bilingual dictionary, and custom-strategy execution registry. It must not add a
second scheduler, data store, strategy format, or UI design system.

## 2. Global Constraints

- Free providers remain the MVP source. Provider gaps must be disclosed, never fabricated.
- Raw dataset versions remain immutable and available for audit.
- A `total_return` version is eligible only when its corporate-action coverage contains the raw
  bar range and every price-affecting event in that range is verified.
- All tenant-owned strategies are scoped by `organizationId`; create/version/archive mutations
  require editor capability.
- Existing strategy versions remain immutable. Editing creates the next patch version.
- Quant UI must render correct UTF-8 Vietnamese and complete English equivalents without
  embedding user-facing copy in components.
- The canonical local launcher remains `node scripts/dev-local.mjs`, with web port `3100` and
  engine port `8100`.
- No new runtime dependency is needed.

## 3. Workstream 1 — Production Ingestion Operations

### 3.1 Scheduler boundary

`scripts/run-market-ingestion.ps1` remains the single scheduler entry point. The hourly task
queues and drains `1h` work. The daily task queues and drains `1d` work, then synchronizes
corporate actions and publishes adjusted datasets. Every non-dry run creates exactly one
`market_ingestion_scheduler_runs` row and terminalizes it as `succeeded` or `failed` from a
top-level `finally` block.

Concurrent invocations for the same command must fail closed or reuse the active run; they must
not enqueue duplicate work. Startup recovers abandoned `running` scheduler rows older than the
configured maximum age. Request workers retain bounded retries, leases, idempotent request
identity, and a maximum batch total.

The Windows installer remains explicit: it installs exactly one hourly and one daily scheduled
task with restart-on-failure settings. A verification command must report whether both tasks are
installed and whether the latest DB scheduler run satisfies the expected cadence.

### 3.2 Health contract

The health API and Quant dashboard expose:

- expected versus active datasets by market and timeframe;
- missing and stale dataset counts using market-specific freshness rules;
- missing-bar totals;
- queued/running backlog and oldest backlog age;
- provider failures in the last 24 hours, grouped by provider and error code;
- last scheduler success and latest scheduler terminal status.

`ready=true` requires no missing required dataset, no stale required dataset outside its SLA, no
over-age backlog, and a recent successful scheduler run. The UI must distinguish `ready`,
`degraded`, and `failed`; a partial free-provider outage is degraded with exact counts, not a
generic success.

### 3.3 Operational acceptance

- Unit/integration tests prove command-to-timeframe mapping, duplicate prevention, lease recovery,
  terminal scheduler state, and health aggregation.
- The repository includes install and verify commands for Windows deployment.
- A local all/daily smoke records a terminal scheduler run and the verifier returns structured
  evidence. If an external provider fails, the run may be `failed` or `degraded`, but no work is
  silently dropped and the dashboard identifies the provider/error.

## 4. Workstream 2 — Safe Vietnam Adjusted Data

### 4.1 Corporate-action normalization

The VCI adapter normalizes only these price-affecting events:

- cash dividend: positive cash per share and ex-right date;
- stock dividend/bonus issue: positive distribution ratio and ex-right date;
- stock split: positive distribution ratio and ex-right date;
- rights issue: positive subscription ratio, non-negative subscription price, and ex-right date;
- symbol change: old/new symbol and effective date, retained for lineage but excluded from price
  adjustment arithmetic.

Incomplete or ambiguous DIV/ISS records remain `unverified` with the original payload. Parser
tests cover the Vietnamese and English labels observed in stored VCI payloads. Unknown issuance
events are never coerced into a numeric factor.

### 4.2 Adjustment mathematics

Events sharing an ex-right date are combined once. The prior close is the last HOSE market bar
before that date. Price and quantity factors remain separate:

- cash dividends affect price only;
- stock dividends and splits affect price and historical quantity by their share-count ratio;
- rights issues use the theoretical ex-right price and their share-count ratio;
- post-event bars remain unchanged.

Cash values from VCI are converted from VND to the provider's thousand-VND bar unit before the
factor is calculated. All calculations use `Decimal`; database quantization happens only at the
publication boundary.

### 4.3 Publication eligibility and lineage

Publication requires corporate-action coverage `start <= raw coverage start` and
`end >= raw coverage end`, complete pagination, and zero unverified price-affecting events in the
raw range. Failure deactivates any previously active adjusted version for that asset/timeframe but
does not delete it or modify raw data.

Each published `total_return` manifest contains the raw dataset version ID, verified action
checksums, action coverage range, calendar version, timezone, value scale, applied-event count,
and adjustment policy. Backtest and Optimizer selectors show raw/adjusted availability explicitly
and cannot submit an unavailable policy.

### 4.4 Acceptance

- Golden tests cover cash-only, stock/rights combinations, multiple events on one date, price-unit
  conversion, missing terms, incomplete coverage, and future events outside the raw range.
- A DB smoke either publishes a valid active `total_return` version or safely reports `blocked`
  with no active adjusted version.
- Raw checksums and row counts are unchanged by adjusted publication.

## 5. Workstream 4 — Quant VI/EN and Encoding

### 5.1 Coverage

The scan includes Quant Lab shell, data-health panel, Portfolio Optimizer, Strategy Lab, Backtest
builder/results/advanced analysis, Factor Lab, forward-testing surfaces in Mock Portfolio, toasts,
empty/error states, chart titles, table headers, aria labels, and status labels.

All user-facing strings move to `src/lib/i18n/dictionary.ts`. Provider names, symbols, strategy
codes, version numbers, and raw error codes remain untranslated identifiers. English and
Vietnamese dictionaries must have identical key structure.

### 5.2 Mojibake prevention

Known malformed sequences such as `Ã`, `Â`, `áº`, `á»`, and the Unicode replacement character are
removed from source-controlled UI text. A repository test scans Quant-owned TypeScript/TSX files
and fails when these signatures reappear. Correct Vietnamese literals are stored as UTF-8.

Locale changes must update mounted Quant content immediately without a reload. Dynamic server
data is formatted with the selected locale for dates and numbers where applicable.

### 5.3 Acceptance

- Dictionary parity test passes.
- Mojibake scan passes for all Quant-owned UI files.
- Component tests render representative Optimizer, Strategy Lab, Backtest, Factor Lab, and
  forward-test content in both `vi` and `en`.
- Browser smoke confirms the same mounted Quant page changes visible text when VI/EN is toggled.

## 6. Workstream 5 — Database-backed Strategy Lab

### 6.1 Source of truth

`CustomStrategy`, `CustomStrategyVersion`, and its linked executable `StrategyVersion` are the
only durable source of truth. The existing tenant-scoped APIs provide list, create, create-version,
and archive operations. The Strategy Lab UI loads these records from the API and shows loading,
empty, error, active, and archived states.

The browser `radarasset.strategy-lab.v1` payload is treated only as a one-time migration source.
After authenticated migration succeeds, the key is removed. Failed or unsupported legacy records
remain local and the UI reports how many were not imported; it must not silently discard them.

### 6.2 Executable scope

Production custom execution remains intentionally limited to:

- monthly scheduled DCA;
- price-threshold crossing rules.

Catalog presets are references to the shared strategy catalog and do not create tenant strategy
rows. Fundamental threshold drafts remain visibly unavailable until point-in-time fundamental
ingestion exists; they cannot be saved as executable versions.

### 6.3 Version and archive behavior

Creating a strategy writes version `1.0.0` and its executable registry row atomically. Editing an
active strategy creates `1.0.1`, `1.0.2`, and so on; prior versions remain queryable and runnable
for reproducibility. The UI can choose a specific active version for Backtest. Archiving hides the
strategy from new catalog selections while preserving historical backtest and assignment links.

Duplicate submissions are protected by the UI pending state and an idempotency/fingerprint guard
at the service boundary. Tenant A cannot read, version, archive, or execute Tenant B's strategy.

### 6.4 Acceptance

- API/service tests prove tenant isolation, editor authorization, immutable version increments,
  archive behavior, and duplicate protection.
- Strategy Lab no longer writes new strategies to localStorage.
- A browser/API smoke creates a DCA or price rule, creates a second version, selects it in
  Backtest, and archives it without losing previous run references.

## 7. Delivery Sequence

Each workstream is independently tested and committed before the next begins:

1. ingestion scheduler and health;
2. corporate actions and adjusted publisher;
3. Quant i18n and mojibake guard;
4. Strategy Lab API client and DB-backed UI;
5. full Vitest, Python, TypeScript, Prisma, production build, DB smoke, browser smoke;
6. merge/push `main` and restart the canonical local launcher.

## 8. Explicit Non-goals

- Paid market-data providers or guaranteed provider uptime.
- Fundamental P/B, P/E, ROE, or earnings execution before point-in-time ingestion.
- Machine-learning prediction models.
- A second workflow engine, queue system, or strategy DSL.
- Deleting historical raw datasets, adjusted versions, strategy versions, or backtest runs.
