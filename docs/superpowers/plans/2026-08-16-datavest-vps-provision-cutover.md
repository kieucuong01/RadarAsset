# DataVest VPS Provisioning and Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision DataVest on the shared VPS, deploy checksummed artifacts atomically, run the web/quant/worker/collector stack under systemd, expose `datavest.vn` through Nginx/TLS, and verify rollback and production behavior without disrupting existing applications.

**Architecture:** A root-owned provisioning script creates the dedicated user, directories, database, environment, systemd units, and Nginx site. A narrowly scoped deploy script accepts an already-built archive, verifies paths and checksums, updates hash-keyed shared dependencies, migrates the database, atomically switches `current`, restarts services, and rolls back on failed health checks. GitHub Actions transfers artifacts through a dedicated deploy account; all application secrets stay on the VPS.

**Tech Stack:** Ubuntu 24.04, systemd, Nginx, PostgreSQL, Certbot, Bash, Node.js 22+ runtime, Python 3.12, Prisma 7, GitHub Actions over SSH/SCP, curl, sha256sum, flock, journald.

## Global Constraints

- Preserve Radar BDS, La So Tinh Hoa, webtudongai, Nginx, PostgreSQL, Redis, PM2, and their data/configuration.
- Bind DataVest web to `127.0.0.1:4200` and quant engine to `127.0.0.1:8200`; never expose those ports publicly.
- Keep exactly the active release and one rollback release after successful deployment.
- Never run `git pull`, `npm install`, `npm build`, `pip wheel`, or source compilation during a normal VPS deployment.
- Production secrets live only in `/opt/datavest/shared/.env`, owned by root and readable by the DataVest service group.
- Do not source Radar BDS or La So Tinh Hoa environment files at application runtime; copy only named values during provisioning.
- Deployment success requires SHA, checksum, migration, systemd, loopback health, public HTTPS, and authenticated browser evidence.
- Global PostgreSQL/firewall changes require a read-only dependency audit and explicit proof that existing applications remain healthy.

---

### Task 1: Production environment and configuration contracts

**Files:**
- Create: `deploy/linux/env.production.example`
- Create: `deploy/linux/systemd/datavest-web.service`
- Create: `deploy/linux/systemd/datavest-quant-engine.service`
- Create: `deploy/linux/systemd/datavest-worker.service`
- Create: `scripts/release/deployment-config-contract.test.mjs`

**Interfaces:**
- Produces environment file path: `/opt/datavest/shared/.env`.
- Produces services: `datavest-web`, `datavest-quant-engine`, and `datavest-worker`.
- Consumes release pointer: `/opt/datavest/current`.
- Consumes shared Python environment: `/opt/datavest/shared/python-venv`.

- [ ] **Step 1: Write failing configuration contract tests**

```js
const web = await read("deploy/linux/systemd/datavest-web.service");
expect(web).toContain("User=datavest");
expect(web).toContain("EnvironmentFile=/opt/datavest/shared/.env");
expect(web).toContain("Environment=PORT=4200");
expect(web).toContain("Environment=HOSTNAME=127.0.0.1");
expect(web).toContain("ExecStart=/usr/bin/node /opt/datavest/current/web/server.js");
expect(web).toContain("MemoryMax=600M");
expect(web).toContain("NoNewPrivileges=true");

const engine = await read("deploy/linux/systemd/datavest-quant-engine.service");
expect(engine).toContain("--host 127.0.0.1 --port 8200");
expect(engine).toContain("MemoryMax=850M");

const worker = await read("deploy/linux/systemd/datavest-worker.service");
expect(worker).toContain("process_ingestion_requests.py");
expect(worker).toContain("--watch");
expect(worker).toContain("MemoryMax=750M");
```

Also assert `ProtectSystem=strict`, `PrivateTmp=true`, `UMask=0027`, `Restart=on-failure`, bounded restart timing, and an explicit writable path for `/opt/datavest/shared/spool`.

- [ ] **Step 2: Run the contract and verify RED**

Run: `npx vitest run scripts/release/deployment-config-contract.test.mjs`

Expected: FAIL because the Linux configuration files do not exist.

- [ ] **Step 3: Define the production environment template**

Include names and non-secret values only:

```dotenv
NODE_ENV=production
NEXT_PUBLIC_SITE_URL=https://datavest.vn
BETTER_AUTH_URL=https://datavest.vn
BETTER_AUTH_SECRET=
DATABASE_URL=
DATAVEST_RELEASE_SHA=
QUANT_ENGINE_URL=http://127.0.0.1:8200
QUANT_ENGINE_API_TOKEN=
QUANT_WORKER_API_TOKEN=
QUANT_WORKER_ORGANIZATION_SLUG=
QUANT_WORKER_USER_EMAIL=
SMART_INSIGHTS_ARTIFACT_BACKEND=s3
SMART_INSIGHTS_ARTIFACT_SPOOL_ROOT=/opt/datavest/shared/spool
DATAVEST_S3_ENDPOINT_URL=
DATAVEST_S3_BUCKET=datavest
DATAVEST_S3_ACCESS_KEY_ID=
DATAVEST_S3_SECRET_ACCESS_KEY=
DATAVEST_S3_ARTIFACT_PREFIX=smart-insights/raw
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=
DEEPSEEK_TIMEOUT_SECONDS=30
SMART_INSIGHTS_TIMEZONE=Asia/Bangkok
DATAVEST_BACKUP_ENCRYPTION_SECRET=
```

- [ ] **Step 4: Implement hardened systemd services**

Use `WorkingDirectory` under `current`, the shared environment file, `After=network-online.target postgresql.service`, `Restart=on-failure`, `RestartSec=5`, `StartLimitBurst=5`, and `TimeoutStopSec=30`. Grant writable access only to the shared spool and runtime directory. Set initial limits to web 600M, engine 850M, and worker 750M; these are tuned from measured peaks after 24 hours.

- [ ] **Step 5: Run configuration tests and verify GREEN**

Run: `npx vitest run scripts/release/deployment-config-contract.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit base runtime configuration**

```bash
git add deploy/linux/env.production.example deploy/linux/systemd scripts/release/deployment-config-contract.test.mjs
git commit -m "ops: define DataVest production services"
```

---

### Task 2: Safe one-time VPS provisioning

**Files:**
- Create: `deploy/linux/provision-datavest.sh`
- Create: `scripts/release/provision-contract.test.mjs`
- Create: `docs/operations/vps-provisioning.md`

**Interfaces:**
- Produces CLI:
  `sudo provision-datavest.sh --deepseek-env-file <absolute-path-under-/opt/lasotinhhoa> --s3-env-file /opt/radar-bds/current/.env`.
- Produces service user/group `datavest` and password-locked SSH deploy account `datavest-deploy`.
- Produces database/role: `datavest` with a generated password.
- Produces directories and environment described by the design spec.
- Installs a fixed sudoers entry allowing the deploy account to run only `/usr/local/sbin/deploy-datavest`.

- [ ] **Step 1: Write failing provisioning contract tests**

Assert the script begins with strict Bash mode, requires root, validates both source env files with `realpath`, and contains no `set -x`, `echo "$...SECRET"`, wildcard recursive deletion, or public database binding:

```js
expect(script).toContain("set -Eeuo pipefail");
expect(script).toContain('[[ "${EUID}" -eq 0 ]]');
expect(script).toContain("realpath --");
expect(script).toContain("/opt/lasotinhhoa/");
expect(script).toContain("/opt/radar-bds/");
expect(script).not.toContain("set -x");
expect(script).not.toMatch(/rm\s+-rf\s+[^\"]*\*/);
```

- [ ] **Step 2: Run the contract and verify RED**

Run: `npx vitest run scripts/release/provision-contract.test.mjs`

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement argument and source-file validation**

Require absolute existing regular files. Resolve them and enforce these prefixes exactly:

```bash
case "${deepseek_env}" in
  /opt/lasotinhhoa/*) ;;
  *) echo "deepseek_env=invalid" >&2; exit 2 ;;
esac
case "${s3_env}" in
  /opt/radar-bds/*) ;;
  *) echo "s3_env=invalid" >&2; exit 2 ;;
esac
```

Load values with `read_env_file` from `deploy/linux/datavest_env.py`, never `source`, so shell syntax in env values cannot execute. Extract only `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, `RADAR_S3_ENDPOINT_URL`, `RADAR_S3_ACCESS_KEY_ID`, and `RADAR_S3_SECRET_ACCESS_KEY`. Map the Radar names to the corresponding `DATAVEST_S3_*` names in the target environment.

- [ ] **Step 4: Provision user, paths, and secrets idempotently**

Create the non-login service account only when absent. Create `datavest-deploy` with a locked password and SSH-capable shell; its authorized key is installed separately and it receives no application-secret read permission. Use `install -d` with explicit owners/modes for `/opt/datavest/{releases,incoming,shared,logs}` and `/opt/datavest/shared/spool`; only `incoming` is writable by `datavest-deploy`. Generate independent values using `openssl rand -hex 32` for Better Auth, quant engine, worker, and database passwords. If `/opt/datavest/shared/.env` exists, preserve existing generated values and update only missing required keys through an atomic root-owned temporary file.

Write the final env with mode `0640`, owner `root:datavest`, and no console output containing values.

- [ ] **Step 5: Provision the least-privilege PostgreSQL role/database**

Use `sudo -u postgres psql -v ON_ERROR_STOP=1` with variables rather than string interpolation. Create the role/database only if missing, set the database owner to the DataVest role, and construct `DATABASE_URL` with percent-encoded credentials. Run the database commands locally over the Unix socket.

- [ ] **Step 6: Install operational files idempotently**

Install systemd units into `/etc/systemd/system`, deploy entry point into `/usr/local/sbin/deploy-datavest`, scheduled runner into `/usr/local/libexec/datavest/run-scheduled-job`, and Nginx configuration only after their later tasks exist. Call `systemctl daemon-reload` but do not start DataVest until `current/web/server.js` exists.

Install `/etc/sudoers.d/datavest-deploy` with mode `0440`, validate it with `visudo -cf`, and allow only:

```text
datavest-deploy ALL=(root) NOPASSWD: /usr/local/sbin/deploy-datavest
```

- [ ] **Step 7: Run shell syntax and contract checks**

Run on Linux:

```bash
bash -n deploy/linux/provision-datavest.sh
npx vitest run scripts/release/provision-contract.test.mjs
```

Expected: both exit 0.

- [ ] **Step 8: Document exact dry-run and audit commands**

The runbook records read-only checks for disk, memory, ports, existing virtual hosts, database consumers, and source env key presence. It explicitly forbids printing secret values and states that provisioning is not proof of deployment.

- [ ] **Step 9: Commit provisioning**

```bash
git add deploy/linux/provision-datavest.sh scripts/release/provision-contract.test.mjs docs/operations/vps-provisioning.md
git commit -m "ops: provision DataVest on the shared VPS"
```

---

### Task 3: Serialized scheduled jobs and timers

**Files:**
- Create: `deploy/linux/run-scheduled-job.sh`
- Create: `deploy/linux/systemd/datavest-job@.service`
- Create: `deploy/linux/systemd/datavest-market-daily.timer`
- Create: `deploy/linux/systemd/datavest-smart-four-hourly.timer`
- Create: `deploy/linux/systemd/datavest-smart-daily.timer`
- Create: `deploy/linux/systemd/datavest-smart-weekly.timer`
- Create: `deploy/linux/systemd/datavest-calendar-current.timer`
- Create: `deploy/linux/systemd/datavest-calendar-next.timer`
- Create: `deploy/linux/systemd/datavest-briefing.timer`
- Modify: `scripts/release/deployment-config-contract.test.mjs`
- Modify: `docs/operations/vps-provisioning.md`

**Interfaces:**
- Produces allow-listed jobs: `market-daily`, `smart-four-hourly`, `smart-daily`, `smart-weekly`, `calendar-current`, `calendar-next`, and `briefing`.
- Produces shared lock: `/run/lock/datavest-heavy-jobs.lock`.
- Consumes: `/opt/datavest/current/quant-worker` and `/opt/datavest/shared/.env`.

- [ ] **Step 1: Extend failing configuration tests**

Assert the runner uses strict mode, an exact `case` allowlist, `flock -n`, no `eval`, and no arbitrary command execution. Assert each timer has `Persistent=true`, `RandomizedDelaySec`, and the expected target service.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run scripts/release/deployment-config-contract.test.mjs`

Expected: FAIL because runner and timers are absent.

- [ ] **Step 3: Implement the exact command allowlist**

```bash
case "${1:-}" in
  market-daily)
    command=("${python}" "${root}/ingest_market_data.py" daily --env-file "${env_file}") ;;
  smart-four-hourly)
    command=("${python}" "${root}/collect_smart_insights.py" four-hourly --env-file "${env_file}") ;;
  smart-daily)
    command=("${python}" "${root}/collect_smart_insights.py" daily --env-file "${env_file}") ;;
  smart-weekly)
    command=("${python}" "${root}/collect_smart_insights.py" weekly --env-file "${env_file}") ;;
  calendar-current)
    command=("${python}" "${root}/collect_smart_insights.py" calendar-current --env-file "${env_file}") ;;
  calendar-next)
    command=("${python}" "${root}/collect_smart_insights.py" calendar-next --env-file "${env_file}") ;;
  briefing)
    command=("${python}" "${root}/collect_smart_insights.py" briefing --all-memberships --env-file "${env_file}") ;;
  *) echo "scheduled_job=invalid" >&2; exit 2 ;;
esac
exec flock -n /run/lock/datavest-heavy-jobs.lock "${command[@]}"
```

The systemd template applies `TimeoutStartSec=45min`, `MemoryMax=900M`, `Nice=10`, and `IOSchedulingClass=best-effort`. Exit caused by an occupied lock is recorded as skipped rather than retried immediately.

- [ ] **Step 4: Define non-overlapping schedules**

Use `Asia/Bangkok` calendar times and randomized delay:

- market daily: `01:15`;
- Smart Insights daily: `02:30`;
- Smart Insights weekly: Monday `03:30`;
- four-hourly: `00:20`, `04:20`, `08:20`, `12:20`, `16:20`, `20:20`;
- calendar current: every two hours at minute `10`;
- calendar next: `00:45` daily;
- briefing: `06:15` daily.

Before enabling timers, compare these with the live Radar BDS crawl schedule. If a conflict exists, shift DataVest jobs while preserving spacing and record the final times in the runbook.

- [ ] **Step 5: Run syntax and contract checks**

Run on Linux:

```bash
bash -n deploy/linux/run-scheduled-job.sh
systemd-analyze verify deploy/linux/systemd/datavest-job@.service deploy/linux/systemd/*.timer
npx vitest run scripts/release/deployment-config-contract.test.mjs
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit scheduled operations**

```bash
git add deploy/linux/run-scheduled-job.sh deploy/linux/systemd docs/operations/vps-provisioning.md scripts/release/deployment-config-contract.test.mjs
git commit -m "ops: schedule serialized DataVest collectors"
```

---

### Task 4: Atomic release deployment and rollback

**Files:**
- Create: `deploy/linux/deploy-datavest.sh`
- Create: `scripts/release/deploy-contract.test.mjs`
- Create: `docs/operations/deployment-runbook.md`

**Interfaces:**
- Produces installed entry point: `/usr/local/sbin/deploy-datavest <absolute-archive> <40-char-git-sha>`.
- Produces release id: `<UTC timestamp>-<first 12 SHA chars>`.
- Produces atomic pointers: `/opt/datavest/current` and `/opt/datavest/previous`.
- Consumes archive and adjacent `<archive>.sha256` from `/opt/datavest/incoming`.

- [ ] **Step 1: Write failing deployment safety tests**

Assert strict mode, root check, `flock`, canonical SHA validation, `realpath`, incoming/releases prefix validation, SHA-256 verification, no `git pull`, no online package install, and quoted literal cleanup targets:

```js
expect(script).toContain("flock -n 9");
expect(script).toContain("sha256sum -c");
expect(script).toContain("prisma migrate deploy");
expect(script).toContain("systemctl restart datavest-quant-engine.service");
expect(script).toContain("systemctl restart datavest-web.service");
expect(script).not.toMatch(/git\s+pull|npm\s+(ci|install)|pip\s+install\s+-r/);
expect(script).not.toMatch(/rm\s+-rf\s+[^\"]*\*/);
```

- [ ] **Step 2: Run contract tests and verify RED**

Run: `npx vitest run scripts/release/deploy-contract.test.mjs`

Expected: FAIL because the deploy script is absent.

- [ ] **Step 3: Implement validation and disk gate**

Validate the archive is a regular `.tar.gz` directly below `/opt/datavest/incoming`, validate its adjacent checksum contains only the archive basename, and reject links or archive entries with absolute paths or `..`. Compute required disk as archive bytes plus uncompressed size plus 1 GiB safety reserve; exit before extraction when `df` reports less. Extract with `tar --strip-components=1` into the new release directory, run `sha256sum -c manifest.sha256` from that directory, parse `release.json`, and require its full Git SHA to equal the command argument before any shared dependency or database change.

- [ ] **Step 4: Install shared dependencies by content hash**

Compare release metadata hashes with `/opt/datavest/shared/requirements.sha256` and `/opt/datavest/shared/migration-tooling.sha256`. For Python changes, build a sibling virtualenv from the shipped wheelhouse using:

```bash
python3 -m venv "${new_venv}"
"${new_venv}/bin/python" -m pip install --no-index \
  --find-links "${release_dir}/wheelhouse" \
  -r "${release_dir}/quant-worker/requirements.txt"
"${new_venv}/bin/python" -c "import fastapi, psycopg, boto3"
```

Atomically replace the shared virtualenv only after the import smoke passes. Install pinned Prisma migration tooling from the shipped offline package directory and verify `prisma --version` before replacing its shared pointer.

- [ ] **Step 5: Migrate before switching traffic**

Load `/opt/datavest/shared/.env` without printing it, set `DATAVEST_RELEASE_SHA`, and run the shared pinned CLI against the new release's `prisma/schema.prisma`:

```bash
"${migration_node}" "${migration_cli}" migrate deploy \
  --schema "${release_dir}/prisma/schema.prisma"
```

On migration failure, leave `current` and every running service untouched.

- [ ] **Step 6: Implement atomic switch and rollback trap**

Resolve and preserve the old `current` target. Create new temporary links under `/opt/datavest`, then use `mv -T` to replace `previous` and `current`. Restart quant engine, worker, and web in that order. Verify:

```bash
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:8200/healthz
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:4200/api/health/ready
curl --fail --silent --show-error --max-time 15 https://datavest.vn/api/health/ready
```

If any check fails, restore the old `current`, restart the three services, recheck loopback health, emit `deploy_status=rolled_back`, and exit non-zero.

- [ ] **Step 7: Implement bounded pruning**

After success, enumerate only direct children of `/opt/datavest/releases`, resolve each absolute path, exclude `current` and `previous` targets, and remove older release directories one by one. Delete the consumed incoming archive and checksum by their already validated literal paths. Never recursively delete `/opt/datavest`, `releases`, `shared`, `current`, or `previous`.

- [ ] **Step 8: Test script syntax and simulated path rejection**

Run on Linux:

```bash
bash -n deploy/linux/deploy-datavest.sh
npx vitest run scripts/release/deploy-contract.test.mjs
```

Add an unprivileged test mode with temporary roots and mocked system commands; assert traversal archives, wrong SHA, low disk, and failed health never change `current`.

- [ ] **Step 9: Document deployment and rollback commands**

The runbook records artifact identification, expected output fields, service/journal checks, manual rollback to the verified `previous` target, and the distinction between pushed SHA, active SHA, HTTP 200, and authenticated browser proof.

- [ ] **Step 10: Commit atomic deployment**

```bash
git add deploy/linux/deploy-datavest.sh scripts/release/deploy-contract.test.mjs docs/operations/deployment-runbook.md
git commit -m "ops: deploy DataVest releases atomically"
```

---

### Task 5: Nginx, TLS, and GitHub deployment job

**Files:**
- Create: `deploy/linux/nginx/datavest.conf`
- Modify: `.github/workflows/build-production-artifact.yml`
- Create: `scripts/release/nginx-deploy-contract.test.mjs`
- Modify: `docs/operations/deployment-runbook.md`

**Interfaces:**
- Produces Nginx server names: `datavest.vn www.datavest.vn`.
- Proxies apex traffic to `http://127.0.0.1:4200`.
- Produces GitHub deploy job consuming secrets `DATAVEST_VPS_HOST`, `DATAVEST_VPS_PORT`, `DATAVEST_VPS_USER`, `DATAVEST_VPS_SSH_KEY`, and `DATAVEST_VPS_KNOWN_HOSTS`.

- [ ] **Step 1: Write failing Nginx/workflow contract tests**

Assert exact hostnames and loopback upstream, proxy headers, body limit, timeouts, `www` redirect intent, manual workflow trigger, protected `production` environment, SCP transfer, remote deploy invocation, and absence of application secrets.

- [ ] **Step 2: Run the contract and verify RED**

Run: `npx vitest run scripts/release/nginx-deploy-contract.test.mjs`

Expected: FAIL because the Nginx site and deploy job are absent.

- [ ] **Step 3: Implement the HTTP bootstrap Nginx site**

Before Certbot, serve both names on port 80 and proxy to `127.0.0.1:4200`, with forwarded host/protocol/client IP headers, WebSocket upgrade headers, `client_max_body_size 2m`, and bounded proxy timeouts. After certificate issuance, Certbot manages TLS blocks; normalize the final configuration so `www` returns `308 https://datavest.vn$request_uri` and apex proxies to the application.

- [ ] **Step 4: Extend the workflow with a protected deploy job**

Make the deploy job depend on the successful build job and require GitHub environment `production`. Write the SSH key to a mode-600 temporary file, pin the VPS host key through a `DATAVEST_VPS_KNOWN_HOSTS` secret, transfer the archive/checksum to `/opt/datavest/incoming/`, and run:

```bash
ssh -i "$key_file" -p "$port" "$user@$host" \
  "sudo /usr/local/sbin/deploy-datavest '/opt/datavest/incoming/$archive' '$GITHUB_SHA'"
```

Delete the temporary key in an `always()` cleanup step. Do not disable host-key checking and do not use password authentication.

- [ ] **Step 5: Run local and Linux configuration checks**

Run the contract locally, then verify the installed site on the VPS or a disposable Ubuntu Nginx fixture:

```bash
npx vitest run scripts/release/nginx-deploy-contract.test.mjs
sudo install -m 0644 deploy/linux/nginx/datavest.conf /etc/nginx/sites-available/datavest.conf
sudo ln -sfn /etc/nginx/sites-available/datavest.conf /etc/nginx/sites-enabled/datavest.conf
sudo nginx -t
```

Expected: contract PASS; the complete installed Nginx configuration passes syntax validation.

- [ ] **Step 6: Commit edge and delivery configuration**

```bash
git add deploy/linux/nginx/datavest.conf .github/workflows/build-production-artifact.yml scripts/release/nginx-deploy-contract.test.mjs docs/operations/deployment-runbook.md
git commit -m "ci: deliver DataVest releases to production"
```

---

### Task 6: Encrypted PostgreSQL backup and restore drill

**Files:**
- Create: `deploy/linux/backup-postgres.py`
- Create: `deploy/linux/systemd/datavest-postgres-backup.service`
- Create: `deploy/linux/systemd/datavest-postgres-backup.timer`
- Create: `quant-worker/tests/test_backup_postgres.py`
- Modify: `scripts/release/deployment-config-contract.test.mjs`
- Modify: `docs/operations/deployment-runbook.md`

**Interfaces:**
- Produces CLI: `backup-postgres.py create --env-file /opt/datavest/shared/.env`.
- Produces restore drill: `backup-postgres.py restore-drill --env-file /opt/datavest/shared/.env --locator <s3-locator>`.
- Produces private keys: `operations/backups/postgres/<yyyy>/<mm>/<timestamp>.dump.enc`.
- Consumes: `DATABASE_URL`, `DATAVEST_BACKUP_ENCRYPTION_SECRET`, and `DATAVEST_S3_*` settings.

- [ ] **Step 1: Write failing backup safety tests**

Inject subprocess and S3 fakes. Assert `create_backup` invokes `pg_dump --format=custom` without `shell=True`, encrypts with `openssl enc -aes-256-cbc -pbkdf2 -salt`, uploads by `put_object`, verifies SHA metadata, and removes plaintext in `finally`. Assert missing/blank encryption secret fails before `pg_dump`.

```python
with pytest.raises(ValueError, match="DATAVEST_BACKUP_ENCRYPTION_SECRET"):
    create_backup(env_without_encryption_secret, runner, s3)
assert runner.calls == []
assert s3.put_calls == []
```

- [ ] **Step 2: Run backup tests and verify RED**

Run: `npm run test:python -- quant-worker/tests/test_backup_postgres.py -q`

Expected: FAIL because the backup utility is absent.

- [ ] **Step 3: Implement encrypted create flow**

Use a root-owned temporary directory under `/opt/datavest/shared/spool/backups`, mode `0700`. Run `pg_dump` with an argument array and a process environment containing the parsed database URL. Encrypt to a second temporary file with the passphrase supplied only through the child process environment. Upload the encrypted file with `put_object`, `ContentType=application/octet-stream`, and metadata containing the encrypted-file SHA-256 and database name. Verify `head_object` length and checksum metadata before deleting local files.

Never log the database URL, encryption secret, child environment, or object contents. If upload/verification fails, keep only the encrypted file for bounded retry and delete plaintext immediately.

- [ ] **Step 4: Implement an isolated restore drill**

Require the destination database name to be exactly `datavest_restore_test`. Download and verify the encrypted object, decrypt locally, create the test database from the local postgres administrator socket, and run `pg_restore --exit-on-error --no-owner --dbname datavest_restore_test`. Verify `_prisma_migrations` exists and at least one application table is readable. Drop only `datavest_restore_test` in `finally`, after confirming the exact name.

- [ ] **Step 5: Add the disabled-by-default timer**

Schedule daily at `04:45 Asia/Bangkok` with `Persistent=true` and randomized delay. Do not enable the timer during provisioning. Enable it only after `DATAVEST_BACKUP_ENCRYPTION_SECRET` is independently generated, one create succeeds, and the restore drill passes.

- [ ] **Step 6: Run unit and Linux configuration checks**

Run:

```bash
npm run test:python -- quant-worker/tests/test_backup_postgres.py -q
systemd-analyze verify deploy/linux/systemd/datavest-postgres-backup.service deploy/linux/systemd/datavest-postgres-backup.timer
npx vitest run scripts/release/deployment-config-contract.test.mjs
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit backup tooling**

```bash
git add deploy/linux/backup-postgres.py deploy/linux/systemd/datavest-postgres-backup.service deploy/linux/systemd/datavest-postgres-backup.timer quant-worker/tests/test_backup_postgres.py scripts/release/deployment-config-contract.test.mjs docs/operations/deployment-runbook.md
git commit -m "ops: add encrypted DataVest database backups"
```

---

### Task 7: Shared-host production cutover and acceptance

**Files:**
- Create: `docs/verification/datavest-production-release.md`
- Modify: `docs/operations/deployment-runbook.md` only if live evidence reveals a missing command.

**Interfaces:**
- Produces: live `https://datavest.vn` deployment and an evidence record containing no secrets.
- Consumes: approved DNS, GitHub environment secrets, the provisioning/deploy scripts, and the private S3 bucket.

- [ ] **Step 1: Record a fresh read-only preflight**

Capture timestamped outputs for `df -h`, `free -h`, `ss -ltnp`, existing `systemctl --failed`, PM2 status, active Nginx sites, PostgreSQL database sizes, and DataVest DNS. Record only secret-key presence, never values.

- [ ] **Step 2: Audit the public PostgreSQL listener**

Inspect `ss`, `SHOW listen_addresses`, `pg_hba_file_rules`, firewall rules, and recent PostgreSQL logs for remote source IPs. If no approved remote consumer exists, bind/firewall port 5432 to local/private access. If a consumer exists, restrict it to its explicit source IP and role/database. Immediately verify Radar BDS and La So Tinh Hoa database-backed pages after any change.

- [ ] **Step 3: Provision without starting services**

Run the provisioning script with the verified Tử Vi and Radar BDS env paths. Confirm owner/mode of `/opt/datavest/shared/.env`, verify required key presence with a script that prints booleans only, and confirm `current` is absent before first deployment.

- [ ] **Step 4: Configure DNS, Nginx, and TLS**

Point apex and `www` A records to the VPS, install and test the Nginx site, then run Certbot for both names. Verify certificate dates, automated renewal timer, apex HTTPS, and permanent `www` redirect without changing other virtual hosts.

- [ ] **Step 5: Configure GitHub deployment secrets**

Create a dedicated SSH key and deploy account. Store host, port, username, private key, and exact known-host entry in the protected GitHub `production` environment. Require manual approval for that environment during the first releases.

- [ ] **Step 6: Trigger and verify the first deployment**

Dispatch the workflow for the intended SHA. Record workflow run URL, artifact checksum, deployed SHA, `current` target, Prisma migration status, systemd unit states, loopback health, public health, disk delta, and memory peaks. Confirm the VPS performed no application build or online dependency resolution.

- [ ] **Step 7: Verify private S3 end to end**

Run the credential-safe smoke utility. Run one bounded Smart Insights collector, query the resulting `InsightRawSnapshot.storageLocator`, read it through `S3ArtifactStore`, and verify anonymous access is denied. Remove only the smoke object; retain the real evidence object.

- [ ] **Step 8: Verify authenticated product behavior**

Use a real browser at desktop and mobile widths. Verify sign-in, dashboard load, Smart Insights data-backed content, one Quant Lab read path, no broken logo/assets, and no application console errors. Distinguish analytics/CSP noise from DataVest failures.

- [ ] **Step 9: Perform a controlled rollback drill**

Deploy a release whose test-only health gate is configured to fail before public cutover, or invoke the deploy script's unprivileged simulation mode. Confirm `current` returns to the prior SHA, services recover, HTTPS remains available, and the failed release does not become active.

- [ ] **Step 10: Enable timers incrementally**

Enable worker first, then market ingestion, then Smart Insights timers one at a time. After each, inspect peak memory, swap, job duration, last-success state, and Radar BDS health. Stop and reschedule any job that causes sustained swap growth or overlaps Radar browser crawling.

- [ ] **Step 11: Commit the sanitized evidence record**

```bash
git add docs/verification/datavest-production-release.md docs/operations/deployment-runbook.md
git commit -m "docs: record DataVest production verification"
```

The evidence document includes statuses, timestamps, URLs, SHA values, checksums, counts, and redacted operational output only. It must not include IP passwords, private keys, database URLs, API keys, cookies, tokens, or env-file contents.

---

### Task 8: Final release gate and repository integration

**Files:**
- Modify only files from Tasks 1-6 if verification exposes a defect.

**Interfaces:**
- Produces: a pushed branch/merged main SHA matching the production evidence.

- [ ] **Step 1: Run the complete repository gate**

Run:

```bash
npm run check
npm run test:integration
npm run build
```

Run Linux-only checks in GitHub Actions:

```bash
bash -n deploy/linux/*.sh
systemd-analyze verify deploy/linux/systemd/*.service deploy/linux/systemd/*.timer
python -c "import pathlib, yaml; yaml.safe_load(pathlib.Path('.github/workflows/build-production-artifact.yml').read_text())"
```

Expected: every command exits 0. Integration tests use only the isolated local test database defined by the repository safety script.

- [ ] **Step 2: Review scope and secrets**

Run:

```bash
git diff main...HEAD --check
git status --short
git log --oneline main..HEAD
git grep -nE 'BEGIN (RSA|OPENSSH) PRIVATE KEY|DEEPSEEK_API_KEY=.+|DATAVEST_S3_SECRET_ACCESS_KEY=.+' main..HEAD
```

Expected: clean status, intentional commits only, and no secret value match.

- [ ] **Step 3: Push and integrate intentionally**

Push `codex/datavest-vps-deployment`, review the exact commit range, merge locally into `main` only when all gates and production-sensitive review pass, then push `main`. Record pushed SHA separately from deployed SHA and repeat public/authenticated health verification if the merge commit changes the SHA.
