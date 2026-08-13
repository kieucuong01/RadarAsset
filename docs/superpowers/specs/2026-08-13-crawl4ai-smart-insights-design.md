# Crawl4AI for Smart Insights Design

**Date:** 2026-08-13

## Goal

Replace the Firecrawl runtime dependency with the open-source Crawl4AI Python library, then use the new browser collector to live-smoke every browser-backed Smart Insights source. A source may enter the code-owned enabled set only after its production parser succeeds against the live provider page.

## Scope

This change covers the browser acquisition boundary used by CryptoCraft, Farside, CoinShares, BitInfoCharts, and World Gold Council collectors. Their existing deterministic parsers, observation validation, immutable artifacts, database publication, scheduling, and data-health contracts remain unchanged.

The change does not add proxies, CAPTCHA solving, arbitrary user-supplied crawl URLs, LLM extraction, distributed crawling, a Crawl4AI HTTP server, or Docker infrastructure.

## Chosen Approach

Run Crawl4AI directly inside the existing Python 3.12 quant worker. Introduce a `Crawl4AIClient` with the same `scrape(source, url) -> RawSnapshot` boundary currently consumed by the collectors. Rename the browser collection mode from `firecrawl` to `crawl4ai` and update CLI wiring, tests, environment documentation, and operational documentation.

This is preferred over either Firecrawl Cloud or Firecrawl self-hosting because the workload is a small allow-listed set of scheduled pages. A local Python library avoids API credits and a separate Docker, queue, and database stack while preserving the existing parser boundary.

## Components

### Crawl4AI adapter

`quant-worker/smart_insights/crawl4ai_client.py` owns browser acquisition and result normalization. It will:

- accept only sources configured with `CollectionMode.CRAWL4AI`;
- reject every URL outside the source's existing HTTPS allow-list before starting a browser;
- run a fresh headless browser context without a persistent profile;
- enable robots.txt checking and disable cache reuse for live collection;
- use a 30-second page timeout and retain the CLI's bounded retry policy;
- request no custom JavaScript, proxy, cookies, local profile, downloads, or external LLM provider;
- verify that the final URL is the requested allow-listed URL;
- require non-empty Markdown or HTML;
- cap the serialized snapshot at 20 MB;
- return the existing JSON `RawSnapshot` envelope with Markdown, raw/cleaned HTML, source URL, status code, and Crawl4AI metadata.

The Crawl4AI import will remain inside the adapter boundary so unit tests can inject a deterministic fake runner without launching Chromium.

### Collector wiring

All browser-backed collectors continue to receive an object exposing `scrape`. Their parser code and fixtures remain unchanged. `collect_smart_insights.py` constructs the Crawl4AI adapter without `FIRECRAWL_API_URL` or `FIRECRAWL_API_KEY`.

### Dependency and attribution

`crawl4ai==0.8.9` will be pinned in `quant-worker/requirements.txt`, and its Chromium runtime will be installed with the project's virtual environment. The repository README will include the attribution required by Crawl4AI's license. No cloud SDK or API key will be installed.

## Data Flow

1. The scheduler selects a registered source.
2. The CLI constructs the Crawl4AI-backed collector.
3. The adapter validates the source mode and exact URL allow-list.
4. Crawl4AI opens the public HTTPS page in a fresh headless Chromium context.
5. The adapter validates the final URL, status, content presence, and size.
6. The unchanged source parser converts the snapshot into typed observations or economic events.
7. Existing validation either accepts the batch or quarantines it with a sanitized error code.
8. Existing artifact and repository code persists accepted source evidence and observations.

## Failure Handling

Browser launch, DNS, timeout, navigation, and blocked-page failures map to the existing sanitized source error categories. Redirects outside the exact registered URL, empty extraction, malformed results, and oversized payloads are rejected before parsing. A failed smoke never modifies `ENABLED_SOURCE_CODES` and never writes observations or artifacts.

If a provider blocks Crawl4AI, that provider remains implemented but disabled. The system will not use fixtures, stale values, invented observations, proxy bypasses, or CAPTCHA services to make the source appear healthy.

## Security and Operations

- Server-side URL fetching remains source-owned and allow-listed, preventing arbitrary SSRF targets.
- Browser state is ephemeral and no application secrets are injected into page context.
- Crawl output is untrusted data and continues through deterministic parsers and schema validation.
- Raw bodies remain in the private immutable artifact store and are not exposed by the public APIs.
- Dependency and Chromium versions are pinned/reproducible; upgrades require tests and live smoke.
- Non-commercial use does not override provider terms or robots.txt; blocked sources remain disabled.

## Verification and Enablement Gate

Implementation follows red-green TDD for adapter contracts, CLI construction, collection-mode registration, and removal of Firecrawl configuration. Verification then runs:

1. focused Crawl4AI adapter and collector tests;
2. the full Smart Insights Python test suite with PostgreSQL integration tests;
3. live smoke for CryptoCraft, each Farside asset, CoinShares, BitInfoCharts, and each World Gold Council source;
4. one database-writing schedule run for every newly enabled source;
5. the full web test suite, TypeScript check, changed-file lint, production build, and `git diff --check`;
6. merged-tree verification before pushing `main`.

Only sources with successful live parser output and accepted database publication are added to `ENABLED_SOURCE_CODES`. The final report separates enabled, disabled, and externally blocked sources with their actual error codes.

## Rollback

The migration is code-only and does not alter stored observation contracts. Rollback removes newly enabled source codes and reverts the Crawl4AI adapter commit. Previously accepted immutable snapshots and observations remain auditable; they are not deleted during rollback.
