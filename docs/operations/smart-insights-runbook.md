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
- `FIRECRAWL_API_URL`: private Firecrawl endpoint; the self-hosted default is
  `http://127.0.0.1:3002`.
- `FIRECRAWL_API_KEY`: only when the selected Firecrawl deployment requires authentication.
- `FRED_API_KEY`: required before the FRED collector can pass live smoke.
- `OPENAI_API_KEY` and `SMART_INSIGHTS_AI_MODEL`: both are required to enable AI synthesis.
  With either missing, the briefing deliberately remains `quant_only`.

Firecrawl receives only source URLs registered in code. Scheduler and API inputs cannot provide an
arbitrary crawl URL. Keep Firecrawl and raw artifacts private; do not expose either endpoint to the
browser.

## Source activation gate

`quant-worker/smart_insights/sources.py` is the source of truth. A collector is production-enabled
only after its real parser passes a bounded live smoke in the deployment environment. A dry run
validates registration but does not prove that a provider is live.

Current verified and enabled sources:

| Source | Market | Frequency | Collection |
| --- | --- | --- | --- |
| `alternative-fng` | Crypto | Daily | API |
| `mempool-space` | Crypto/on-chain | Daily | API |
| `defillama-stablecoins` | Crypto/liquidity | Daily | API |
| `defillama-chains` | Crypto/on-chain | Daily | API |
| `deribit-public` | Crypto/derivatives | Daily | API |

Implemented but disabled pending a successful deployment-environment smoke:

| Source | Intended frequency | Current reason |
| --- | --- | --- |
| `farside-btc-etf`, `farside-eth-etf`, `farside-sol-etf` | Daily | Firecrawl unavailable during smoke |
| `bitinfocharts-top-addresses` | Daily | Firecrawl unavailable during smoke |
| `coinshares-weekly` | Weekly | Firecrawl unavailable during smoke |
| `cryptocraft` | Due-state calendar schedule | Firecrawl unavailable during smoke |
| `fred` | Daily | Requires deployment `FRED_API_KEY` and live smoke |
| `cftc-legacy`, `cftc-disaggregated` | Weekly | Provider/network smoke did not pass |
| `wgc-gold-etf`, `wgc-central-bank` | Source period | Firecrawl unavailable during smoke |
| `coinmetrics-community` | Daily | Community endpoint returned HTTP 403 |

Smoke a single registered source without writing observations:

```powershell
powershell.exe -NoProfile -File scripts/run-smart-insights.ps1 `
  -Schedule daily -Source farside-btc-etf -LiveSmoke
```

Use the source's configured schedule (`daily`, `weekly`, or `monthly`). CryptoCraft uses:

```powershell
powershell.exe -NoProfile -File scripts/run-smart-insights.ps1 `
  -Schedule calendar-current -Source cryptocraft -LiveSmoke
```

After a smoke succeeds, add only that source code to `ENABLED_SOURCE_CODES`, run tests, and deploy
the code change. To roll back a provider, remove its code from that set. Never delete historical
observations or immutable artifacts as part of source rollback.

## Scheduler matrix

The repository provides commands but does not create OS scheduled tasks.

| Job | Recommended trigger | Command |
| --- | --- | --- |
| Daily market collection and regime calculation | Daily after source-day close | `scripts/run-smart-insights.ps1 -Schedule daily` |
| Weekly flows and positioning | Weekly after provider publication | `scripts/run-smart-insights.ps1 -Schedule weekly` |
| WGC source-period data | Daily check; provider data is monthly/source-period | `scripts/run-smart-insights.ps1 -Schedule monthly` |
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

