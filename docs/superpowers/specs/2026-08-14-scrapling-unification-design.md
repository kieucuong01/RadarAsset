# Scrapling Unification Design

## Goal

Use Scrapling as the only browser-backed acquisition library in Smart Insights. Preserve the currently enabled CryptoCraft calendar behavior, keep every fetch bounded and allow-listed, and remove Crawl4AI plus the separate environment that only exists because the two libraries require incompatible `lxml` versions.

## Decisions

- Route CryptoCraft week and event-detail requests through the existing `ScraplingClient.scrape(source, url) -> RawSnapshot` boundary.
- Decode HTML using the charset declared by `Content-Type`; accept only Python's built-in text codecs and reject unknown or undecodable charsets as `INVALID_RESPONSE`.
- Extend the isolated Scrapling runner allowlist only for the two fixed CryptoCraft week URLs and `/calendar/<event>` detail paths.
- Keep the CryptoCraft source enabled only after current-week and next-week live pages pass the production parser. A detail-page limitation already shared by Crawl4AI (`MISSING_TIMEZONE`) is not part of this migration.
- Change BitInfoCharts to Scrapling ownership but keep it disabled unless a live fetch returns the real richest-address table and the existing production parser succeeds. A Cloudflare page, timeout, fixture, or stale artifact is not enablement evidence.
- Delete the Crawl4AI adapter, enum value, dependency, setup commands, tests, and active documentation. Historical design/plan documents remain unchanged as an audit trail.

## Runtime and data flow

The CLI constructs one `ScraplingClient`. Farside, CoinShares, CryptoCraft, and the disabled BitInfoCharts collector receive that client through the existing collector interface. The subprocess runner performs the network request in the Scrapling environment, returns bytes plus headers and final URL, and the client enforces final-URL equality, status, content type, byte limits, and charset decoding before creating the private snapshot.

After Crawl4AI is removed, Scrapling moves into the main worker requirements. A clean-environment dependency install must prove the former `lxml` conflict is gone before the isolated `.scrapling-venv` setup and subprocess boundary are removed. If the complete dependency set does not resolve cleanly, keep the subprocess boundary temporarily but still remove Crawl4AI.

## Error handling and security

- Fixed HTTPS source URLs and exact host/path allowlists remain mandatory.
- Redirects, non-HTML responses, unsupported charsets, oversized bodies, rate limits, and upstream failures remain fail-closed with stable public error codes.
- No proxy service, CAPTCHA vendor, user-supplied URL, or fabricated observation is added.
- BitInfoCharts stays disabled if Scrapling cannot reliably pass the provider challenge within the existing timeout budget.

## Verification

- TDD covers charset decoding, CryptoCraft allowlists, routing, source modes, and removal of Crawl4AI behavior.
- Focused Smart Insights tests and the full Python suite must pass.
- Dependency installation is checked in a clean environment.
- Live smoke runs current and next CryptoCraft pages through the production parser; enabled-source publication is run only with the configured local database.
- BitInfoCharts is enabled only after a live production-parser success with non-empty address observations.
- Repository lint/build gates and a final scoped diff review run before merge and push.
