# Verified dataset bootstrap

This is a one-time, operator-controlled transfer of current, verified 1D raw datasets from a local PostgreSQL instance to DataVest production. S3 is private transport and recovery storage only. The web application and backtests always query PostgreSQL; they never read historical bars from S3 at request time.

## Eligibility and safety

The exporter accepts only active `1d` + `raw` versions for the approved Vietnam equity, crypto spot, and gold providers. It rejects stale data (older than three days), fixtures, seeded/simulated data, failed-quality versions, missing bars, or metadata/checksum mismatches. Each compressed CSV has a deterministic checksum and the immutable S3 manifest is uploaded only after all payloads have been verified.

The importer validates the private S3 locator, object size, object SHA-256, CSV checksum, coverage and quality again before publishing a new immutable PostgreSQL version. It does not enqueue strategy evaluations. Superseded inactive versions are removed only when unreferenced; referenced history is retained and reported.

## Required local transfer settings

Keep these in an ignored, local-only file such as `C:\secure\datavest-s3.env`; do not put them in GitHub Actions or commit them:

```text
DATAVEST_S3_ENDPOINT_URL=https://<private-s3-endpoint>
DATAVEST_S3_BUCKET=datavest
DATAVEST_S3_ACCESS_KEY_ID=<restricted-key>
DATAVEST_S3_SECRET_ACCESS_KEY=<restricted-secret>
```

The key needs access only to the `datavest` bucket and the `operations/dataset-sync/` prefix. Production keeps its own S3 settings in `/opt/datavest/shared/.env`.

## Operator sequence

After database migrations and before validating multi-currency portfolios, bootstrap the public
Yahoo Finance `USDVND=X` daily history directly into PostgreSQL. Daily refresh subsequently prefers
the Vietcombank midpoint and uses Yahoo only when that endpoint is unavailable:

```powershell
.\.venv\Scripts\python.exe quant-worker\sync_fx_rates.py --mode backfill --env-file .env.local
```

The command is idempotent and reports requested/stored/deduplicated/failed counts plus coverage
dates. It stores only parsed provider observations. A parser or network failure remains retryable
and never writes the `26,000 VND/USD` application fallback into `fx_rates`.

From the repository root on the local source machine:

```powershell
$env:PYTHONPATH=(Resolve-Path "quant-worker").Path
.\.venv\Scripts\python.exe quant-worker\sync_dataset_bootstrap.py scan --env-file .env.local
.\.venv\Scripts\python.exe quant-worker\sync_dataset_bootstrap.py export --env-file .env.local --s3-env-file C:\secure\datavest-s3.env --spool-root .local-data\dataset-sync
```

Record the returned manifest locator and SHA-256 in the release evidence. A verified upload deletes its local batch spool; a failed upload leaves it intact for safe retry.

On the VPS, first perform a no-write preflight, then apply the same manifest:

```bash
sudo -u datavest /opt/datavest/shared/python-venv/bin/python \
  /opt/datavest/current/quant-worker/sync_dataset_bootstrap.py import \
  --env-file /opt/datavest/shared/.env \
  --manifest 's3://datavest/operations/dataset-sync/<batch-id>/manifest.json'

sudo -u datavest /opt/datavest/shared/python-venv/bin/python \
  /opt/datavest/current/quant-worker/sync_dataset_bootstrap.py import \
  --env-file /opt/datavest/shared/.env \
  --manifest 's3://datavest/operations/dataset-sync/<batch-id>/manifest.json' \
  --apply
```

After an apply, run the market health endpoint and a real moving-average backtest against one imported symbol. Keep production scheduling unchanged: `datavest-market-daily.timer` remains the owner of subsequent refreshes.
