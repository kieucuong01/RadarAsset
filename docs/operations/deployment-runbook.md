# DataVest production deployment

DataVest deploys a checksummed artifact built by GitHub Actions. A normal VPS release performs no source checkout, application build, or online dependency resolution. The server retains only the active release and one rollback release.

## Evidence model

Keep these facts separate in every release record:

- **pushed SHA**: the commit visible on the remote Git branch;
- **artifact SHA/checksum**: the identity verified by GitHub and the VPS;
- **active SHA**: `release.json` below the resolved `/opt/datavest/current` target;
- **HTTP health**: loopback and public readiness responses;
- **product proof**: an authenticated desktop/mobile browser check.

One fact does not prove the others.

## Transfer and deploy

Download the workflow artifact for the exact 40-character commit SHA. Transfer only the archive and its adjacent checksum to `/opt/datavest/incoming/` as `datavest-deploy`; never transfer an environment file.

On the VPS, identify the files without printing secrets:

```bash
cd /opt/datavest/incoming
sha256sum -c datavest-release-<first-12-sha>.tar.gz.sha256
ls -lh datavest-release-<first-12-sha>.tar.gz*
```

Deploy through the one allowed privileged entry point:

```bash
sudo /usr/local/sbin/deploy-datavest \
  /opt/datavest/incoming/datavest-release-<first-12-sha>.tar.gz \
  <full-40-character-sha>
```

Success ends with `deploy_status=ok`, the release ID, and the full Git SHA. The script verifies the adjacent checksum, archive paths, disk reserve, extracted manifest, release identity, offline dependencies, Prisma migration, service restarts, two loopback health endpoints, and the public HTTPS readiness endpoint before pruning.

## Post-deploy verification

```bash
readlink -f /opt/datavest/current /opt/datavest/previous
sudo -u datavest node -p "require('/opt/datavest/current/release.json').gitSha"
systemctl is-active datavest-web datavest-quant-engine datavest-worker
systemctl is-enabled datavest-web datavest-quant-engine datavest-worker
curl --fail --silent --show-error http://127.0.0.1:8200/healthz
curl --fail --silent --show-error http://127.0.0.1:4200/api/health/ready
curl --fail --silent --show-error https://datavest.vn/api/health/ready
journalctl -u datavest-web -u datavest-quant-engine -u datavest-worker --since '-10 minutes' --no-pager
df -h /opt/datavest
du -sh /opt/datavest/releases /opt/datavest/shared
```

Then use a real authenticated browser to verify sign-in, dashboard data, Smart Insights, one Quant Lab read path, responsive layout, assets, and application console errors. HTTP 200 alone is not product verification.

## Automatic rollback

After the symlink switch, any service restart or health failure restores `current`, the shared Python and Prisma pointers, and `release.env` to the prior release. The script restarts the prior services and emits `deploy_status=rolled_back`. Database migrations are forward-only, so every migration must remain compatible with the previous application release.

Inspect recovery with:

```bash
readlink -f /opt/datavest/current /opt/datavest/previous
systemctl is-active datavest-web datavest-quant-engine datavest-worker
journalctl -u datavest-web -u datavest-quant-engine -u datavest-worker --since '-15 minutes' --no-pager
```

## Manual rollback

Use manual rollback only after confirming that `previous` resolves to a direct child of `/opt/datavest/releases` and its `release.json` is the intended SHA. The normal deploy entry point owns pointer and dependency consistency; do not manually repoint only `current` when dependency hashes differ. Prefer redeploying the prior GitHub artifact through `/usr/local/sbin/deploy-datavest` so checksum, migration compatibility, shared dependency pointers, health checks, and bounded retention all run again.

If the deploy entry point itself is broken, stop and repair it from the reviewed release bundle before changing symlinks. Preserve both release directories and collect service journals first.
