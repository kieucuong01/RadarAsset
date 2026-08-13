# Scrapling Farside and CoinShares OCR Design

## Goal

Complete the remaining live Crypto fund-flow inputs for Smart Insights without paid crawling services or invented values:

- collect the Farside BTC, ETH, and SOL ETF tables daily with Scrapling;
- collect the weekly CoinShares report with Scrapling and extract its published tables from images with local OCR;
- remove World Gold Council (WGC) from the active product and collection surface while preserving historical database rows and artifacts;
- enable each new source only after its live parser and database publication pass.

CryptoCraft remains on Crawl4AI. BitInfoCharts remains disabled because its anti-bot challenge did not pass the bounded live smoke.

## Scope and non-goals

This change covers the source registry, acquisition adapters, Farside and CoinShares collectors, schedules, data-health exposure, active Gold metric composition, tests, operational documentation, migrations/seeding required by the existing schema, live smoke, and source enablement.

It does not add proxies, CAPTCHA-solving services, paid APIs, LLM-based numeric extraction, manual data entry, daily interpolation of weekly CoinShares data, or deletion of historical WGC observations, snapshots, runs, and evidence.

## Architecture

### Acquisition ownership

Browser-backed sources use the acquisition engine proven for that provider:

| Source | Engine | Transform | Frequency |
| --- | --- | --- | --- |
| CryptoCraft | Crawl4AI | Existing calendar parser | Calendar schedule |
| Farside BTC/ETH/SOL | Scrapling HTTP Fetcher | Deterministic HTML-table parser | Daily |
| CoinShares | Scrapling HTTP Fetcher | Deterministic article discovery plus local OCR | Weekly |

Add `CollectionMode.SCRAPLING` and a `ScraplingClient` adapter with the existing `scrape(source, url) -> RawSnapshot` boundary. `CollectionMode.CRAWL4AI` remains for CryptoCraft. The source registry and Data Health therefore state the actual acquisition method instead of labelling Scrapling results as Crawl4AI.

The adapter will:

- accept only URLs allowed by the code-owned source definition;
- use Chrome impersonation and stealth headers without proxies or challenge solvers;
- reject cross-host or non-allow-listed redirects;
- enforce response status, content type, timeout, and maximum payload size;
- return the existing JSON snapshot envelope containing raw HTML, final URL, status, and bounded acquisition metadata;
- expose a bounded binary-download operation for CoinShares images, subject to the same URL and size checks;
- map provider/network failures to stable error codes without leaking upstream page content into logs.

`scrapling` is pinned in the Python worker requirements. Its optional browser/StealthyFetcher runtime is not required for these two successful HTTP paths.

### Farside table normalization

Each Farside collector reads the raw HTML returned by Scrapling and selects the provider table deterministically. The live table has a multi-row header, so normalization will:

1. identify the row containing the fund tickers;
2. label the first column `Date` and the last column `Total`;
3. ignore fee/header/footer rows and keep only rows with a valid provider date;
4. preserve fund names and provider values exactly until numeric parsing;
5. convert blanks and provider dash symbols to zero only under the existing Farside contract;
6. require the reported total to reconcile to the sum of fund columns within the existing USD rounding tolerance.

The collector continues to reject current/incomplete UTC dates, duplicate dates, invalid values, and non-reconciling rows. A rejected date produces no observations for that date. BTC, ETH, and SOL remain separate source codes and produce per-fund plus `TOTAL` observations.

### CoinShares article and image acquisition

The collection flow is:

1. scrape the allow-listed CoinShares research index;
2. discover the newest `fund-flows-*` article using its published date and allow-listed path;
3. scrape that article and obtain the report date, publication date, text, and candidate image URLs;
4. select only images whose surrounding caption/alt text identifies the weekly asset-flow or region-flow table;
5. download the selected images from an explicitly allow-listed CoinShares CDN host/path;
6. store a composite immutable snapshot containing article evidence, image URLs, image hashes, original image bytes, OCR version, and OCR token output.

The article and every selected image have independent byte limits. An unexpected redirect, missing image, duplicate report, unrecognised layout, or changed CDN host fails closed.

### Local OCR pipeline

Use `rapidocr` with the CPU `onnxruntime` backend. It is local, free, supports Python 3.12, and returns text boxes and confidence values needed for deterministic table reconstruction.

The OCR pipeline performs bounded image preprocessing (orientation, upscale, grayscale, contrast, and threshold variants), then keeps the highest-quality result that passes all structural checks. It does not ask an LLM to read, repair, or infer a number.

Tokens are assigned to rows and known columns by their bounding-box coordinates. The reconstructed canonical tables are:

- `Asset | Week flow | AUM`
- `Region | Week flow | AUM`

Units must be visible in the image or report context and are normalized explicitly to USD before publication. Parentheses represent negatives; commas, currency symbols, en/em dashes, and decimal points use allow-listed conversions. Ambiguous substitutions such as `O/0`, `I/1`, or missing decimal separators are never silently corrected.

### OCR quality and reconciliation gates

A CoinShares weekly report is accepted only when all gates pass:

- report period and publication timestamp are present in article evidence and are not in the future;
- both expected tables and all required headers are present;
- every published numeric cell used by the collector meets the configured OCR confidence threshold;
- labels are non-empty and unique within each dimension;
- values and units parse without heuristic character repair;
- each table has the expected minimum coverage and a single identifiable total/global row;
- asset weekly flow and region weekly flow reconcile to the same global weekly flow within a documented rounding tolerance;
- AUM values are non-negative and the global AUM values reconcile when both tables publish them.

Failure of any gate rejects the complete report period with a stable reason such as `OCR_LOW_CONFIDENCE`, `OCR_LAYOUT_DRIFT`, `MISSING_TABLE`, `INVALID_UNIT`, or `RECONCILIATION_FAILED`. The prior accepted period remains visible and becomes stale according to its weekly SLA; failed OCR never overwrites it.

CoinShares observations retain their actual weekly effective period and publication timestamp. They are not copied into daily rows.

## WGC removal and historical preservation

Remove `wgc-gold-etf` and `wgc-central-bank` from:

- the code-owned active source registry and source URL allow-list;
- collector construction and schedule dispatch;
- enabled/disabled source inventory shown by Data Health;
- active Gold metric definitions, score inputs, coverage calculations, runbooks, and current tests;
- runtime dependencies and code that exist only for WGC spreadsheet acquisition/parsing.

Database cleanup is intentionally non-destructive. Existing WGC source rows, collection runs, snapshots, observations, evidence, and historical derived snapshots remain in place for audit and point-in-time history. Registry synchronization must use upsert/no-delete behavior. No migration may cascade-delete WGC-linked records.

With WGC removed, Gold continues from the remaining implemented inputs such as price-derived metrics, FRED macro series, and CFTC positioning. Coverage thresholds and methodology text must reflect only active inputs so WGC cannot silently reduce the current Gold score.

## Source enablement and delivery gate

Farside and CoinShares start disabled in the code-owned enabled set. For each source independently:

1. run focused unit and integration tests;
2. run a bounded live acquisition and production parser smoke;
3. apply the existing database migration/seed synchronization;
4. publish the live batch to the configured database;
5. verify the collection run status, accepted observation count, latest effective date, source URL, and Data Health result;
6. add only that successful source code to `ENABLED_SOURCE_CODES`;
7. rerun the relevant schedule and regression suite.

BTC, ETH, SOL, and CoinShares are enabled independently. A failure in one does not make another appear healthy. Fixture success is not accepted as live-provider proof.

## Testing

Tests will cover:

- Scrapling URL allow-listing, redirects, content types, timeouts, response limits, and stable failures;
- Farside live-shaped multi-row headers, fee rows, missing values, negatives, duplicate dates, incomplete dates, and total reconciliation;
- CoinShares article discovery, CDN allow-listing, image limits, composite artifact hashes, OCR bounding-box reconstruction, confidence thresholds, units, negatives, layout drift, duplicate labels, and cross-table reconciliation;
- WGC absence from active registry, schedules, Data Health, Gold scoring, and docs while a database fixture proves historical WGC records are not deleted;
- unchanged CryptoCraft Crawl4AI behavior;
- daily Farside and weekly CoinShares scheduling and freshness semantics.

## Operational behavior

The runbook will document the pinned Scrapling and RapidOCR dependencies, ONNX Runtime CPU verification, local model-cache behavior, live-smoke commands, failure codes, and source-by-source enablement evidence. OCR model initialization happens once per worker process. Images and OCR work are bounded so a malformed report cannot exhaust memory or create an unbounded artifact.

Rollback disables the affected source code and reverts its adapter/collector wiring. Accepted immutable artifacts and observations remain auditable. WGC is not automatically restored by rollback; restoring it requires a separate explicit product decision.
