# DataVest VPS provisioning

Provisioning is a one-time, idempotent operation for the shared VPS. It creates DataVest-specific users, directories, database credentials, environment configuration, and service definitions. It does not start DataVest until a valid `current` release exists, and it does not modify Radar BDS or La So Tinh Hoa application files.

## Read-only preflight

Record these checks before provisioning:

```bash
date -u
df -h /
free -h
ss -ltnp
systemctl --failed
systemctl is-active nginx postgresql radar-bds
pm2 status
du -sh /opt/lasotinhhoa /opt/radar-bds /var/lib/postgresql
sudo -u postgres psql -Atc "SELECT datname, pg_size_pretty(pg_database_size(datname)) FROM pg_database ORDER BY pg_database_size(datname) DESC"
```

Inspect Nginx server names and PostgreSQL listener/firewall rules separately. Do not print environment files. Confirm required source keys with a script that emits only configured booleans.

## Source environment paths

The provisioning entry point accepts exactly two absolute source paths:

- a DeepSeek environment below `/opt/lasotinhhoa/`;
- the Radar BDS S3 environment below `/opt/radar-bds/`.

The parser never executes shell syntax. It copies only the named DeepSeek and S3 values into DataVest-specific settings. DataVest never sources either application environment at runtime.

Run the non-mutating validation first:

```bash
sudo bash deploy/linux/provision-datavest.sh \
  --deepseek-env-file /opt/lasotinhhoa/current/.env \
  --s3-env-file /opt/radar-bds/current/.env \
  --dry-run
```

Expected output contains only `deepseek_configured=true`, `s3_configured=true`, and `provision_status=dry_run_ok`. If the live Tử Vi path differs, locate it using file names and key presence without printing values, then pass the resolved path explicitly.

## Provision

After the dry run passes:

```bash
sudo bash deploy/linux/provision-datavest.sh \
  --deepseek-env-file /opt/lasotinhhoa/current/.env \
  --s3-env-file /opt/radar-bds/current/.env
```

The operation creates:

- service account/group `datavest`;
- SSH deploy account `datavest-deploy` with password login locked;
- `/opt/datavest/{releases,incoming,shared,logs}` and the bounded shared spool;
- PostgreSQL role/database `datavest` with an independent generated password;
- `/opt/datavest/shared/.env`, mode `0640`, owner `root:datavest`;
- DataVest systemd units and, when the files are present, the fixed deployment/scheduled-job entry points and narrow sudoers rule.

The script preserves existing generated DataVest secrets on rerun. It rotates neither DeepSeek nor S3 credentials; it copies the currently configured named values.

## Post-provision verification

```bash
sudo stat -c '%U:%G %a %n' /opt/datavest/shared/.env
sudo -u postgres psql -Atc "SELECT datname FROM pg_database WHERE datname = 'datavest'"
systemctl cat datavest-web datavest-quant-engine datavest-worker
systemctl is-enabled datavest-web datavest-quant-engine datavest-worker
```

The environment file must be `root:datavest 640`. Unit definitions may be installed but must remain inactive before the first release. A successful provisioning command is not deployment evidence.

## Shared PostgreSQL listener audit

Port 5432 was publicly listening during the design audit. Before launch, inspect `SHOW listen_addresses`, `pg_hba_file_rules`, firewall rules, and recent remote connection sources. If no approved remote consumer exists, close public access. If one exists, restrict it to explicit source IPs and roles/databases. Verify Radar BDS and La So Tinh Hoa database-backed pages immediately after any shared PostgreSQL or firewall change.
