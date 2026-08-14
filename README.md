# Quant Insight Radar

Financial dashboard foundation built on Next.js, local PostgreSQL, Prisma, shadcn/ui, Recharts/ECharts, and a separate Python quant worker.

## Stack

- Next.js App Router with React and TypeScript
- Tailwind CSS and shadcn/ui components
- Recharts for the existing portfolio and quant charts, with ECharts available for heavier financial visuals
- Local PostgreSQL with Prisma migrations and seed data
- Python worker for quant runs and investor-intelligence imports

## Local Setup

```powershell
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Copy `.env.example` to `.env.local` and update `DATABASE_URL` if your local PostgreSQL user, password, port, or database name differs.

The web development server uses the stable address `http://localhost:3100`:

```powershell
npm run dev
```

Portfolio optimization, Factor Lab and QuantStats use the private Python quant engine. On Windows,
create the project environment once and start the engine on port `8100`:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r quant-worker\requirements.txt
.\.venv\Scripts\python.exe -m uvicorn service:app --app-dir quant-worker --host 127.0.0.1 --port 8100
```

Generate a local Better Auth secret with at least 32 random characters and set
`BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, and a local-only
`DEV_DEMO_PASSWORD` before migrating or seeding. The demo password must be at
least 12 characters and must never be reused outside local development.
Set `DEV_SEED_DATABASE` to the exact local database name as an additional
fail-closed guard. The seed refuses remote hosts and never resets other
organizations or users.

The default local database is:

```text
quant_insight_radar
```

If `psql` is not on PATH, create the database with pgAdmin or your PostgreSQL installer tools, then run the Prisma commands above.

For tenant-isolation integration tests, both database URLs must use a local
PostgreSQL host. Set `TEST_DATABASE_URL` to the `DATABASE_URL` database name plus
the exact `_test` suffix, then run `npm run test:integration`.
The wrapper migrates only that test database and keeps `DATABASE_URL` as a
different development-database safety marker.

## Market Data Ingestion

Apply migrations, then verify the free providers without writing data:

```powershell
npm run db:migrate
npm run market:ingest -- all --dry-run --env-file .env.local
```

Live ingestion supports the selected Binance USDT spot universe
(`BTC`, `ETH`, `XRP`, `SOL`, `BNB`, `ADA`, `LINK`, `LTC`, `AVAX`, `TRX`, `ZEC`, `XMR`, `XLM`),
Vnstock-listed HOSE equities discovered from the current provider catalog, and Dukascopy
XAU/USD candles. HOSE daily backfills target ten years; crypto and XAU request the longest
approved free-provider history the adapter can fetch. XAU/USD uses genuine daily and hourly
bid candles instead of resampling daily data.
Successful feeds publish immutable dataset versions; an upstream failure leaves the last
known-good version active and never substitutes a fixture. Quant Lab shows provider, coverage,
version, row count, and `LIVE DATA` / `STALE` / `UNAVAILABLE` / `FIXTURE` state from
`GET /api/market/data-health`.

Before a broad live load, synchronize the provider catalog and queue supported instruments:

```powershell
$env:PYTHONPATH=(Resolve-Path "quant-worker").Path
python quant-worker\sync_provider_instruments.py --queue-ingestion all
python quant-worker\process_ingestion_requests.py --limit 20 --env-file .env.local
```

For a controlled backlog drain after adding a large universe, keep batch size small and cap the
total work:

```powershell
python quant-worker\process_ingestion_requests.py --limit 20 --drain --max-total 500 --env-file .env.local

# Requeue a bounded failed batch after provider connectivity recovers
python quant-worker\process_ingestion_requests.py --retry-failed --retry-limit 500 --limit 20 --drain --max-total 500 --env-file .env.local
```

Schedule the shared wrapper while keeping the ingestion worker running continuously. Scheduled
runs synchronize the catalog, enqueue due requests, and record scheduler outcomes without waiting
for the full universe. Daily runs also synchronize corporate actions and publish adjusted
datasets. Use `-DrainRequests` only for a bounded manual recovery:

```text
Hourly at minute 10: powershell.exe -NoProfile -File scripts/run-market-ingestion.ps1 -Command hourly
Daily at 01:15 UTC:   powershell.exe -NoProfile -File scripts/run-market-ingestion.ps1 -Command daily
Manual bounded drain:  powershell.exe -NoProfile -File scripts/run-market-ingestion.ps1 -Command all -DrainRequests -MaxRequestTotal 500
Start in:             <repository root>
```

Install the two Windows Task Scheduler jobs explicitly in the selected deployment environment:

```powershell
powershell.exe -NoProfile -File deploy\windows\install-quant-ingestion-tasks.ps1 -Install
powershell.exe -NoProfile -File deploy\windows\install-quant-ingestion-tasks.ps1 -Verify
```

The installer registers exactly one hourly and one daily task, ignores overlapping instances, and
restarts failed tasks up to three times. `-Verify` is read-only. Quant Lab reports missing/stale
datasets, missing bars, backlog age, grouped provider failures, and the latest scheduler terminal
result. `readyForBacktest` is intentionally strict: missing/stale datasets, an over-age backlog,
or no scheduler success within 25 hours keeps readiness degraded. Recent provider failures remain
visible even when previously published data is still fresh.

Vietnam total-return datasets remain inactive when corporate-action coverage does not contain the
raw dataset range, a price-affecting action is unverified, or quality checks fail. Raw versions stay
immutable; the publisher reports `coverage`, `unverified`, and `quality` block counts.

Strategy Lab stores DCA and price-threshold rules in the active tenant workspace with immutable
versions. Re-saving an unchanged rule reuses its latest version; a changed rule creates the next
patch version. The first authenticated load imports executable rules from the legacy browser store
and removes that store only after all imports succeed. Catalog presets continue directly to
Backtest, while fundamental rules remain unavailable until point-in-time financial data exists.

## Smart Insights Collection

Smart Insights is implemented as a data-first Personal Decision Cockpit for Crypto, Macro, and
Gold, backed by a Python AI Research Workbench. It publishes tenant-scoped daily briefings,
deterministic regimes, point-in-time metrics, a CryptoCraft calendar contract, evidence details,
preferences, and source-health APIs. The UI does not fall back to hard-coded market facts.

See the [Smart Insights operations runbook](docs/operations/smart-insights-runbook.md) for source
activation status, Crawl4AI/Scrapling/RapidOCR setup, scheduler commands, AI fallback rules,
replay, and rollback.

Smart Insights stores normalized quantitative observations and private, content-addressed raw
artifacts. Crawl4AI runs CryptoCraft in an ephemeral headless Chromium context; Scrapling fetches
Farside and CoinShares over bounded HTTP; RapidOCR reads only allow-listed CoinShares report
images with the ONNX Runtime CPU backend. The worker sends only code-owned allow-listed URLs and
never accepts a URL from an API request or scheduler argument.

Verify a registered source without fetching or writing data:

```powershell
powershell.exe -NoProfile -File scripts/run-smart-insights.ps1 -Schedule daily -DryRun
```

Run a bounded production-parser smoke with no database or artifact writes:

```powershell
powershell.exe -NoProfile -File scripts/run-smart-insights.ps1 -Schedule daily `
  -Source alternative-fng -LiveSmoke
```

Run enabled daily collectors after applying the Smart Insights migration:

```powershell
powershell.exe -NoProfile -File scripts/run-smart-insights.ps1 -Schedule daily
```

The code-owned enabled set currently contains Alternative.me, Coin Metrics Community active
addresses and MVRV, mempool.space, DefiLlama stablecoin history, DefiLlama chain TVL, Deribit public
data, the CryptoCraft economic calendar, and daily Farside BTC/ETH/SOL ETF flows; each passed its
own bounded live smoke. Browser sources
that are blocked or no longer expose a machine-readable quantitative table remain disabled.

Install and verify the pinned local browser crawler before running browser-backed sources:

```powershell
.\.venv\Scripts\python.exe -m pip install -r quant-worker\requirements.txt
.\.venv\Scripts\python.exe -m venv .scrapling-venv
.\.scrapling-venv\Scripts\python.exe -m pip install -r quant-worker\requirements-scrapling.txt
New-Item -ItemType Directory -Force .local-data\crawl4ai | Out-Null
$env:CRAWL4_AI_BASE_DIRECTORY=(Resolve-Path ".local-data\crawl4ai").Path
.\.venv\Scripts\crawl4ai-setup.exe
.\.venv\Scripts\crawl4ai-doctor.exe
.\.venv\Scripts\rapidocr.exe check
```

Scrapling is isolated because its required `lxml` major version conflicts with Crawl4AI 0.8.9.
The main worker exchanges bounded JSON/base64 messages with that local runner; it does not invoke
a shell or accept arbitrary URLs.

This product includes software developed by
[UncleCode as part of the Crawl4AI project](https://github.com/unclecode/crawl4ai).
It also includes [Scrapling](https://github.com/D4Vinci/Scrapling) under BSD-3-Clause and
[RapidOCR](https://github.com/RapidAI/RapidOCR) under Apache-2.0.

The Crypto Regime Score is deterministic and point-in-time. Its six groups are momentum 20%, flow
25%, liquidity 15%, on-chain 20%, derivatives 10%, and sentiment 10%. A score is persisted as
`active` only when fresh configured-weight coverage reaches 60%; otherwise it is explicitly
`unavailable`. Source observations, active immutable price datasets, methodology version, and
input IDs are retained for replay. LLM output never enters the score.

The repository only documents scheduler commands and does not register a Windows scheduled task
automatically. Source health is available to authenticated research viewers at
`GET /api/smart-insights/data-health`; raw bodies, artifact paths, and provider diagnostics are not
returned.

For CryptoCraft, invoke the current-calendar boundary every 15 minutes:

```powershell
powershell.exe -NoProfile -File scripts/run-smart-insights.ps1 -Schedule calendar-current
```

The worker persists due state in provider-run metadata rather than process memory. It refreshes the
current week no more often than every two hours, the next week every twelve hours, and high-impact
event detail pages every fifteen minutes from T-30 through T+90. An early invocation exits
successfully as `not_due`. Calendar timestamps use the explicit CryptoCraft timezone and are stored
in UTC; all-day and tentative rows retain their source date without a fabricated instant.

Macro observations use an allow-listed set of 15 FRED series and the official CFTC Legacy Futures
Only contracts for BTC, USD Index, E-mini S&P 500, and Nasdaq-100 Mini. Set `FRED_API_KEY` before its
live smoke. CFTC queries are bounded to 5,000 rows, select only code-owned fields, and require
`FutOnly`; combined futures/options rows fail validation instead of being double-counted. FRED,
CFTC and FRED remain disabled until each production parser passes from the deployment environment;
CryptoCraft is enabled.

The deterministic `macro-risk-asset-regime-v1` score weights liquidity 30%, rates/real yields 25%,
USD pressure 20%, growth/inflation surprise 15%, and positioning 10%. It requires 60% fresh-weight
coverage. `Event Risk` is published separately as the maximum upcoming event severity over 24-hour,
3-day, and 7-day windows, so it never changes the directional regime score.

## Investor Intelligence

The local v1 backend stores research in PostgreSQL:

- `research_runs`: each last30days, ai-berkshire, Kronos, or provider-health refresh
- `evidence_items`: source snippets and engagement metadata
- `investment_theses`: investor-ready stance, conviction, bull case, bear case, and action items
- `forecast_points`: model forecasts by horizon

Useful local endpoints:

```text
GET  /api/assets/BTC/intelligence
GET  /api/research/runs
POST /api/research/runs/import
```

For automation imports, run Next locally and post normalized JSON:

```powershell
python quant-worker\research_import.py --symbol BTC
```

Set `QUANT_WORKER_API_TOKEN` in `.env.local` and send the same value in the
`x-worker-token` header. Worker imports fail closed when the server token is
missing. `QUANT_WORKER_ORGANIZATION_SLUG` selects the service workspace on the
server; clients cannot choose it.

## Notes

Authenticated Quant browser QA and the 20/50-run PostgreSQL capacity gate use only the isolated
local `_test` database. See `docs/verification/2026-08-14-quant-p0-4-e2e-capacity.md`; passing test
fixtures does not certify provider-backed market data.

The UI currently preserves the original prototype screens while removing
Lovable, TanStack Start, Vite, Wrangler, and Cloudflare-specific runtime
dependencies. Local development seeds a real email/password Better Auth login
for `demo@radarasset.local` and a `demo-workspace` organization.
