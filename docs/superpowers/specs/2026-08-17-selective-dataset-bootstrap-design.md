# Selective Dataset Bootstrap Design

**Date:** 2026-08-17  
**Status:** Approved for implementation planning

## Objective

Bootstrap production with useful historical daily market data already present in the local PostgreSQL database without recrawling the full history, copying untrusted or stale data, or making the production web application depend on S3 at request time.

The initial transfer covers only active, verified `1d` raw datasets. Hourly data, inactive versions, adjusted datasets, corporate actions, fixtures, demo data, and simulated data are outside this bootstrap.

## Decisions

- PostgreSQL remains the runtime data store for charts, APIs, and backtests.
- Private S3 is only the transfer and recovery layer.
- The transfer unit is one immutable compressed dataset plus a batch manifest.
- Local and production identifiers are mapped by business keys, never copied UUIDs.
- Import is idempotent and atomic per dataset.
- Production does not retain superseded dataset versions merely for rollback.
- Recovery uses the immutable S3 package instead of an old PostgreSQL version.
- The bootstrap is manually operated. The existing production `market-daily` timer owns subsequent incremental refreshes.

## Considered Approaches

### Selected: immutable per-dataset packages through private S3

This approach supports streaming, per-dataset integrity checks, retries after interruption, bounded VPS disk usage, and safe remapping between independent databases.

### Rejected: selective `pg_dump`

A table-level dump would be faster to create but would couple local UUIDs and relational state to production. It also increases the risk of copying ingestion operations, inactive versions, or unrelated application state.

### Rejected: recrawl all history on production

Recrawling avoids a transfer utility but is slower, places avoidable load on public providers, and exposes the bootstrap to provider rate limits and historical availability changes.

## Architecture

The data path is:

`local PostgreSQL -> compressed private S3 package -> production PostgreSQL -> web and backtests`

S3 is not present in the application request path. The production importer downloads one dataset at a time to a bounded spool directory, validates it, imports it into PostgreSQL, and removes the temporary file. Web and backtest latency therefore remain governed by PostgreSQL as they are today.

The design has four isolated components:

1. **Eligibility scanner** reads local metadata and bars, applies the approved gates, and emits a dry-run report.
2. **Exporter** streams eligible bars into deterministic compressed files and creates an integrity manifest.
3. **S3 transfer store** uploads immutable objects and verifies object length and digest metadata before publishing a complete manifest.
4. **Production importer** validates the manifest and dataset, maps business keys, publishes a new active version transactionally, and prunes superseded unreferenced versions.

## Eligibility Contract

A dataset is eligible only when all of these conditions hold at export time:

- The dataset version is active.
- `timeframe = '1d'` and `adjustment_policy = 'raw'`.
- The asset market is `vn_equity`, `crypto_spot`, or `metal_spot`.
- The provider and provider instrument are active.
- The provider code is one of the project's approved daily providers.
- Quality status is `passed` or `warning`; `failed` is rejected.
- Coverage is no more than three days stale, matching the current ingestion health policy.
- Source metadata and row sources do not identify fixture, demo, seeded, or simulated data.
- Stored `row_count` equals the actual bar count.
- Timestamps are unique and strictly ordered in the exported representation.
- OHLC values are valid and the normalized dataset checksum can be reproduced.

A `warning` dataset remains eligible, but its quality status, quality summary, and issues stay visible in the imported version. The scanner reports counts and reasons under at least:

- `eligible`
- `skipped_stale`
- `skipped_quality`
- `skipped_untrusted`
- `skipped_invalid`

The exporter does not promise to transfer every locally active symbol. It transfers only the symbols that satisfy the contract during that run.

## Package Contract

Each batch uses an immutable prefix:

`operations/dataset-sync/<batch-id>/`

The batch contains:

- One `manifest.json` describing the batch and every selected dataset.
- One deterministic `bars.csv.gz` object per dataset.
- An S3 object digest and byte length for every object.

The manifest records at least:

- schema version and batch identifier
- export timestamp
- provider code and provider symbol
- asset canonical key, symbol, name, market, venue, currency, and timezone
- timeframe and adjustment policy
- coverage start and end
- row count and missing-bar count
- quality status, quality summary, and transferable quality issues
- source metadata
- normalized dataset checksum
- compressed object key, byte length, and SHA-256 digest

CSV timestamps use UTC ISO-8601. Prices and volume are serialized as decimal strings so the round trip does not introduce floating-point changes. Quality flags use deterministic JSON encoding.

Objects are uploaded with single-part `put_object` because the configured Vietnix-compatible S3 endpoint has previously rejected multipart upload permissions. The complete manifest is uploaded last. An importer must ignore a prefix without a valid complete manifest.

## Import Semantics

The importer maps data by:

`provider_code + asset canonical_key + timeframe + adjustment_policy`

It does not copy local primary keys. For each dataset it performs these steps:

1. Validate the locator is inside the configured private bucket and dataset-sync prefix.
2. Download the object into the bounded production spool.
3. Verify compressed byte length and SHA-256.
4. Stream-parse rows and verify schema, ordering, unique timestamps, OHLC constraints, row count, coverage, and normalized checksum.
5. Upsert provider, asset, and provider-instrument metadata by stable business keys.
6. If the active production checksum already matches, record `already_present` and write nothing.
7. Otherwise insert a non-active version and its bars inside a transaction.
8. Recheck stored row count and checksum, deactivate the prior version, and activate the new version.
9. Commit, then remove the spool file.

The importer does not enqueue a large fan-out of backtest, strategy, or AI work inside the import transaction. Derived work is scheduled separately and only after the batch verification succeeds.

## Superseded Version Cleanup

Production does not keep an old version solely as a rollback copy. After the replacement is active and verified, the importer immediately deletes superseded inactive versions and their bars when they are unreferenced.

Deletion must not cascade into user backtests, investment history, strategy results, or other business records. If a foreign-key reference prevents deletion, the importer leaves that version intact and reports `retained_due_to_reference` with reference counts. This exception is a data-integrity safeguard, not a rollback retention policy.

The immutable S3 package is the recovery source. Re-importing it recreates the dataset without requiring an inactive PostgreSQL copy.

## Failure Handling and Resumption

- A failed export does not publish a complete manifest.
- A failed S3 length or digest verification aborts manifest publication.
- A malformed or out-of-prefix locator is rejected before download.
- One dataset failure rolls back only that dataset and does not deactivate its current production version.
- Other datasets in the batch may continue importing.
- Re-running the same manifest is safe: matching checksums become `already_present`.
- Temporary files are removed after success or failure; cleanup errors are reported.
- Final status distinguishes complete success, partial success, and failure.

The final report includes at least:

- `eligible`
- `exported`
- `already_present`
- `imported`
- `failed`
- `retained_due_to_reference`
- rows and compressed bytes processed
- per-dataset reason codes
- the batch manifest digest

## Security and Resource Boundaries

- The bucket remains private.
- S3 credentials and database URLs come from ignored environment files and are never printed or committed.
- Logs redact credentials and database connection details.
- Object locators are allowlisted to the configured bucket and prefix; traversal segments are rejected.
- Digests are verified before data is parsed or written.
- Export and import use server-side cursors or bounded batches rather than loading a full dataset into memory.
- The VPS holds only one compressed dataset spool file at a time and deletes it promptly.
- S3 objects are retained as the recovery artifact; PostgreSQL retains only active data plus versions that cannot be safely deleted because of real references.

## Operator Workflow

1. Run the local eligibility scanner in dry-run mode and review selected/skipped counts.
2. Export and upload the approved batch to private S3.
3. Verify every object with S3 HEAD and publish the complete manifest last.
4. Run the production importer in dry-run mode against the manifest.
5. Apply the import during a controlled maintenance window while the web remains available.
6. Run database verification, a representative backtest, API smoke tests, and web latency checks.
7. Allow the existing production daily ingestion timer to resume incremental ownership.

The sync utility is reusable for another deliberate bootstrap, but no recurring local-to-production timer is installed.

## Testing Strategy

Implementation follows test-driven development.

Unit tests cover:

- eligibility decisions and reason codes
- deterministic serialization and checksums
- manifest validation and path allowlisting
- decimal and timestamp round trips
- duplicate and invalid OHLC rejection
- idempotent checksum behavior
- superseded-version pruning and referenced-version retention
- secret redaction and spool cleanup

Integration tests use PostgreSQL to prove:

- business-key remapping across different UUIDs
- atomic activation only after complete validation
- rollback preserves the prior active version
- repeated import creates no duplicate version or bars
- unreferenced inactive versions are removed
- referenced versions are retained without cascading deletion

S3 tests use a recording client or isolated test bucket behavior to prove upload, HEAD verification, complete-manifest-last ordering, retry, and invalid-locator rejection.

## Production Acceptance Criteria

The bootstrap is complete only when all of these are true:

- The local dry-run report contains no unexplained selected or skipped dataset.
- Every manifest object passes byte-length and SHA-256 verification.
- Every imported production dataset has matching row count, coverage, quality status, and normalized checksum.
- Re-running the manifest reports only `already_present` for successful datasets.
- No superseded unreferenced version remains in PostgreSQL.
- Any retained referenced version is explicitly reported.
- A representative production backtest reads an imported dataset successfully.
- Dataset health verification reports no new missing or stale requirement in the active production scope.
- Public API and web smoke checks return HTTP 200.
- Representative PostgreSQL-backed page/API latency does not materially regress from the pre-import baseline.
- VPS disk usage and spool state are recorded before and after; no transfer file remains in the spool.

## Non-goals

- Migrating hourly datasets.
- Migrating inactive or historical local dataset versions.
- Publishing total-return datasets.
- Migrating or validating corporate actions.
- Serving bars directly from S3.
- Installing a recurring sync from a developer machine.
- Replacing the existing production daily ingestion schedule.
