# Quant P0.1 ingestion convergence verification

Verified locally on 2026-08-14 against the configured PostgreSQL database.

## Passing gates

- Prisma: 24 migrations applied; schema is up to date.
- Scheduler: hourly enqueue-only run completed in 8.79 seconds with 48 requests queued and 0 requests synchronously processed.
- Worker: heartbeat persisted with an active request; the queue moved from 48 queued to 47 queued and 1 running.
- Runtime: `http://127.0.0.1:3100/quant-lab` returned HTTP 200; `http://127.0.0.1:8100/healthz` returned `quant-engine-v1` healthy.
- Focused verification: 31 due-queue/lease tests, 21 catalog/operations tests, 10 verifier tests, 16 readiness/i18n tests, Prisma validation, and TypeScript all passed.
- Catalog safety: a partial or failed provider catalog no longer deactivates the previously known universe. The local rows affected by the smoke were restored from existing active dataset evidence (417 provider instruments/assets).

## Truthful current data status

The system is operational but the market data is not production-ready yet:

- 421 stale raw datasets.
- 128,399 missing bars reported by active versions.
- 229 terminal provider failures in the previous 24 hours.
- External Binance/Vnstock requests were blocked or unavailable in the local environment during the smoke.

The operational verifier therefore correctly returns `failed` with `stale_datasets`; this is an external-data convergence result, not a passing data-readiness claim. Provider failures remain visible as diagnostics while readiness is gated by freshness, backlog age, scheduler cadence, and worker liveness.

## P0.1 conclusion

The enqueue/worker topology and observability contract are implemented and verified. Full data readiness remains blocked by provider access and the P0.2 data-quality/freshness work; the UI must continue showing the degraded state until those datasets converge.
