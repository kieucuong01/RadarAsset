# Quant Worker

This worker is intentionally separate from the Next.js app. Keep expensive ingestion, factor calculations, optimization, backtests, and research imports here so the web server remains fast and cheap to scale.

## Local

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -r quant-worker\requirements.txt
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/quant_insight_radar?schema=public"
python quant-worker\worker.py
```

From the repository root, `npm run dev` starts Next.js on port `3100` and the continuously polling
Quant worker together. Set `PYTHON_EXECUTABLE` when the project virtual environment is outside the
current worktree. Use `npm run dev:web` only when intentionally debugging the web process without
executing queued backtests.

The worker polls continuously by default. For a scheduler, smoke test, or one-off queue drain, run:

```powershell
python quant-worker\worker.py --once
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

`fixture` mode is deterministic and explicitly stored as `research_fixture`. Fixtures are for
local bootstrap/tests only. Scheduled live ingestion never falls back to these generated rows.

## Scheduled Market Data Ingestion

The live ingestion CLIs publish immutable, research-only datasets independently for every feed:

- Binance public Spot klines: `BTCUSDT`, `ETHUSDT`, `XRPUSDT`, `SOLUSDT`, `BNBUSDT`,
  `ADAUSDT`, `LINKUSDT`, `LTCUSDT`, `AVAXUSDT`, `TRXUSDT`, `ZECUSDT`, `XMRUSDT`, and
  `XLMUSDT` when the pair is currently trading.
- Vnstock VCI: current HOSE equities discovered from the provider listing catalog.
- Dukascopy public datafeed: `XAUUSD` daily bid candles.

Run a provider-only smoke without database writes:

```powershell
python quant-worker\ingest_market_data.py all --dry-run --env-file .env.local
```

Publish all daily feeds or one allow-listed daily feed:

```powershell
python quant-worker\ingest_market_data.py all --env-file .env.local
python quant-worker\ingest_market_data.py daily --env-file .env.local
python quant-worker\ingest_market_data.py all --asset BTC --timeframe 1d --env-file .env.local
```

For the broad universe, sync provider instruments and queue idempotent ingestion requests:

```powershell
python quant-worker\sync_provider_instruments.py --queue-ingestion all
python quant-worker\process_ingestion_requests.py --limit 20 --env-file .env.local
```

To drain a large queued universe without running forever, use a bounded total:

```powershell
python quant-worker\process_ingestion_requests.py --limit 20 --drain --max-total 500 --env-file .env.local

# Requeue a bounded failed batch after provider connectivity recovers
python quant-worker\process_ingestion_requests.py --retry-failed --retry-limit 500 --limit 20 --drain --max-total 500 --env-file .env.local
```

Initial backfills target ten years for HOSE, the longest configured free-provider crypto history
from `2017-01-01`, and XAU daily requests from the provider's `1999-06-03` boundary.
Incremental runs merge only a recent overlap.

Exit code `0` means every selected feed succeeded, was unchanged, or was already locked. Exit `2`
means a partial provider failure/unavailable capability; successful feeds are still committed.
Exit `1` means invalid configuration or a fatal database/bootstrap failure. Errors are sanitized;
provider response bodies and environment values are never logged.

Use `scripts\run-market-ingestion.ps1` as the scheduler boundary and keep
`process_ingestion_requests.py --watch` running as the data worker. The wrapper resolves the
repository root, enqueues due requests, records scheduler outcomes, and does not wait for the full
universe or print `.env.local`. Daily/all runs additionally refresh corporate actions and publish
adjusted datasets:

```powershell
powershell.exe -NoProfile -File scripts\run-market-ingestion.ps1 -Command daily
powershell.exe -NoProfile -File scripts\run-market-ingestion.ps1 -Command all -DrainRequests -MaxRequestTotal 500
```

For Windows Task Scheduler, trigger `daily` at `01:15 UTC`. Set **Start in** to the repository root. If `python` is not on the task account's PATH, add
`-PythonExecutable C:\path\to\python.exe`. Do not register duplicate tasks for the same environment;
PostgreSQL advisory locks are a final overlap guard, not a substitute for clean scheduling.
On a Windows deployment host, register the versioned tasks explicitly:

```powershell
powershell.exe -NoProfile -File deploy\windows\install-quant-ingestion-tasks.ps1 -Install
powershell.exe -NoProfile -File deploy\windows\install-quant-ingestion-tasks.ps1 -Verify
```

The wrapper records one terminal scheduler row with queued/retried/processed/failed counts. An
advisory lock plus the database partial unique index prevents overlapping runs for the same
command; abandoned rows are recovered before the next run. `-Verify` checks the two task
definitions without mutating Task Scheduler.

Adjusted publication is fail-closed. Corporate-action coverage must fully contain the active raw
dataset range and every price-affecting action in that range must be verified. Blocked publications
deactivate unsafe adjusted versions without changing raw history and expose `coverage`,
`unverified`, or `quality` in the publisher summary.

`MARKET_INGEST_MAX_PAGES` defaults to `128` (`1..512`) and
`MARKET_INGEST_MAX_ROWS` defaults to `250000` (`100..250000`). The CLI accepts only code-owned
assets, timeframes, symbols, and HTTPS provider endpoints. No selected MVP provider requires an API
key. The provider terms remain `research_only`; none grants commercial redistribution rights.

## Investor Intelligence Imports

Use `research_import.py` to post normalized research JSON into the Next.js API:

```powershell
python quant-worker\research_import.py --symbol BTC
python quant-worker\research_import.py --payload .\local-research\BTC-research.json
```

The payload contract accepts `source`, `kind`, optional `symbol`, `insights`, `evidence`, `thesis`, `forecasts`, and `providerRuns`. It supports normalized output from configured research providers and the isolated Kronos shadow evaluator.

## Smart Insights Crypto Worker

Capacity verification is local and test-only. Set `TEST_DATABASE_URL` to a local database ending
in `_test`, then run `python run_backtest_capacity.py --runs 20 --workers 10` and the corresponding
50-run gate with `--workers 20`. The harness uses the production PostgreSQL claim and execution
path, deletes its temporary organizations, and is not provider-data evidence.

`collect_smart_insights.py` owns the allow-listed Crypto collectors, immutable raw-artifact
publication, metric definition seeding, point-in-time observation queries, and Crypto Regime Score
publication. Fixture parsers do not enable a source; use the live-smoke boundary first:

```powershell
$env:PYTHONPATH=(Resolve-Path "quant-worker").Path
python quant-worker\collect_smart_insights.py daily --live-smoke `
  --source alternative-fng --env-file .env.local
```

Live smoke writes nothing and emits only source code, effective time, row count, status, and a
sanitized error code. Daily collection writes gzipped content-addressed artifacts through the
configured backend, publishes accepted observations transactionally, and calculates a regime
snapshot after the enabled collectors finish. Development defaults to the private filesystem under
`SMART_INSIGHTS_ARTIFACT_ROOT`. Production sets `SMART_INSIGHTS_ARTIFACT_BACKEND=s3` and stores
private objects under `s3://datavest/smart-insights/raw/`; failed uploads remain in the bounded local
spool for operational retry. Scrapling sources use only fixed
registry URLs or source-specific discovered paths; arbitrary scheduler URLs are rejected.
CoinShares images are read locally by RapidOCR and fail closed on confidence, layout, unit, or
cross-table reconciliation errors.

Macro collection uses `FredCollector` for the fixed FRED registry, `CftcCollector` for fixed CFTC
contracts/report types, and `CryptoCraftCollector` for the attributed visible calendar. The Macro
pipeline publishes a confidence/coverage-gated directional regime snapshot plus an independent
Event Risk snapshot. Run the three no-write smoke boundaries before enabling their source codes:

```powershell
python quant-worker\collect_smart_insights.py daily --source fred --live-smoke
python quant-worker\collect_smart_insights.py weekly --source cftc-legacy --live-smoke
python quant-worker\collect_smart_insights.py calendar-current --source cryptocraft --live-smoke
```
