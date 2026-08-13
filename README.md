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

Schedule the shared wrapper instead of running a second worker service. The wrapper performs a
bounded retry/drain, verifies freshness/backlog/provider failures, and records scheduler outcomes.
Daily runs also synchronize corporate actions and publish adjusted datasets:

```text
Hourly at minute 10: powershell.exe -NoProfile -File scripts/run-market-ingestion.ps1 -Command hourly
Daily at 01:15 UTC:   powershell.exe -NoProfile -File scripts/run-market-ingestion.ps1 -Command daily
Manual run:            powershell.exe -NoProfile -File scripts/run-market-ingestion.ps1 -Command all -MaxRequestTotal 500
Start in:             <repository root>
```

Install the two Windows Task Scheduler jobs explicitly in the selected deployment environment:

```powershell
powershell.exe -NoProfile -File deploy\windows\install-quant-ingestion-tasks.ps1 -Install
```

The installer registers exactly one hourly and one daily task and ignores overlapping instances.

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

The UI currently preserves the original prototype screens while removing
Lovable, TanStack Start, Vite, Wrangler, and Cloudflare-specific runtime
dependencies. Local development seeds a real email/password Better Auth login
for `demo@radarasset.local` and a `demo-workspace` organization.
