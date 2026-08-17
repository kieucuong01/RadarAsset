# HOSE Core 2016 Production Backfill Design

**Date:** 2026-08-17

**Status:** Approved for implementation

## Goal

Backfill verified daily market data from `2016-01-01` through the latest closed HOSE
session for the existing nine-symbol Vietnam core universe:

- `VNINDEX`
- `VN30`
- `FPT`
- `VCB`
- `HPG`
- `VNM`
- `MWG`
- `SSI`
- `VIC`

The same mechanism must later expand incrementally to selected HOSE symbols or all active
HOSE instruments without replacing the ingestion architecture.

## Existing Constraints

- Market data remains daily-only. This work must not restore the removed `1h` timeframe.
- Production PostgreSQL is the serving database. Historical files or private S3 objects are
  transport and recovery artifacts only.
- Provider values must be live and source-attributed. Failed provider reads must never be
  replaced with fixture, synthetic, forward-filled, or emergency values.
- Dataset versions and bars are immutable. A new version becomes active only after its full
  payload passes publication checks.
- The currently active version remains available when one symbol fails to backfill.
- Vietnam adjusted or `total_return` publication remains fail-closed until corporate-action
  coverage contains the entire raw range and every price-affecting action is verified.
- The initial production run is restricted to the nine approved symbols. It must not enqueue
  every discovered HOSE instrument.

## Architecture

### Reusable backfill profiles

A code-owned profile registry defines stable, reviewable backfill scopes. The first profile is
`vn-core-2016`, with the exact nine symbols above and a fixed start date of `2016-01-01`.

The backfill command supports three selection modes through one implementation:

1. a reviewed profile such as `vn-core-2016`;
2. an explicit bounded symbol list;
3. all active HOSE provider instruments, guarded by an explicit flag and batch limit.

Profile, explicit-list, and all-active selections resolve to the same normalized work items, so
future expansion changes only selection input. Provider fetching, quality validation,
publication, operational evidence, and daily refresh behavior stay unchanged.

### Historical boundary and market calendar

The HOSE research calendar is extended to cover `2016-01-01` through the maintained future
boundary. Exchange closure dates for 2016 onward are explicit, versioned, and tested. Unknown
weekdays are not silently classified as holidays.

The provider adapter accepts the selected historical start instead of clamping every Vietnam
request to the previous 2024 boundary. The VN index path must not impose a shorter hidden range
than the approved profile. A symbol listed after `2016-01-01` legitimately starts at its first
available trading session; the system does not generate earlier rows.

### Bounded, resumable execution

The backfill command processes one symbol at a time with a bounded provider request and a stable
summary. It accepts dry-run and batch controls, validates every requested symbol against active,
approved Vietnam provider instruments, and rejects unsupported markets or providers.

Each symbol follows the existing production path:

1. load the active daily raw snapshot;
2. fetch provider bars from the required historical boundary through the latest closed session;
3. normalize timestamps and OHLCV values;
4. merge by timestamp with any certified active rows;
5. calculate missing-session and quality evidence against the versioned HOSE calendar;
6. publish a new immutable version only when its checksum differs and quality is eligible;
7. leave the previous active version untouched on failure;
8. record a sanitized per-symbol result.

The command is idempotent. A rerun whose active version already has the required coverage and
latest closed session reports `already_complete` without publishing another version. An
interrupted run resumes by re-evaluating each symbol against current database coverage; no local
checkpoint file is authoritative.

### Daily incremental refresh

The one-time backfill is separate from the normal daily schedule. After completion, the existing
daily worker requests only a recent overlap around the latest active bar, merges provider
corrections by timestamp, and publishes a replacement immutable version when the checksum
changes. It does not reload ten years on every daily run.

When a new HOSE symbol later enters an approved profile, explicit request, portfolio, or watchlist,
the same history-gap rule can backfill it from the configured boundary before normal incremental
refreshes continue.

## Production Execution

Production execution uses a narrow, root-owned runner with an allowlisted profile argument. The
runner uses the production Python environment and production `.env` file without printing secret
values. It acquires the shared heavy-job lock so it cannot compete with market ingestion, Smart
Insights collection, or backup work.

The release workflow performs these steps in order:

1. build and verify the release artifact;
2. deploy and pass web, quant-engine, worker, and database readiness checks;
3. run a no-write production preflight for `vn-core-2016`;
4. run the bounded one-shot backfill;
5. verify database coverage and a representative real backtest;
6. retain the normal daily market timer unchanged.

Backfill failure fails the operational workflow and preserves the deployed application plus all
previous active datasets. It does not roll the application release back solely because an
external provider was unavailable.

## Future HOSE Expansion

Expansion does not require a new data path. An operator can add a reviewed profile or invoke the
same command with an explicit list. Full-HOSE expansion requires the explicit all-active flag,
small batches, and the same preflight and verification gates. The database catalog remains the
source of eligible active provider instruments; a code edit is not required for every newly
listed company.

The operational runbook records exact dry-run, bounded execution, retry, coverage audit, and
backtest commands. It also records rate-limit and disk/memory guidance so full-HOSE work can be
spread across multiple runs.

## Quality and Safety Gates

For every requested symbol, production evidence must report:

- provider code and provider symbol;
- active raw dataset version;
- coverage start and coverage end;
- row count and missing-bar count;
- quality status and classified range counts;
- latest ingestion result;
- available adjustment policies.

The core run succeeds only when all nine symbols have an eligible active raw daily version whose
coverage starts on `2016-01-01` or the first legitimate provider/listing session after that date,
and ends on the latest closed HOSE session available from the provider. `total_return` is reported
separately and is not required for raw backfill success.

At least one moving-average backtest must read a newly published production dataset through the
normal quant engine. Direct SQL row presence alone is insufficient proof that the application can
consume the history.

## Testing

Automated tests cover:

- the exact membership and start date of `vn-core-2016`;
- rejection of unapproved symbols, providers, markets, and non-daily timeframes;
- the 2016 initial window and recent-overlap incremental window;
- a later-listed symbol beginning after the profile start;
- idempotent `already_complete` behavior;
- per-symbol failure preserving the active version;
- HOSE closure classification for the expanded calendar range;
- bounded all-active selection without running it in the initial production release;
- production runner allowlisting, heavy-job locking, and secret-safe output.

Production verification is separate from unit and integration tests. It must use the active VPS
database, live provider responses, deployed release SHA, service state, and authenticated or
read-only engine evidence.

## Non-goals

- No intraday or `1h` data.
- No U.S. equities.
- No new market-data provider unless the current provider fails a documented live capability
  check and the replacement is separately approved.
- No automatic full-HOSE production run in this change.
- No relaxation of raw-data quality, freshness, lineage, or corporate-action gates.
- No user-facing administration dashboard.
