# Quant P0.3 Historical Correctness Verification

Date: 2026-08-14
Branch: `feat/quant-p0-production`

## Outcome

The code path is fail-closed and the local database is **not yet production-ready for adjusted VN backtests**. Historical listing intervals and survivorship disclosures are implemented. Raw datasets remained immutable throughout the adjusted publication attempt.

## Listing retention and survivorship

- Two consecutive controlled catalog-sync test runs retained the asset and immutable datasets after the first absence.
- Only a second confirmed absence from a complete catalog snapshot closed the listing interval and marked the instrument inactive.
- Inactive historical assets remain searchable for periods covered by their immutable dataset.
- Catalog items and completed run manifests expose `SURVIVORSHIP_COVERAGE_PARTIAL` when the requested range predates the first observed listing snapshot.
- The listing observation date participates in the resolved run fingerprint, so a later universe-history correction cannot reuse a stale cached result.

## Independent VN adjustment audit

Command:

```powershell
$env:PYTHONPATH='quant-worker'
python quant-worker/audit_vn_adjustments.py --env-file ..\..\.env.local
```

Local DB result: `blocked`.

- Basket present: cash dividend, stock dividend, rights issue, unresolved action.
- Basket missing: inactive listing and split.
- Verified ex-date groups inspected: 22.
- Valid raw-to-adjusted lineage groups: 0.
- Unresolved corporate actions: 18.
- Active FPT raw dataset version: `bd6f0f4d-db44-4de7-9829-6b28a998b162`.
- Raw checksum before publication: `e9d7ef434a2559a4218dd77411e2ecd386db654e5a4cfdfcb78db2d2d3029803`.

The audit uses an independent `Decimal` implementation for theoretical ex-price and quantity factors. It does not reuse the production adjustment helper.

## Adjusted publication gate

Command:

```powershell
python quant-worker/publish_adjusted_datasets.py --env-file ..\..\.env.local
```

Result:

```json
{"status":"succeeded","published":0,"unchanged":0,"skipped":0,"blocked":808,"blockedReasons":{"coverage":808,"unverified":0,"quality":0}}
```

All 808 candidates were blocked because corporate-action coverage does not contain the active raw dataset range. No incomplete adjusted version was activated. The audit after this run reported the same raw version and checksum, proving the adjusted path did not mutate raw bars.

## Regression evidence

- Python catalog, adjustment, publication, and audit: 25 passed.
- Vitest catalog, run, hash, result model, and builder: 64 passed.
- Quant worker legacy portfolio compatibility: 17 passed.
- TypeScript: `npx tsc --noEmit --pretty false` passed.
- Targeted ESLint passed.

## Production blockers carried forward

1. Backfill and verify corporate actions across the entire active VN raw coverage before any `total_return` dataset can be activated.
2. Resolve or reject the 18 incomplete FPT actions with preserved source evidence.
3. Add confirmed inactive/delisted and split cases to the real audit basket.
4. Re-run the audit until every selected case has valid raw lineage and independent factor evidence.
