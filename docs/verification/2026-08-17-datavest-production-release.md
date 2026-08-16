# DataVest production release evidence — 2026-08-17

## Release identity

- Domain: `https://datavest.vn`
- Active application release: `eef8309cdde55a82d4df7662b0c19d3470c275e0`
- Active release directory: `20260816T224350Z-eef8309cdde5`
- GitHub artifact workflow: `31976715582`, conclusion `success`
- GitHub artifact digest: `sha256:13d595a667a3771424ec8c0d09b41e2f3bbbb6fca1cfc05b19c0008cb5ae31a7`
- Release archive SHA-256: `279afb5664f253f202c2cf9323b1db3f7dd6112456d2d4c8b91ef82361d4a74a`
- The downloaded artifact ZIP matched the GitHub digest, and its release tarball matched the bundled SHA-256 file before transfer.

## Runtime checks

- `datavest-web.service`: active
- `datavest-quant-engine.service`: active
- `datavest-worker.service`: active
- Quant health on loopback: HTTP 200, `engine=quant-engine-v1`
- Web readiness on loopback: HTTP 200 with the active release SHA
- Public readiness: HTTP 200 with the active release SHA
- PostgreSQL: 31 migrations present, no pending migration during activation

The deploy kept two release directories only: the active release and one rollback release. The deploy command removed the transferred application archive after activation. DataVest `incoming` and task-specific `/tmp` staging were empty after cleanup.

## Storage and backup

- Root filesystem after deployment: 38 GB total, 31 GB used, 7.7 GB available (80%)
- Release directories: 1.5 GB total for current plus rollback
- Shared dependency/runtime storage: 1.7 GB
- PostgreSQL backup timer: enabled and active
- Restore-drilled encrypted backup:
  `s3://datavest/operations/backups/postgres/2026/08/20260816T190342Z.dump.enc`
- Restore drill result: `restore_drill_status=ok`
- No plaintext dump remained in the backup spool or restore temporary directory after the drill.

## Scheduled data jobs

Enabled timers after successful production smokes:

- `datavest-market-daily.timer`
- `datavest-postgres-backup.timer`
- `datavest-smart-daily.timer`
- `datavest-smart-weekly.timer`
- `datavest-calendar-current.timer`
- `datavest-calendar-next.timer`
- `datavest-briefing.timer`

The production market smoke completed successfully for all 22 selected daily assets, with 22 succeeded and 0 degraded. It covered the curated Vietnam equity/index, crypto, and XAU universe. The run used 276.7 MB peak memory and no swap.

The restored S3 publication boundary accepts only integrity-matching local or `s3://` locators with the expected source, observation year/month, and content hash. Production evidence after the fix:

- Weekly job exited 0: BIS published 65 records and CoinShares published 40; CFTC remained fail-closed.
- Calendar current job exited 0: CryptoCraft published 28 current-week and 21 next-week events.
- Calendar next job exited 0 with `not_due`, which is the expected schedule state at verification time.
- Daily job exited 0. Successful sources included Alternative.me FNG, BitInfoCharts, BlockchainCenter, CBBI, CoinMetrics, DefiLlama, Deribit, all three Farside ETF feeds, GDACS, mempool.space, NASA EONET, and USGS.
- FRED timed out during this run. Both CoinGlass paths remained `SCHEMA_DRIFT`/quarantined because the public tables exposed placeholders rather than usable values.
- A bounded, non-persisting DeepSeek production smoke returned one accepted JSON response through the configured client. The briefing job then exited 0 with zero records because production still had zero organization memberships; the enabled timer will begin generating tenant briefings when memberships exist.
- PostgreSQL contained new `insight_raw_snapshots.storage_locator` values under `s3://datavest/smart-insights/raw/...` for BIS, CoinShares, CryptoCraft, and the successful daily sources.

`datavest-smart-four-hourly.timer` remains disabled because it contains only the two CoinGlass collectors, so it cannot currently produce a successful source result. Provider failures remain visible and no sample, synthetic, or unverified provider value was persisted as live evidence.

## Public browser and SEO checks

Read-only Chromium checks were run at desktop and mobile viewports after waiting for network idle:

- Homepage: HTTP 200
- Title: `DataVest.vn | Dữ liệu định lượng cho nhà đầu tư cá nhân`
- Primary heading: `Bản tin quyết định định lượng theo dữ liệu đã kiểm chứng.`
- HTML language: `vi`
- Canonical: `https://datavest.vn`
- `robots.txt`: HTTP 200
- `sitemap.xml`: HTTP 200
- `https://www.datavest.vn/`: HTTP 308 to the apex domain
- No uncaught browser page exception occurred.
- The anonymous homepage regression passed on desktop and mobile with zero tenant-only requests and zero failed API responses.

Authenticated Smart Insights also passed its desktop end-to-end account, workspace, 25-asset opinion, evidence, and request-budget flow after the guest gating change.

## Remaining release automation work

The production application was activated through the restricted `datavest-deploy` account and fixed sudo command. The GitHub production environment still needs its VPS host, port, user, SSH key, and known-hosts secrets before `workflow_dispatch` can deploy without the local operator path. Entering the private key requires explicit confirmation at the action moment. This does not affect the active release or the successful build-on-push workflow.
