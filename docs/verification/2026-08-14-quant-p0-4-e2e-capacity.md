# Quant P0.4 E2E and Capacity Verification

Date: 2026-08-14
Branch: `feat/quant-p0-production`

## Outcome

The authenticated Quant workflow and 20/50 concurrent-run correctness gates pass on the isolated local PostgreSQL test database. This does **not** override the provider-data blockers recorded in the P0.3 historical correctness report, so the complete Quant product is not yet production-ready for adjusted VN backtests.

## Isolated authenticated workflow

- Database: local `quant_insight_radar_test`, migrated before each browser run.
- Fixtures: immutable `test_fixture` datasets for VN equity, crypto spot, and XAU spot.
- Authentication: real Better Auth sign-up cookie and organization activation.
- Desktop: three preselected legs, backtest submission, production worker execution, Active Portfolio, Equity Curve & Drawdown, Trade List, Advanced Analysis, Apply strategy, and Mock Portfolio assignment all passed.
- Mobile: the same three-leg backtest passed at 390 x 844 with no document-level horizontal overflow or post-auth console/API errors.
- A browser RED exposed connection-session timezone drift that could prematurely expire `deadlineAt`; Prisma PostgreSQL connections now force UTC and have a regression test.

## PostgreSQL capacity evidence

Both measurements use `PostgresWorkerRepository.claim_next_run()` and `process_next_run()` with immutable fixture bars. The harness does not bypass the production claim, checksum, checkpoint, artifact, or completion path.

| Runs | Worker threads | Succeeded | Retries | Ownership violations | Queue p95 | Runtime p95 | Total elapsed |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 20 | 10 | 20 | 0 | 0 | 26.4799 s | 26.1867 s | 46.6778 s |
| 50 | 20 | 50 | 0 | 0 | 140.2680 s | 78.3642 s | 168.6402 s |

The 50-run gate proves terminal correctness on this machine, but its latency shows CPU contention. Production should keep a bounded worker pool and explicit queue observability rather than promising immediate completion under peak load.

The PostgreSQL regression suite also proves:

- 20 and 50 simultaneous claimers never double-claim a run.
- Progress is monotonic and exhausted stale leases become `timed_out`.
- A cancellation after claim wins at the next checkpoint and cannot write an artifact.
- Artifact organization ownership matches the run organization.

## Remaining production blockers

1. VN `total_return` publication remains fail-closed: 808 adjusted candidates are blocked by incomplete corporate-action coverage, with 18 unresolved FPT actions in the audited basket.
2. The local ingestion verifier still needs observed successful hourly and daily scheduler runs in the deployment environment; test fixtures are not provider evidence.
3. At 50 concurrent jobs, local p95 queue latency is about 140 seconds. Production capacity limits and alerts must reflect the deployed CPU/DB topology.

## Release gate

- Vitest: 63 files, 331 tests passed.
- Quant worker: 375 tests passed, 25 skipped.
- PostgreSQL integration: 3 files, 17 tests passed.
- TypeScript, targeted ESLint, Prisma schema validation, and the Next.js production build passed.
- Provider-data gate remains failed: 453 stale datasets, 128,399 missing bars, and 313 recent provider failures. The latest recorded scheduler success was `2026-08-14T05:17:10.917+07:00`.

The code, browser, database-isolation, and local capacity gates are green. Provider freshness and VN corporate-action completeness remain separate blocking operational gates, so this report does not certify the Quant product as production-ready.

## Commands

```powershell
npm run test:integration
npm run test:e2e
python quant-worker/run_backtest_capacity.py --runs 20 --workers 10
python quant-worker/run_backtest_capacity.py --runs 50 --workers 20
```
