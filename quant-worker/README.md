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

The worker claims one queued `MA Crossover Backtest`, verifies immutable dataset checksums,
executes next-bar long-only fills with fees and adverse slippage, then commits real metrics and
checksummed equity, drawdown, trade, and manifest artifacts to PostgreSQL.

Publish six local research datasets (FPT, BTC/USDT, and XAU/USD in 1D and 1H):

```powershell
$env:PYTHONPATH=(Resolve-Path "quant-worker").Path
python quant-worker\bootstrap_research_datasets.py --mode fixture
```

`fixture` mode is deterministic and explicitly stored as `research_fixture`. To fetch free
research data through the configured Vnstock and Binance adapters, use `--mode live`. Both modes
are recorded as `research_only`; neither grants commercial redistribution rights.

## Investor Intelligence Imports

Use `research_import.py` to post normalized research JSON into the Next.js API:

```powershell
python quant-worker\research_import.py --symbol BTC
python quant-worker\research_import.py --payload .\local-research\BTC-last30days.json
```

The payload contract accepts `source`, `kind`, optional `symbol`, `insights`, `evidence`, `thesis`, `forecasts`, and `providerRuns`. It is designed for adapters around last30days, ai-berkshire, Kronos, and future market-data providers.
