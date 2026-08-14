# Smart Insights Operations Runbook

Smart Insights is the data-first Personal Decision Cockpit. The Python AI Research Workbench
collects point-in-time evidence, calculates deterministic Crypto, Macro, and Gold regimes, ranks
signals against each member's interests and portfolio, and publishes an immutable daily briefing.
The web application only renders authenticated, tenant-scoped API results. It has no demo market
facts or silent sample-data fallback.

## Required configuration

Copy `.env.example` to `.env.local` and configure:

- `DATABASE_URL`: PostgreSQL used by Prisma and the Python worker.
- `SMART_INSIGHTS_TIMEZONE`: product day boundary, normally `Asia/Bangkok`.
- `SMART_INSIGHTS_ARTIFACT_ROOT`: private raw-response artifact directory.
- `SMART_INSIGHTS_HTTP_TIMEOUT_SECONDS`: bounded source request timeout.
- `FRED_API_KEY`: required before the FRED collector can pass live smoke.
- `OPENAI_API_KEY` and `SMART_INSIGHTS_AI_MODEL`: both are required to enable AI synthesis.
  With either missing, the briefing deliberately remains `quant_only`.

Scrapling, MarkItDown, Nodriver, and RapidOCR run in the main Python environment. They receive only source URLs
registered in code. Scheduler and API inputs cannot provide an arbitrary crawl URL. Raw HTML,
provider images, OCR tokens, and content-addressed artifacts remain private.

Install and verify the pinned browser runtime once per worker environment:

```powershell
.\.venv\Scripts\python.exe -m pip install -r quant-worker\requirements.txt
.\.venv\Scripts\rapidocr.exe check
```

CryptoCraft, Farside, and CoinShares use Scrapling's HTTP Fetcher with
Chrome impersonation and stealth headers, without proxies or a challenge solver. RapidOCR uses the
local ONNX Runtime CPU backend; its packaged models must pass `rapidocr check` before CoinShares is
eligible for live smoke.

BitInfoCharts also tries Scrapling first. Only an exact `HTTP_ERROR` with status 403 may start the
Nodriver fallback. The fallback launches one fresh Chrome profile in headful mode outside the visible
desktop, polls the page HTML for at most 45 seconds under a 60-second outer acquisition deadline, and never clicks
Turnstile/CAPTCHA, loads persistent cookies, or uses a proxy. Awaited socket/process cleanup is
independently bounded after cancellation. Headless Chrome did not pass the
2026-08-14 provider probe. Windows workers therefore require an interactive desktop session; a Linux
worker requires a separately qualified Xvfb setup before this source can be enabled there.

CoinGlass uses the same bounded Nodriver lifecycle directly because its public quantitative tables
render only after JavaScript. The client sets the browser timezone to UTC before navigation, uses a
fresh temporary profile for every page, accepts only the exact registered final URL, and stores no
cookies. BlockchainCenter and CBBI use Scrapling; CBBI may download only the exact public companion
asset `/cbbi/data/latest.json`, with strict JSON content type, UTF-8, and byte limits.

The provider splits ranks 1-19 and 20-100 across two HTML tables and abbreviates some visible address
text. The acquisition layer merges exactly ranks 1-100, reads each full address from its allow-listed
`/bitcoin/address/` link, converts only the normalized table with MarkItDown, and then delegates all
balance, label, entity-exclusion, and cohort decisions to the existing BitInfoCharts collector.

MarkItDown is MIT-licensed. Nodriver 0.50.1 is AGPL-3.0; non-commercial use does not waive the AGPL
obligations, so distribution or network deployment requires license review. MarkItDown's Magika
dependency requires `onnxruntime==1.20.1` on Windows; non-Windows workers retain the newer
`onnxruntime>=1.22,<2` range. Run both `pip check` and the RapidOCR verification after installation.

## Source activation gate

`quant-worker/smart_insights/sources.py` is the source of truth. A collector is production-enabled
only after its real parser passes a bounded live smoke in the deployment environment. A dry run
validates registration but does not prove that a provider is live.

Current verified and enabled sources:

| Source | Market | Frequency | Collection |
| --- | --- | --- | --- |
| `alternative-fng` | Crypto | Daily | API |
| `bitinfocharts-top-addresses` | Crypto/BTC large-address cohort | Daily | Scrapling with Nodriver 403 fallback and MarkItDown normalization |
| `coinmetrics-community` | Crypto/on-chain active addresses and MVRV | Daily | API |
| `mempool-space` | Crypto/on-chain | Daily | API |
| `defillama-stablecoins` | Crypto/liquidity | Daily | API |
| `defillama-chains` | Crypto/on-chain | Daily | API |
| `deribit-public` | Crypto/derivatives | Daily | API |
| `cryptocraft` | Macro/calendar | Due-state calendar schedule | Scrapling |
| `farside-btc-etf` | Crypto/Bitcoin ETF flows | Daily | Scrapling |
| `farside-eth-etf` | Crypto/Ethereum ETF flows | Daily | Scrapling |
| `farside-sol-etf` | Crypto/Solana ETF flows | Daily | Scrapling |

Implemented but disabled pending a successful deployment-environment smoke:

| Source | Intended frequency | Current reason |
| --- | --- | --- |
| `mempool-btc-large-addresses` | Daily | The initial 2026-08-14 smoke failed closed with `MISSING_WATCHLIST`. A validated BitInfoCharts cohort now exists, but this separate Mempool collector has not yet passed a new live smoke, PostgreSQL publication, and Data Health qualification |
| `coinshares-weekly` | Weekly | Live smoke on 2026-08-14 reached local OCR but failed closed: the asset footer period was unreadable and one numeric token scored 0.881 below the 0.90 threshold (`MISSING_PERIOD`/`OCR_LOW_CONFIDENCE`) |
| `fred` | Daily | Deployment `FRED_API_KEY` missing (`CONFIG_MISSING`) |
| `cftc-legacy`, `cftc-disaggregated` | Weekly | Provider returned `HTTP_ERROR` from the deployment network |
| `coinglass-margin-borrow` | Every four hours | Fixture parser and bounded renderer are implemented; pending independent live smoke and PostgreSQL publication |
| `coinglass-liquidation-maxpain` | Every four hours | Fixture parser and bounded renderer are implemented; pending independent live smoke and PostgreSQL publication |
| `blockchaincenter-altcoin-season` | Daily | Fixture parser is implemented; pending live SSR schema verification and PostgreSQL publication |
| `cbbi-public` | Daily | Public page/JSON parser is implemented; pending live schema verification and PostgreSQL publication |

WGC is retired from the active registry, scheduler, Data Health, and Gold score. Historical WGC
providers, runs, snapshots, observations, evidence, and derived snapshots remain in PostgreSQL for
audit and point-in-time replay; deployment must not delete them.

Smoke a single registered source without writing observations:

```powershell
powershell.exe -NoProfile -File scripts/run-smart-insights.ps1 `
  -Schedule daily -Source farside-btc-etf -LiveSmoke
```

Use the source's configured schedule (`daily` or `weekly`). CryptoCraft uses:

```powershell
powershell.exe -NoProfile -File scripts/run-smart-insights.ps1 `
  -Schedule calendar-current -Source cryptocraft -LiveSmoke
```

Smoke the four crawled Crypto Pulse sources independently:

```powershell
powershell.exe -NoProfile -File scripts/run-smart-insights.ps1 -Schedule four-hourly -Source coinglass-margin-borrow -LiveSmoke
powershell.exe -NoProfile -File scripts/run-smart-insights.ps1 -Schedule four-hourly -Source coinglass-liquidation-maxpain -LiveSmoke
powershell.exe -NoProfile -File scripts/run-smart-insights.ps1 -Schedule daily -Source blockchaincenter-altcoin-season -LiveSmoke
powershell.exe -NoProfile -File scripts/run-smart-insights.ps1 -Schedule daily -Source cbbi-public -LiveSmoke
```

These gates are independent. A success from one provider never enables another. CBBI historical
backfill is explicit and may run only with `--source cbbi-public --cbbi-backfill`; normal daily runs
publish at most the latest seven provider days.

After a smoke succeeds, add only that source code to `ENABLED_SOURCE_CODES`, run tests, and deploy
the code change. To roll back a provider, remove its code from that set. Never delete historical
observations or immutable artifacts as part of source rollback.

Activation evidence on 2026-08-14: migration status reported all 22 migrations applied; bounded
live smoke and PostgreSQL publication both succeeded for Farside BTC (169 observations), ETH
(143), and SOL (91), each effective 2026-08-12. CoinShares remains disabled.

BitInfoCharts activation evidence on 2026-08-14: migration status reported all 26 migrations
applied; the bounded production live smoke and PostgreSQL publication each produced 92
observations effective 2026-08-14. The validated cohort contained exactly ranks 1-100, with 16
reviewed exclusions and 84 accepted non-exchange addresses; the minimum accepted balance was
9,099 BTC and all accepted address observations shared one cohort version. The latest provider run
was `succeeded`, its raw snapshot was `validated`, and the authenticated Smart Insights Data Health
panel displayed `bitinfocharts-top-addresses` as `validated` and `FRESH`. The separate
`mempool-btc-large-addresses` source remains disabled until its own live and publication gates pass.

## Scheduler matrix

The repository provides commands but does not create OS scheduled tasks.

| Job | Recommended trigger | Command |
| --- | --- | --- |
| Daily market collection and regime calculation | Daily after source-day close | `scripts/run-smart-insights.ps1 -Schedule daily` |
| CoinGlass public pressure tables | Every four hours | `scripts/run-smart-insights.ps1 -Schedule four-hourly` |
| Weekly flows and positioning | Weekly after provider publication | `scripts/run-smart-insights.ps1 -Schedule weekly` |
| CryptoCraft current week | Every 15 minutes | `scripts/run-smart-insights.ps1 -Schedule calendar-current` |
| CryptoCraft next week | Every 12 hours | `scripts/run-smart-insights.ps1 -Schedule calendar-next` |
| CryptoCraft high-impact details | Every 15 minutes | `scripts/run-smart-insights.ps1 -Schedule calendar-event` |
| Daily member briefing | Daily after collectors | `scripts/run-smart-insights.ps1 -Schedule briefing -AllMemberships` |

The calendar worker persists due state: current-week data is fetched no more than every two hours,
next-week data every twelve hours, and high-impact detail pages every fifteen minutes from T-30 to
T+90. Extra triggers exit successfully as `not_due`.

Run one member or a specific product date:

```powershell
powershell.exe -NoProfile -File scripts/run-smart-insights.ps1 `
  -Schedule briefing -OrganizationId <organization-uuid> -UserId <user-uuid> `
  -LocalDate 2026-08-13 -Timezone Asia/Bangkok
```

Replay an immutable published briefing by ID:

```powershell
powershell.exe -NoProfile -File scripts/run-smart-insights.ps1 `
  -Schedule replay -BriefingId <briefing-uuid>
```

Replay reloads the stored revision and fingerprint; it does not fetch current provider data or
overwrite the original briefing.

## CoinShares OCR acceptance

The weekly CoinShares collector downloads only the allow-listed Storyblok tenant path discovered
from an allow-listed fund-flow article. It selects the `Ranked flows detail` asset table and the
`Flows by exchange country` region table. The report is rejected as a whole when either image is
missing, a required numeric/header token has confidence below 0.90, the unit is not explicit
`US$m`, a numeric cell needs character guessing, labels repeat, the table layout changes, or asset
and region weekly totals differ by more than USD 100,000. Stable public failure codes are
`MISSING_TABLE`, `OCR_LOW_CONFIDENCE`, `OCR_LAYOUT_DRIFT`, `INVALID_UNIT`, and
`RECONCILIATION_FAILED`. The last accepted weekly period remains unchanged after a rejected report.

## Quant and AI publication rules

- Crypto, Macro, and Gold scores are deterministic; AI output never enters score calculation.
- A regime is `active` only when fresh configured-weight coverage is at least 60%; otherwise it is
  explicitly `unavailable`.
- Evidence stores source, observed/effective time, unit, methodology, and raw observation identity.
- At most three primary signals and two risk signals are selected per daily briefing.
- OpenAI Responses synthesis uses a strict JSON schema and `store: false`.
- The grounding verifier rejects claims with unknown evidence, assets, numbers, confidence, or
  action language. Rejected or unavailable AI output falls back to `quant_only`; it never inserts
  plausible-looking prose.
- Output is research support only. The UI uses review/check language and does not issue buy, sell,
  allocation, leverage, or return-guarantee instructions.

## Operational checks

1. Apply Prisma migrations before enabling collection.
2. Run `-DryRun` to validate the registry and schedule selection.
3. Run a bounded `-LiveSmoke` per source from the deployment network.
4. Run collection and inspect the process exit code (`0` success/not-due, `1` provider failure,
   `2` invalid/no enabled selection).
5. Verify authenticated `GET /api/smart-insights/data-health` and the Cockpit freshness labels.
6. Investigate `stale`, `disabled`, `quarantined`, and `failed` sources independently. Do not
   substitute fixtures or promote a last-known value as current.
