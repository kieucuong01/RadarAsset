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

Scrapling and RapidOCR run in the main Python environment. Both receive only source URLs
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

## Source activation gate

`quant-worker/smart_insights/sources.py` is the source of truth. A collector is production-enabled
only after its real parser passes a bounded live smoke in the deployment environment. A dry run
validates registration but does not prove that a provider is live.

Current verified and enabled sources:

| Source | Market | Frequency | Collection |
| --- | --- | --- | --- |
| `alternative-fng` | Crypto | Daily | API |
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
| `bitinfocharts-top-addresses` | Daily | Live smoke on 2026-08-14 reached the provider but Cloudflare returned 403 (`HTTP_ERROR`); no observations were accepted |
| `mempool-btc-large-addresses` | Daily | Live smoke on 2026-08-14 failed closed with `MISSING_WATCHLIST` because no validated BitInfoCharts cohort exists yet; publication was not attempted |
| `coinshares-weekly` | Weekly | Live smoke on 2026-08-14 reached local OCR but failed closed: the asset footer period was unreadable and one numeric token scored 0.881 below the 0.90 threshold (`MISSING_PERIOD`/`OCR_LOW_CONFIDENCE`) |
| `fred` | Daily | Deployment `FRED_API_KEY` missing (`CONFIG_MISSING`) |
| `cftc-legacy`, `cftc-disaggregated` | Weekly | Provider returned `HTTP_ERROR` from the deployment network |

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

After a smoke succeeds, add only that source code to `ENABLED_SOURCE_CODES`, run tests, and deploy
the code change. To roll back a provider, remove its code from that set. Never delete historical
observations or immutable artifacts as part of source rollback.

Activation evidence on 2026-08-14: migration status reported all 22 migrations applied; bounded
live smoke and PostgreSQL publication both succeeded for Farside BTC (169 observations), ETH
(143), and SOL (91), each effective 2026-08-12. CoinShares remains disabled.

## Scheduler matrix

The repository provides commands but does not create OS scheduled tasks.

| Job | Recommended trigger | Command |
| --- | --- | --- |
| Daily market collection and regime calculation | Daily after source-day close | `scripts/run-smart-insights.ps1 -Schedule daily` |
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
