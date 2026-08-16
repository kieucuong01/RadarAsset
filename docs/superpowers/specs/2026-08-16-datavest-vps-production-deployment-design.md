# DataVest VPS Production Deployment

## Goal

Deploy DataVest to the existing VPS used by Radar BDS and La So Tinh Hoa without building the application on that constrained host. The release must be atomic, reversible, economical in VPS disk usage, and safe for the other applications already running there.

The production surface is `https://datavest.vn`. `https://www.datavest.vn` redirects permanently to the apex domain.

## Confirmed Environment and Constraints

- The VPS has 2 CPU cores, 3.8 GiB RAM, 4 GiB swap, and approximately 11 GiB free on its root filesystem at design time.
- Nginx and PostgreSQL are shared infrastructure. La So Tinh Hoa uses PM2; Radar BDS uses systemd. Those applications remain unchanged.
- DataVest consists of a Next.js application, a Python quant API, a queue worker, and scheduled collection/ingestion jobs.
- The private Vietnix S3 bucket is `datavest`.
- The Radar BDS S3 credentials have been live-tested against that bucket for list, put, head, and delete operations. The smoke object was removed after verification.
- DeepSeek configuration is already present in the La So Tinh Hoa production environment and may be copied server-side into DataVest's environment during one-time provisioning. Secret values must never pass through logs, Git, build artifacts, or generated documentation.

## Chosen Approach

GitHub Actions builds and verifies Linux artifacts. The VPS receives already-built artifacts and performs only bounded deployment work: checksum verification, extraction, database migration, atomic symlink switching, service restart, and health verification.

This is preferred over:

- building from source on the VPS, which competes with production workloads for memory, swap, CPU, and disk;
- Docker Compose, which would retain image layers and duplicate runtime content on a small shared host.

## Runtime Architecture

Nginx terminates TLS and proxies only the Next.js web service. All DataVest application ports bind to loopback.

- `datavest-web.service`: Next.js standalone server on `127.0.0.1:4200`.
- `datavest-quant-engine.service`: FastAPI/Uvicorn quant service on `127.0.0.1:8200`.
- `datavest-worker.service`: the durable ingestion/queue worker, initially with concurrency one.
- `datavest-*.timer`: scheduled collectors and maintenance jobs. Timer jobs use a shared lock so heavy collection tasks never overlap one another.
- Local PostgreSQL: a dedicated `datavest` database and least-privilege login role.
- Private S3: durable raw evidence and other large, reproducible artifacts.

The production environment sets `QUANT_ENGINE_URL=http://127.0.0.1:8200` and `NEXT_PUBLIC_SITE_URL=https://datavest.vn`.

## Filesystem Layout

```text
/opt/datavest/
  current -> releases/<release-id>
  previous -> releases/<previous-release-id>
  releases/
    <release-id>/
      web/
      quant-worker/
      prisma/
      manifest.sha256
  shared/
    .env
    python-venv/
    requirements.sha256
    migration-tooling/
    migration-tooling.sha256
    spool/
  incoming/
  logs/
```

`release-id` is `<UTC timestamp>-<short Git SHA>`. Releases are immutable after extraction. `current` and `previous` are the only mutable release pointers.

Retention rules:

- keep the active release and one rollback release;
- remove failed incoming archives immediately after diagnostics are captured;
- remove superseded migration tooling and Python wheel caches after a successful replacement;
- cap local artifact spool by age and size, and delete a spool file only after its S3 object has been verified;
- rely on journald rotation rather than unbounded application log files.

## Build Artifacts

The workflow runs on Linux compatible with the VPS and produces a checksummed release archive containing:

- Next.js standalone output, plus `.next/static` and `public` in the paths expected by the standalone server;
- generated Prisma client runtime required by the application;
- Prisma schema and migration files;
- Python source for the quant engine, worker, and collectors;
- a Python wheelhouse keyed by the requirements hash when Python dependencies changed;
- pinned migration tooling keyed by the lockfile and Prisma version;
- release metadata with full Git SHA, build timestamp, supported schema version, and file checksums.

The archive must not contain `.git`, source caches, test output, browser binaries, local datasets, `.env*`, credentials, or full development `node_modules`.

The shared Python virtual environment is rebuilt only when the requirements hash changes. Installation uses the shipped wheelhouse with `--no-index`, preventing compilation or dependency resolution on the VPS. Migration tooling is also shared and replaced only when its hash changes.

## Continuous Delivery Workflow

The production workflow is manually dispatchable initially. Automatic deployment on every push remains out of scope until the first releases establish stable resource usage.

The workflow performs these gates in order:

1. Install dependencies from lockfiles.
2. Run formatting, lint, TypeScript, Vitest, and Python test gates.
3. Generate Prisma client and build Next.js standalone output.
4. Build the Linux wheelhouse and migration tooling when their hashes are not already reusable.
5. Package the release and generate SHA-256 checksums.
6. Transfer the archive and manifest to `/opt/datavest/incoming/` over SSH.
7. Invoke one root-owned deployment entry point through a narrowly scoped sudo rule.

GitHub stores only deployment connection material: host, port, deploy username, and a dedicated SSH private key. Application, database, DeepSeek, authentication, and S3 secrets remain only on the VPS.

## Atomic Deployment Transaction

The VPS deployment entry point accepts an explicit release archive and expected Git SHA. It does not pull Git or run an online package install.

1. Acquire an exclusive deployment lock.
2. Confirm the archive path is under `/opt/datavest/incoming/` and the release destination is under `/opt/datavest/releases/`.
3. Verify every SHA-256 checksum before extraction.
4. Extract into a new release directory and reject an existing or incomplete release id.
5. Refresh shared Python or migration tooling only when its declared hash changed.
6. Run `prisma migrate deploy` with the production environment before switching traffic.
7. Run local preflight checks against the extracted release.
8. Point a temporary symlink at the new release and atomically replace `current`; retain the old target as `previous`.
9. Restart the quant engine and worker, then the web service. Scheduled timer units do not run during the deployment lock.
10. Verify the engine health endpoint, the web health endpoint on loopback, and the public HTTPS endpoint through Nginx.
11. On failure after the switch, atomically restore the previous symlink, restart services, and verify the previous release.
12. Prune releases only after the new release passes all checks.

Database migrations must be backward compatible with the immediately previous application release. Destructive column/table removal is a later migration after the rollback window, never part of the same release that stops using the data.

## S3 Artifact Storage

The existing filesystem `ArtifactStore` gains an S3 implementation selected by environment. Production uses S3; development and tests keep the filesystem implementation.

Initial S3 scope is Smart Insights raw snapshots and durable collector evidence. Existing quant-run JSON payloads remain in PostgreSQL until size measurements justify moving them; this avoids an unnecessary data-contract migration in the first release.

Object keys are deterministic and content-addressed:

```text
smart-insights/raw/<source>/<yyyy>/<mm>/<sha256>.json.gz
smart-insights/documents/<source>/<yyyy>/<mm>/<sha256>.<ext>
operations/backups/postgres/<yyyy>/<mm>/<timestamp>.dump.enc
```

Storage rules:

- use server-side credentials and private objects only;
- use single-request `PutObject` for the normal compressed artifact sizes supported by this application;
- upload compressed content with content type, content encoding, SHA-256 metadata, and source metadata where appropriate;
- write to a local temporary file, upload, then verify object metadata before committing the `s3://datavest/<key>` locator and removing the local file;
- identical content reuses the same key;
- reads fail closed with an explicit unavailable state; they never invent or silently substitute evidence;
- retries are bounded and exponential; application requests do not perform unbounded S3 retries;
- no browser receives S3 access credentials or a permanent public object URL.

Database backup upload is enabled only after a client-side encryption secret is provisioned separately from the S3 credentials and a restore drill succeeds. Until then, the deployment must not claim S3 database backup coverage.

## Secrets and Permissions

- Run services as a dedicated non-login `datavest` system user.
- Store production settings at `/opt/datavest/shared/.env`, owned by root and readable by the DataVest service group only.
- Copy only the required DeepSeek values from the existing server environment during provisioning; DataVest does not source another application's environment at runtime.
- Copy the required S3 connection values into DataVest-specific variable names. Do not make DataVest depend on the Radar BDS `.env` path at runtime.
- Generate independent database, Better Auth, and worker API secrets for DataVest.
- Use a deploy user with no interactive application secret access and sudo permission only for the fixed deployment command.
- Apply systemd hardening compatible with the runtimes, including `NoNewPrivileges`, a private temporary directory, an explicit writable-path allowlist, and a restrictive umask.

The currently exposed PostgreSQL listener must be audited before launch. If no approved remote consumer requires it, firewall access to port 5432 is closed. If a remote consumer exists, access is narrowed to explicit source IPs and PostgreSQL roles/databases. This shared-host change is verified against Radar BDS and La So Tinh Hoa before application.

## Resource Controls and Scheduling

All DataVest services receive systemd memory and restart limits. Initial caps are safety rails and are tuned from measured peak usage after the first 24 hours; a unit must fail visibly rather than drive the whole VPS into sustained swap pressure.

- Web and quant engine remain continuously available.
- Worker concurrency starts at one.
- Browser-backed or model-heavy collectors run one at a time.
- DataVest heavy collection windows are offset from Radar BDS crawling windows.
- Each scheduled job has a timeout, lock, bounded retry policy, and a recorded last-success timestamp.
- A pre-deploy disk gate requires enough space for the incoming archive, extracted release, rollback release, and a safety reserve. Failure stops before extraction or symlink changes.

## Nginx, DNS, and TLS

- DNS for `datavest.vn` and `www.datavest.vn` points to the VPS before certificate issuance.
- Nginx proxies the apex domain to `127.0.0.1:4200` and preserves the real client/proxy headers required by authentication.
- `www` redirects to the apex URL.
- Certbot provisions and renews the certificate without changing the existing virtual hosts.
- Security headers are introduced conservatively and verified against authentication, Next.js assets, and analytics before enforcement.
- Direct public access to ports 4200 and 8200 is prohibited.

## Health, Observability, and Operations

Required health surfaces:

- web liveness: process is serving HTTP;
- web readiness: critical configuration is present and the database is reachable;
- quant-engine liveness/readiness on loopback;
- worker heartbeat or last-success record;
- collector last-success, duration, and failure reason;
- S3 write/read status exposed only to authenticated operational tooling, never including credentials.

Deployment evidence is recorded independently:

- source SHA and GitHub workflow result;
- uploaded artifact checksum;
- active `current` symlink target;
- migration status;
- systemd unit state;
- loopback health responses;
- public HTTPS response and authenticated browser smoke test.

A successful SSH command or service restart alone is not considered a successful release.

## Failure Behavior

- Build or test failure: no VPS mutation.
- Transfer/checksum failure: delete only the invalid incoming artifact.
- Migration failure before switch: keep the current release running.
- New-service or public-health failure: roll back to `previous` and keep the failed release for bounded diagnostics.
- S3 unavailable: preserve the local spool within its quota, mark evidence unavailable/pending, and retry asynchronously.
- DeepSeek unavailable: preserve deterministic/quant results and show an explicit AI-unavailable state; do not generate substitute conclusions.
- Low disk or sustained memory pressure: skip non-critical scheduled jobs and alert; do not delete the active or rollback release.

## Verification and Acceptance Criteria

The first production release is accepted only when all of the following are demonstrated:

- CI tests and the Linux production build pass for the deployed SHA.
- The VPS does not run `next build`, compile Python dependencies, or resolve packages online during a normal deployment.
- The active symlink and running services report the same expected SHA.
- Local web and quant health endpoints pass.
- `https://datavest.vn` returns HTTPS 200 and `www` redirects to the apex.
- An authenticated desktop and mobile browser smoke test covers sign-in and one core data-backed investor workflow.
- A Smart Insights test artifact is stored privately in `datavest`, its locator is persisted, it can be read back, and no public anonymous read is possible.
- A deliberate failed-health deployment rolls back successfully in staging or a controlled production drill.
- Disk use before and after deployment is reported, only two releases remain, and other hosted services remain healthy.
- No secret value appears in Git history, workflow logs, artifact manifests, systemd unit files, or public responses.

## Non-goals

- Migrating Radar BDS or La So Tinh Hoa to the DataVest deployment model.
- Moving all PostgreSQL application payloads to S3 in the first release.
- Public S3 hosting or client-side bucket access.
- Kubernetes, a container registry, or a multi-host architecture.
- Automatic production deployment on every push before manual releases are stable.
- Claiming database backup protection before encrypted upload and restore have both been verified.
