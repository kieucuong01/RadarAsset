# Quant Worker

This worker is intentionally separate from the Next.js app. Keep expensive ingestion, factor calculations, optimization, and backtests here so the web server remains fast and cheap to scale.

## Local

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -r quant-worker\requirements.txt
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/quant_insight_radar?schema=public"
python quant-worker\worker.py
```

Environment:

- `DATABASE_URL` points at the same local PostgreSQL database used by Prisma.

The worker claims one queued row from `quant_runs`, calculates deterministic v1 metrics from
`market_bars`, and writes the result back to PostgreSQL.
