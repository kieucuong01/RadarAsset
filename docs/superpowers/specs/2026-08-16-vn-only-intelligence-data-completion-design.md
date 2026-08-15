# VN-Only Intelligence Data Completion Design

## Goal

Complete the highest-value missing inputs for Smart Insights while making Vietnamese equities the only supported equity market. Crypto and gold remain supported. Foreign equities and ETFs are permanently removed from product data.

## Product Scope

- Supported markets: `vn_equity`, `crypto_spot`, and `metal_spot`.
- Supported equity representatives include `VNINDEX` and `VN30` plus Vietnamese listed equities.
- Unsupported equity and ETF assets include SPY, QQQ, NVDA, TSLA, and any other asset outside `vn_equity` whose asset class is equity or ETF.
- XMR is removed from the curated Crypto universe because its current free price source stopped in 2024.
- No seed or synthetic decision value may substitute for an unavailable source.

## Source Completion

### FRED Macro

Collect real yield, broad USD, M2, Fed balance sheet, reverse repo, Treasury General Account, policy rates, inflation, employment, and growth series from an official free FRED path. Prefer the existing API when a configured key is available; otherwise use a bounded official CSV endpoint that does not require a key. Publish only validated numeric observations and preserve source timestamps.

### CFTC Gold

Collect the disaggregated gold managed-money series from the official CFTC public dataset. Feed normalized managed-money net open interest into the XAU positioning pillar. Keep weekly freshness and fail closed when the market row or denominator is missing.

### CoinShares

Use the existing Scrapling discovery and OCR/table extraction path for the weekly Digital Asset Fund Flows report. Publish the global weekly net flow only when the report date, currency unit, and extracted value pass validation. Keep OCR-derived evidence attributed and research-only.

### Enablement Gate

A source remains disabled until its production collector passes a bounded live-smoke against the real upstream page or API and publishes valid observations. A failed smoke leaves the source disabled and visible as unavailable; it never creates zero or sample values.

## BTC Large-Address Decision Factor

Use `crypto.large_address.exchange_flow_pressure_btc` only for BTC. Add it to the sentiment/on-chain pillar with a small 10% input weight, rebalanced from existing on-chain sub-inputs so total pillar weights remain unchanged. The fact contributes only when fresh and when address, transaction, and label coverage gates from the existing large-address pipeline pass. Positive exchange pressure is bearish; negative exchange pressure is bullish. BitInfoCharts balance snapshots remain supporting context and are not treated as transaction flow by themselves.

## Scheduler and Backlog

- Daily: curated market bars, daily Smart Insights sources, CryptoCraft current calendar, derived Macro/Crypto/Gold pipelines, and all-membership briefing regeneration.
- Four-hourly: CoinGlass collectors only.
- Weekly: CoinShares and CFTC collectors, followed by affected derived pipelines and briefing regeneration.
- The curated market list contains VNINDEX, VN30, Vietnamese portfolio/watchlist symbols, supported Crypto excluding XMR, and XAU. It never expands to the whole provider catalog.
- Existing active ingestion requests outside the supported scope are marked failed with an explicit retired-scope error so audit history remains. Requests and data belonging to permanently removed foreign equities/ETFs are deleted with those assets.

## Permanent Foreign-Equity Purge

Create an idempotent maintenance command with dry-run as the default. It resolves unsupported assets from database market and asset-class fields rather than relying only on a symbol list, prints table-by-table counts, and requires `--apply` for mutation.

The apply path runs in one database transaction and permanently removes dependent portfolio positions, transactions, watchlists, alerts, insight/forecast records, market datasets and bars, provider instruments, ingestion requests, and finally unsupported asset rows. Any unexpected remaining foreign-key dependency aborts and rolls back the whole transaction. Seed data and E2E fixtures are changed to Vietnamese equities so removed assets cannot return on reseed.

API and universe boundaries reject new unsupported equity/ETF assets after the purge. Historical exports are not retained because the user explicitly requested permanent deletion.

## UI Behavior

- Asset selectors and ticker strips show Vietnamese equities only; Crypto and XAU remain unchanged.
- VNINDEX and VN30 are labelled as Vietnamese market indices.
- Removed US symbols disappear rather than showing `INSUFFICIENT DATA`.
- Source health distinguishes disabled, unavailable, stale, and successful sources.

## Performance and Safety

- Opinion data loading remains bounded to at most 25 assets, 260 bars per symbol, and the existing decision-fact allow-list.
- Scheduler work is proportional to the curated universe, never the full catalog.
- Purge discovery uses set-based SQL and one transaction; it does not delete row-by-row from application code.
- Live collection is bounded by existing page/row limits and reuses current provider and artifact boundaries.

## Verification

- TDD unit and integration tests cover enabled-source selection, FRED fallback, CFTC and CoinShares validation, whale-factor scoring, VN-only universe filtering, purge dry-run/apply rollback behavior, and scheduler scope.
- Run live-smoke separately for FRED, CFTC Gold, and CoinShares before adding each source to `ENABLED_SOURCE_CODES`.
- Apply the purge only after its dry-run counts are reviewed; verify no unsupported equity/ETF asset or dependent row remains.
- Regenerate briefings and verify BTC uses whale pressure when eligible, XAU uses CFTC/real-yield/USD inputs, and altcoins receive Macro inputs when fresh.
- Run the complete Python and frontend suites, lint, production build, and bounded runtime timing checks.
