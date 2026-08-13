# Quant P0.2 data-quality verification

Verified locally on 2026-08-14 against the configured PostgreSQL database.

## Delivered contracts

- Versioned calendar contracts for HOSE, crypto 24x7, and XAU 24x5 rollover behavior.
- Certified HOSE range is explicit (2024-01-01 through 2026-12-31); intersecting uncertified periods fail closed.
- Missing timestamps are classified into bounded ranges: `PROVIDER_GAP`, `LISTING_INACTIVE`, `SUSPENSION_UNVERIFIED`, and `CALENDAR_RANGE_UNVERIFIED`.
- Only `PROVIDER_GAP` contributes to `missing_bar_count`; bars are never generated or forward-filled.
- New immutable dataset versions persist classification, range boundaries, calendar lineage, and aggregate classification counts.
- Asset search and run creation both reject provider gaps or uncertified calendar ranges intersecting the requested backtest period. Issues outside that period remain non-blocking evidence.

## Database evidence

The read-only quality report found 134,542 missing bars across five legacy groups:

- VN equity 1d: 67,135.
- VN equity 1h: 60,184.
- Crypto 1h: 1,060.
- XAU 1d: 20.
- XAU 1h: 6,143.

These active versions predate range classification and are reported as `LEGACY_UNCLASSIFIED`; they were not mutated. The existing bounded queue accepted 36 daily identities for refresh. The watch worker remained live with a current request, while upstream network access continued to block Vnstock/Binance convergence in this local environment.

## Verification evidence

- Calendar and quality suites: 18 passed.
- Publication and PostgreSQL lineage suite: 6 passed.
- Asset/run fail-closed suites: 22 passed.
- Quality report aggregation: 1 passed.
- Prisma migration `202608140005_dataset_quality_ranges` applied successfully.
- Prisma validation and TypeScript passed.

## P0.2 conclusion

New dataset publications now produce explainable, range-aware quality evidence. Current legacy versions remain degraded until providers are reachable and the bounded queue publishes replacement versions; the product must not claim that the existing 134,542 missing bars have been repaired.
