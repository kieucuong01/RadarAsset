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

The default local database is:

```text
quant_insight_radar
```

If `psql` is not on PATH, create the database with pgAdmin or your PostgreSQL installer tools, then run the Prisma commands above.

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

Set `QUANT_WORKER_API_TOKEN` in `.env.local` to require the same token in the `x-worker-token` header. Leave it empty for local-only development.

## Notes

The UI currently preserves the original prototype screens while removing Lovable, TanStack Start, Vite, Wrangler, and Cloudflare-specific runtime dependencies. V1 is local-only and uses a seeded `demo@radarasset.local` user instead of real authentication.
