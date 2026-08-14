# BitInfoCharts Nodriver Fallback Design

## Goal

Recover the BTC large-address universe from BitInfoCharts when the existing bounded Scrapling HTTP request receives a Cloudflare 403, without changing the collectors that already pass live qualification.

Success means the fallback returns the real BitInfoCharts richest-address table, the existing parser accepts only valid rows at or above 1,000 BTC, and the source passes live smoke plus PostgreSQL publication before it is enabled.

## Scope

This change is limited to `bitinfocharts-top-addresses`.

- Scrapling remains the primary transport for all current Smart Insights sources.
- Scrapling remains the first attempt for BitInfoCharts.
- Nodriver is an optional browser fallback used only after an eligible Scrapling 403.
- MarkItDown converts one provider-shaped canonical HTML table to the existing Markdown contract.
- The existing BitInfoCharts parser, validation rules, immutable snapshot storage, and observation publication remain authoritative.
- The separate Mempool large-address collector remains disabled until it passes its own live, publication, and Data Health qualification using the validated BitInfoCharts watchlist.

The change does not add FlareSolverr, proxy rotation, CAPTCHA-solving services, persistent browser cookies, or a second BitInfoCharts parser.

## Architecture

### Browser transport

Add a `NodriverBitInfoChartsFetcher` with one responsibility: return a bounded HTML response for the allow-listed BitInfoCharts URL.

The fetcher:

- launches the locally installed Chrome or Chromium through Nodriver;
- uses a fresh temporary profile per run;
- runs at most one browser and one page concurrently;
- runs headful outside the visible desktop because the live headless probe remained on the challenge page;
- polls fresh `page.get_content()` output instead of retaining a stale CDP selector node;
- has a 60-second outer acquisition deadline covering browser startup, navigation, table discovery, and the normal cleanup path; forced socket/process cleanup is independently bounded and may finish after cancellation;
- verifies the final URL remains allow-listed;
- rejects empty HTML, challenge-only HTML, and pages without the expected table structure;
- closes the browser process, drains it, and removes its generated temporary profile in all outcomes;
- does not save or reuse cookies.

The fetcher does not click a Turnstile or CAPTCHA. A page requiring human verification fails closed.

### Fallback coordinator

Extend the BitInfoCharts collection path with a small coordinator:

1. Call the current Scrapling transport.
2. If it succeeds, return its snapshot and do not start Chrome.
3. If it fails with `HTTP_ERROR` caused by status 403, call the Nodriver fetcher once.
4. Propagate every other Scrapling error without starting Chrome.
5. Convert browser timeout, challenge, missing-table, redirect, and launch failures into explicit source error codes.
6. Merge the provider's rank 1-19 and rank 20-100 tables, replacing abbreviated display addresses with the full allow-listed address-link path.
7. Convert only that canonical table through MarkItDown and send the Markdown through the existing `BitInfoChartsCollector` parser and validation path.

The coordinator must preserve the source URL, observed time, parser version, and transport metadata in the raw snapshot. Metadata identifies whether `scrapling` or `nodriver` produced the accepted HTML.

## Failure model

The fallback is bounded and fail-closed.

| Condition | Result |
| --- | --- |
| Scrapling succeeds | Publish through the existing path; Nodriver is not started |
| Scrapling 403 and Nodriver finds the table | Parse and validate through the existing collector |
| Scrapling non-403 failure | Preserve the original error; Nodriver is not started |
| Chrome/Nodriver cannot launch | `BROWSER_LAUNCH_FAILED` |
| Deadline expires | `TIMEOUT` |
| Turnstile/CAPTCHA or challenge-only page remains | `CHALLENGE_REQUIRED` |
| Final URL leaves the allow-list | `REDIRECT_REJECTED` |
| Expected table is absent | `MISSING_TABLE` |
| Parser or quality validation fails | Existing parser/validation error; no observations published |

No failed browser response becomes an accepted raw observation.

## Source activation

`bitinfocharts-top-addresses` was required to remain absent from `ENABLED_SOURCE_CODES` until all of the following passed in the deployment environment:

1. A bounded live smoke returns accepted real rows.
2. Every accepted row has a valid BTC address and balance at or above 1,000 BTC.
3. The cohort version is deterministic for the accepted membership.
4. PostgreSQL publication succeeds and Data Health reports the run.
5. The full Python and web regression suites pass.

All five gates passed on 2026-08-14: live smoke and PostgreSQL publication each produced 92 observations, and authenticated Data Health reported `validated` and `FRESH`. The source is therefore enabled. This is the current activation state, not a pending condition.

Only after BitInfoCharts is enabled and has published a validated watchlist may `mempool-btc-large-addresses` run its own live and publication qualification. It is not enabled automatically by this change.

## Testing

Unit tests cover:

- no browser launch after Scrapling success;
- fallback occurs only for an HTTP 403;
- non-403 errors are preserved;
- successful browser HTML is parsed by the existing parser;
- challenge, timeout, missing-table, redirect, and launch failures fail closed;
- browser cleanup occurs on success and failure;
- the enabled registry state is asserted after the completed live qualification.

The live probe ran before activation and retrieved and validated the real table within the bounded acquisition window. A future requalification failure must fail closed and must not be replaced by sample data.

## Operational and licensing constraints

Nodriver is licensed under AGPL-3.0 and MarkItDown is MIT-licensed. Non-commercial use does not remove Nodriver's license obligations. The dependencies and their use must remain visible in deployment documentation, and distribution or network deployment must be reviewed for AGPL compliance.

Chrome execution increases memory and startup cost, so the fallback is single-flight, BitInfoCharts-only, and limited to the scheduled daily collection path. It is never used in a web request handler. The verified Windows path requires an interactive desktop session. Headless mode failed the live probe; Linux/Xvfb remains unqualified.
