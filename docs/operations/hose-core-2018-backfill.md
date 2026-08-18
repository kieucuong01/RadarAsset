# HOSE core daily backfill

The supported no-credential Vnstock Community boundary is `2018-08-20` for
the nine core Vietnam assets: `VNINDEX`, `VN30`, `FPT`, `VCB`, `HPG`, `VNM`,
`MWG`, `SSI`, and `VIC`.

Run a no-write source check before any publication:

```powershell
python quant-worker/ingest_market_data.py all --profile vn-core-2018 --dry-run --env-file .env.local
```

Publish one immutable raw daily version per symbol:

```powershell
python quant-worker/ingest_market_data.py all --profile vn-core-2018 --env-file .env.local
```

## Production runtime preparation

Before the first Vnstock run on a host, create its runtime directories with
ownership restricted to the service user. This is an operational prerequisite,
not market data, and is safe to repeat:

```bash
install -d -o datavest -g datavest -m 0750 \
  /opt/datavest/.vnstock /opt/datavest/.config /opt/datavest/.cache
```

Run the production command from `current/quant-worker` as `datavest`, using
the shared virtual environment and environment file. Do not run it as root or
point it at a developer database.

Then verify the active versions in PostgreSQL. Each must start on
`2018-08-20`, have an end no earlier than the latest closed HOSE session, and
retain every provider gap as a quality issue. Do not invent prices, fill gaps,
or relabel a warning dataset as passed.

The normal `market-daily` job is incremental after the one-time publication:
it fetches only the recent overlap and preserves immutable prior versions.

For future selected-symbol or full-HOSE expansion, first add the symbols to a
bounded profile or queue, run the same no-write check, inspect coverage and
provider gaps, then publish in bounded batches. Full-HOSE ingestion is not
part of this core backfill command.
