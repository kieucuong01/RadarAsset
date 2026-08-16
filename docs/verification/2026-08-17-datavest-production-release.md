# DataVest production release evidence — 2026-08-17

## Release identity

- Domain: `https://datavest.vn`
- Active application release: `951529dc388131070b7fefd78d33ff9cfd14db9c`
- Active release directory: `20260816T192430Z-951529dc3881`
- Latest installed operations configuration: `29a73a3` (writable, private browser HOME for hardened collector jobs)
- GitHub artifact workflow: `31967001594`, conclusion `success`
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

Enabled timers:

- `datavest-market-daily.timer`
- `datavest-postgres-backup.timer`

The production market smoke completed successfully for all 22 selected daily assets, with 22 succeeded and 0 degraded. It covered the curated Vietnam equity/index, crypto, and XAU universe. The run used 276.7 MB peak memory and no swap.

The following timers remain disabled because their production-environment smoke did not pass:

- `datavest-smart-four-hourly.timer`: Chrome launches correctly after the browser HOME fix, but CoinGlass returns placeholder-only tables and the fail-closed parser reports `SCHEMA_DRIFT`.
- `datavest-smart-daily.timer`: includes the same CoinGlass sources, so it is not enabled independently.
- `datavest-smart-weekly.timer`: BIS, CFTC, and CoinShares all returned `INTERNAL_ERROR` in the production smoke.
- `datavest-calendar-current.timer` and `datavest-calendar-next.timer`: CryptoCraft returned HTTP 200, but the production parse path exited with status 2 and published no events.
- `datavest-briefing.timer`: there were zero organization memberships, so a run would not exercise DeepSeek or produce meaningful verification evidence.

These failures remain visible and no sample, synthetic, or unverified provider value was persisted as live evidence.

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

Known browser issue: an unauthenticated homepage visit still requests protected portfolio and Smart Insights APIs, producing expected 401 responses plus one briefing 409 in the console. The page renders its labelled unavailable/sample fallback, but these requests should be gated by authentication in a later frontend fix.

## Remaining release automation work

The production application was activated through the restricted `datavest-deploy` account and fixed sudo command. The GitHub production environment still needs its VPS host, port, user, SSH key, and known-hosts secrets before `workflow_dispatch` can deploy without the local operator path. This does not affect the currently active release or the build-only push workflow.
