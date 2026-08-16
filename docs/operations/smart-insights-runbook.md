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
- `SMART_INSIGHTS_ARTIFACT_BACKEND`: `filesystem` locally and `s3` in production.
- `SMART_INSIGHTS_ARTIFACT_ROOT`: private raw-response directory used by the filesystem backend.
- `SMART_INSIGHTS_ARTIFACT_SPOOL_ROOT`: bounded local spool retained when S3 upload cannot be
  verified.
- `DATAVEST_S3_ENDPOINT_URL`, `DATAVEST_S3_BUCKET`, `DATAVEST_S3_ACCESS_KEY_ID`, and
  `DATAVEST_S3_SECRET_ACCESS_KEY`: server-only private S3 configuration. Production uses bucket
  `datavest`; never copy values into Git, Markdown, browser code, or workflow logs.
- `SMART_INSIGHTS_HTTP_TIMEOUT_SECONDS`: bounded source request timeout.
- `FRED_API_KEY`: optional. When absent, the collector uses the official bounded
  `fredgraph.csv` endpoint and keeps the same validated metric contract.
- `DEEPSEEK_API_KEY`: enables grounded AI explanations. With it missing, publication deliberately
  remains `quant_only`.
- `DEEPSEEK_BASE_URL`: defaults to `https://api.deepseek.com`.
- `DEEPSEEK_MODEL`: defaults to `deepseek-v4-flash` and can be changed to another qualified
  DeepSeek Chat Completions model.
- `DEEPSEEK_TIMEOUT_SECONDS`: bounded model request timeout; defaults to 30 seconds.

Scrapling, MarkItDown, Nodriver, and RapidOCR run in the main Python environment. They receive only source URLs
registered in code. Scheduler and API inputs cannot provide an arbitrary crawl URL. Raw HTML,
provider images, OCR tokens, and content-addressed artifacts remain private.

The S3 backend uses deterministic `s3://datavest/smart-insights/raw/<source>/<yyyy>/<mm>/<sha256>.json.gz`
locators and single-request `PutObject`. It supplies no public ACL. An upload is accepted only after
remote length and checksum metadata match; otherwise the compressed spool file remains local and
the collector fails explicitly. Reads require the configured bucket/prefix and validate both gzip
and the uncompressed SHA-256. S3 outage or integrity failure never falls back to invented evidence.

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

| Source                            | Market                                    | Frequency                   | Collection                                                        |
| --------------------------------- | ----------------------------------------- | --------------------------- | ----------------------------------------------------------------- |
| `alternative-fng`                 | Crypto                                    | Daily                       | API                                                               |
| `bitinfocharts-top-addresses`     | Crypto/BTC large-address cohort           | Daily                       | Scrapling with Nodriver 403 fallback and MarkItDown normalization |
| `coinmetrics-community`           | Crypto/on-chain active addresses and MVRV | Daily                       | API                                                               |
| `mempool-space`                   | Crypto/on-chain                           | Daily                       | API                                                               |
| `defillama-stablecoins`           | Crypto/liquidity                          | Daily                       | API                                                               |
| `defillama-chains`                | Crypto/on-chain                           | Daily                       | API                                                               |
| `deribit-public`                  | Crypto/derivatives                        | Daily                       | API                                                               |
| `cryptocraft`                     | Macro/calendar                            | Due-state calendar schedule | Scrapling                                                         |
| `blockchaincenter-altcoin-season` | Crypto/altcoin market rotation            | Daily                       | Scrapling                                                         |
| `farside-btc-etf`                 | Crypto/Bitcoin ETF flows                  | Daily                       | Scrapling                                                         |
| `farside-eth-etf`                 | Crypto/Ethereum ETF flows                 | Daily                       | Scrapling                                                         |
| `farside-sol-etf`                 | Crypto/Solana ETF flows                   | Daily                       | Scrapling                                                         |
| `coinshares-weekly`               | Crypto/digital-asset fund flows           | Weekly                      | Scrapling plus local RapidOCR                                     |
| `fred`                            | Macro/rates, liquidity and USD            | Daily                       | Official API or keyless official CSV                              |
| `cftc-disaggregated`              | Gold/managed-money positioning            | Weekly                      | Official API with official yearly-archive fallback                |
| `coinglass-margin-borrow`         | Crypto/derivatives pressure               | Every four hours            | Bounded Nodriver rendering                                        |
| `coinglass-liquidation-maxpain`   | Crypto/options and liquidation pressure   | Every four hours            | Bounded Nodriver rendering                                        |
| `cbbi-public`                     | Crypto/cycle composite                    | Daily                       | Scrapling/public JSON                                             |

Implemented but disabled pending a successful deployment-environment smoke:

| Source                        | Intended frequency | Current reason                                                                                                                                                                                                                                   |
| ----------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mempool-btc-large-addresses` | Daily              | The initial 2026-08-14 smoke failed closed with `MISSING_WATCHLIST`. A validated BitInfoCharts cohort now exists, but this separate Mempool collector has not yet passed a new live smoke, PostgreSQL publication, and Data Health qualification |
| `cftc-legacy`                 | Weekly             | The four financial-futures positioning markets have not passed an independent deployment-network smoke; Macro therefore stays unavailable when its other groups cover less than 60%                                                              |

The 2026-08-15 bounded production-parser smoke fetched 3 BlockchainCenter observations and
195/165/105 Farside BTC/ETH/SOL observations. Live smoke is write-free; enabled scheduled
collection remains responsible for PostgreSQL publication and Data Health freshness.

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

Activation evidence on 2026-08-14 for the crawled Crypto Pulse sources: PostgreSQL reported all 26
migrations applied. Independent bounded live smokes succeeded for CoinGlass Margin Borrow (60
observations, latest effective 2026-08-14 16:00 UTC), CoinGlass Liquidation Max Pain (21
observations across BTC/ETH/SOL), BlockchainCenter Altcoin Season (three horizon observations), and
CBBI (60 observations, latest provider day 2026-08-13). Production publication then succeeded for
all four sources. Direct database read-back showed the latest provider run as `succeeded`, each raw
snapshot as `validated`, and observation counts of 60, 21, 3, and 60 respectively. The web read
model returned `system` for both CoinGlass sections and both cycle sections, including 20 hourly
margin points, BTC/ETH/SOL max-pain rows, Altcoin Season 61/43/37, CBBI Confidence 31.34, and all nine
CBBI components. The worktree web listener returned HTTP 200 on port 3117; authenticated visual QA
remained unavailable because the local env had no configured demo login password, so this evidence
does not claim an authenticated browser pass.

Activation refresh on 2026-08-16: keyless FRED live smoke and publication each fetched 1,984
validated observations from the official CSV endpoint. The production database then contained 249
10-year real-yield points and 245 broad-USD-index points. CFTC Disaggregated first attempted its
official reporting API, then used the bounded official 2026 yearly ZIP archive after the API denied
the deployment network; live smoke and publication each fetched 160 Gold observations. The resulting
managed-money net/open-interest series contained 32 weekly points. The derived XAU regime published
`active` with all four groups present, coverage 1.0000, and data confidence 98.72. The archive parser
accepts one root-level text member, caps compressed and decompressed bytes, validates the 191-column
official header, filters the allow-listed Gold contract, and falls back to the current official CSV
only when the archive request itself fails.

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

The repository includes an explicit Windows Scheduled Task installer at
`deploy/windows/install-quant-ingestion-tasks.ps1`. Installation remains a deployment action;
the web application never creates or changes OS tasks.

For the daily asset-opinion path, use the composed fail-closed runner. Its shared
daily scope is the curated decision universe plus assets currently present in a
user's holdings or watchlist. It queues only `1d` datasets, then runs corporate-action
and adjusted-data publication, enabled Smart Insights daily collectors and derived
pipelines, and every member briefing. It does not pre-ingest the full discovered HOSE
catalog. Historical `1h` versions remain immutable but are not queued and do not gate
daily readiness:

```powershell
powershell.exe -NoProfile -File scripts/refresh-asset-opinions.ps1
```

The Windows task installer uses this runner for the daily task. The four-hourly task
collects existing derivatives pressure metrics only; it does not ingest intraday price bars.
After a manual or scheduled daily run, the runner executes
`quant-worker/verify_daily_pipeline.py`. The verifier succeeds only when the current
Bangkok day has a successful daily market scheduler run and a published briefing for
every organization membership. Its bounded JSON output uses stable failure codes
`DAILY_MARKET_RUN_MISSING`, `DAILY_MARKET_RUN_FAILED`, and
`DAILY_BRIEFING_INCOMPLETE`.

Before publishing the new daily briefing, the same runner executes
`quant-worker/evaluate_asset_opinions.py`. It evaluates only directional, active
`asset_opinion` snapshots with tenant attribution. Entry is the next closed daily
session; immutable outcomes are recorded at 1, 5, and 20 sessions. VN assets prefer
eligible total-return prices and fall back to raw daily prices; crypto uses BTC,
Vietnam equities use VNINDEX, and gold uses XAU as benchmarks. Neutral,
insufficient, and not-yet-mature opinions are never assigned synthetic returns.

Install the tasks from an elevated PowerShell session, then verify their executable,
action path, state, and last result:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  deploy/windows/install-quant-ingestion-tasks.ps1 -Install
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  deploy/windows/install-quant-ingestion-tasks.ps1 -Verify
```

| Job                                            | Recommended trigger               | Command                                                             |
| ---------------------------------------------- | --------------------------------- | ------------------------------------------------------------------- |
| Daily market collection and regime calculation | Daily after source-day close      | `scripts/run-smart-insights.ps1 -Schedule daily`                    |
| CoinGlass public pressure tables               | Every four hours                  | `scripts/run-smart-insights.ps1 -Schedule four-hourly`              |
| Weekly flows and positioning                   | Weekly after provider publication | `scripts/run-smart-insights.ps1 -Schedule weekly`                   |
| CryptoCraft current week                       | Every 15 minutes                  | `scripts/run-smart-insights.ps1 -Schedule calendar-current`         |
| CryptoCraft next week                          | Every 12 hours                    | `scripts/run-smart-insights.ps1 -Schedule calendar-next`            |
| CryptoCraft high-impact details                | Every 15 minutes                  | `scripts/run-smart-insights.ps1 -Schedule calendar-event`           |
| Daily member briefing                          | Daily after collectors            | `scripts/run-smart-insights.ps1 -Schedule briefing -AllMemberships` |

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
- DeepSeek Chat Completions synthesis requests JSON Output, locally validates the closed schema,
  and persists only content that passes the grounding verifier.
- The grounding verifier rejects claims with unknown evidence, assets, numbers, confidence, or
  action language. Rejected or unavailable AI output falls back to `quant_only`; it never inserts
  plausible-looking prose.
- Output is research support only. The UI uses review/check language and does not issue buy, sell,
  allocation, leverage, or return-guarantee instructions.

## Operational checks

1. Apply Prisma migrations before enabling collection.
2. Keep `python quant-worker/process_smart_insight_refreshes.py --watch --poll-seconds 5` running;
   `npm run dev` starts it automatically for local development.
3. Run `-DryRun` to validate the registry and schedule selection.
4. Run a bounded `-LiveSmoke` per source from the deployment network.
5. Run collection and inspect the process exit code (`0` success/not-due, `1` provider failure,
   `2` invalid/no enabled selection).
6. Verify authenticated `GET /api/smart-insights/data-health` and the Cockpit freshness labels.
7. Investigate `stale`, `disabled`, `quarantined`, and `failed` sources independently. Do not
   substitute fixtures or promote a last-known value as current.
