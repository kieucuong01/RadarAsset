# Quant Worker

This worker is intentionally separate from the Next.js app. Keep expensive ingestion, factor calculations, optimization, backtests, and research imports here so the web server remains fast and cheap to scale.

## Local

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -r quant-worker\requirements.txt
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/quant_insight_radar?schema=public"
python quant-worker\worker.py
```

Environment:

- `DATABASE_URL` points at the same local PostgreSQL database used by Prisma.
- `QUANT_WORKER_API_TOKEN` protects research import endpoints when set.

The worker claims one queued row from `quant_runs`, calculates deterministic v1 metrics from
`market_bars`, and writes the result back to PostgreSQL.

## Investor Intelligence Imports

Use `research_import.py` to post normalized research JSON into the Next.js API:

```powershell
python quant-worker\research_import.py --symbol BTC
python quant-worker\research_import.py --payload .\local-research\BTC-last30days.json
```

The payload contract accepts `source`, `kind`, optional `symbol`, `insights`, `evidence`, `thesis`, `forecasts`, and `providerRuns`. It is designed for adapters around last30days, ai-berkshire, Kronos, and future market-data providers.
