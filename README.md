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

Live ingestion supports Binance BTC/USDT and Vnstock VCI FPT on `1h`/`1d`, plus MSN XAU/USD
daily candles through Vnstock. The free MSN commodity feed does not provide genuine hourly
candles, so XAU/USD `1h` reports `unsupported_timeframe` instead of resampling daily data.
Successful feeds publish immutable dataset versions; an upstream failure leaves the last
known-good version active and never substitutes a fixture. Quant Lab shows provider, coverage,
version, row count, and `LIVE DATA` / `STALE` / `UNAVAILABLE` / `FIXTURE` state from
`GET /api/market/data-health`.

Schedule the shared wrapper instead of running a second worker service:

```text
Hourly at minute 10: powershell.exe -NoProfile -File scripts/run-market-ingestion.ps1 -Command hourly
Daily at 01:15 UTC:   powershell.exe -NoProfile -File scripts/run-market-ingestion.ps1 -Command daily
Start in:             <repository root>
```

The repository documents scheduler commands but does not register operating-system tasks
automatically. Deployment must configure and observe its own cron/platform schedule.

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
