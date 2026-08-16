import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

function parseUnit(source) {
  const sections = {};
  let current;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const section = line.match(/^\[([^\]]+)]$/);
    if (section) {
      current = sections[section[1]] ??= {};
      continue;
    }
    if (!current || !line.includes("=")) throw new Error(`Invalid unit line: ${line}`);
    const [name, ...valueParts] = line.split("=");
    const value = valueParts.join("=");
    const existing = current[name];
    current[name] =
      existing === undefined
        ? value
        : [...(Array.isArray(existing) ? existing : [existing]), value];
  }
  return sections;
}

function values(value) {
  return Array.isArray(value) ? value : [value];
}

describe("DataVest production service configuration", () => {
  it("runs the standalone web server on loopback with a bounded hardened service", async () => {
    const unit = parseUnit(await read("deploy/linux/systemd/datavest-web.service"));

    expect(unit.Service).toMatchObject({
      User: "datavest",
      Group: "datavest",
      WorkingDirectory: "/opt/datavest/current/web",
      ExecStart: "/usr/bin/node /opt/datavest/current/web/server.js",
      MemoryMax: "600M",
      NoNewPrivileges: "true",
      PrivateTmp: "true",
      ProtectSystem: "strict",
      ProtectHome: "true",
      UMask: "0027",
      Restart: "on-failure",
    });
    expect(values(unit.Service.Environment)).toEqual([
      "NODE_ENV=production",
      "PORT=4200",
      "HOSTNAME=127.0.0.1",
    ]);
    expect(values(unit.Service.EnvironmentFile)).toEqual([
      "/opt/datavest/shared/.env",
      "-/opt/datavest/shared/release.env",
    ]);
    expect(unit.Service.RuntimeDirectory).toBeUndefined();
  });

  it("exposes only the scheduled-job allowlist and fixed commands", () => {
    const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
    const runner = fileURLToPath(new URL("deploy/linux/run-scheduled-job.sh", root));
    const listed = spawnSync(bash, [runner, "--list"], { encoding: "utf8" });
    expect(listed.status, listed.stderr).toBe(0);
    expect(listed.stdout.trim().split(/\r?\n/)).toEqual([
      "market-daily",
      "smart-four-hourly",
      "smart-daily",
      "smart-weekly",
      "calendar-current",
      "calendar-next",
      "briefing",
    ]);

    const command = spawnSync(bash, [runner, "--print-command", "market-daily"], {
      encoding: "utf8",
    });
    expect(command.status, command.stderr).toBe(0);
    expect(command.stdout.trim()).toBe(
      "/opt/datavest/shared/python-venv/bin/python /opt/datavest/current/quant-worker/ingest_market_data.py daily --env-file /opt/datavest/shared/.env",
    );

    const fourHourly = spawnSync(bash, [runner, "--print-command", "smart-four-hourly"], {
      encoding: "utf8",
    });
    expect(fourHourly.status, fourHourly.stderr).toBe(0);
    expect(fourHourly.stdout.trim().split(/\r?\n/)).toEqual([
      "/opt/datavest/shared/python-venv/bin/python /opt/datavest/current/quant-worker/collect_smart_insights.py daily --source coinglass-margin-borrow --env-file /opt/datavest/shared/.env",
      "/opt/datavest/shared/python-venv/bin/python /opt/datavest/current/quant-worker/collect_smart_insights.py daily --source coinglass-liquidation-maxpain --env-file /opt/datavest/shared/.env",
    ]);

    const invalid = spawnSync(bash, [runner, "not-a-job"], { encoding: "utf8" });
    expect(invalid.status).toBe(2);
    expect(invalid.stderr.trim()).toBe("scheduled_job=invalid");
  });

  it("serializes bounded timer jobs on explicit Bangkok schedules", async () => {
    const service = parseUnit(await read("deploy/linux/systemd/datavest-job@.service"));
    const provision = await read("deploy/linux/provision-datavest.sh");
    expect(service.Service).toMatchObject({
      User: "datavest",
      Group: "datavest",
      Environment: "HOME=/opt/datavest/shared/spool/browser-home",
      ExecStart: "/usr/local/libexec/datavest/run-scheduled-job %i",
      TimeoutStartSec: "45min",
      MemoryMax: "900M",
      Nice: "10",
      IOSchedulingClass: "best-effort",
    });
    expect(provision).toContain(
      "install -d -o datavest -g datavest -m 0700 /opt/datavest/shared/spool/browser-home",
    );

    const expected = {
      "datavest-market-daily.timer": [
        "*-*-* 01:15:00 Asia/Bangkok",
        "datavest-job@market-daily.service",
      ],
      "datavest-smart-four-hourly.timer": [
        "*-*-* 00,04,08,12,16,20:20:00 Asia/Bangkok",
        "datavest-job@smart-four-hourly.service",
      ],
      "datavest-smart-daily.timer": [
        "*-*-* 02:30:00 Asia/Bangkok",
        "datavest-job@smart-daily.service",
      ],
      "datavest-smart-weekly.timer": [
        "Mon *-*-* 03:30:00 Asia/Bangkok",
        "datavest-job@smart-weekly.service",
      ],
      "datavest-calendar-current.timer": [
        "*-*-* 00,02,04,06,08,10,12,14,16,18,20,22:10:00 Asia/Bangkok",
        "datavest-job@calendar-current.service",
      ],
      "datavest-calendar-next.timer": [
        "*-*-* 00:45:00 Asia/Bangkok",
        "datavest-job@calendar-next.service",
      ],
      "datavest-briefing.timer": ["*-*-* 06:15:00 Asia/Bangkok", "datavest-job@briefing.service"],
    };
    for (const [file, [calendar, target]] of Object.entries(expected)) {
      const timer = parseUnit(await read(`deploy/linux/systemd/${file}`));
      expect(timer.Timer).toMatchObject({
        OnCalendar: calendar,
        Unit: target,
        Persistent: "true",
        RandomizedDelaySec: "10m",
      });
    }
  });

  it("runs the quant API and worker from the shared offline Python environment", async () => {
    const engine = parseUnit(await read("deploy/linux/systemd/datavest-quant-engine.service"));
    const worker = parseUnit(await read("deploy/linux/systemd/datavest-worker.service"));

    expect(engine.Service.ExecStart).toBe(
      "/opt/datavest/shared/python-venv/bin/python -m uvicorn service:app --app-dir /opt/datavest/current/quant-worker --host 127.0.0.1 --port 8200",
    );
    expect(engine.Service.MemoryMax).toBe("850M");
    expect(worker.Service.ExecStart).toBe(
      "/opt/datavest/shared/python-venv/bin/python /opt/datavest/current/quant-worker/process_ingestion_requests.py --watch --limit 20 --env-file /opt/datavest/shared/.env",
    );
    expect(worker.Service.MemoryMax).toBe("750M");
    for (const unit of [engine, worker]) {
      expect(unit.Service).toMatchObject({
        User: "datavest",
        Group: "datavest",
        NoNewPrivileges: "true",
        PrivateTmp: "true",
        ProtectSystem: "strict",
        ProtectHome: "true",
        UMask: "0027",
      });
      expect(values(unit.Service.EnvironmentFile)).toEqual([
        "/opt/datavest/shared/.env",
        "-/opt/datavest/shared/release.env",
      ]);
      expect(unit.Service.RuntimeDirectory).toBeUndefined();
    }
  });

  it("documents every required production setting without a secret value", async () => {
    const source = await read("deploy/linux/env.production.example");
    const entries = Object.fromEntries(
      source
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );

    expect(entries).toMatchObject({
      NODE_ENV: "production",
      NEXT_PUBLIC_SITE_URL: "https://datavest.vn",
      BETTER_AUTH_URL: "https://datavest.vn",
      QUANT_ENGINE_URL: "http://127.0.0.1:8200",
      SMART_INSIGHTS_ARTIFACT_BACKEND: "s3",
      SMART_INSIGHTS_ARTIFACT_SPOOL_ROOT: "/opt/datavest/shared/spool",
      DATAVEST_S3_BUCKET: "datavest",
      DATAVEST_S3_ARTIFACT_PREFIX: "smart-insights/raw",
      SMART_INSIGHTS_TIMEZONE: "Asia/Bangkok",
    });
    for (const name of [
      "BETTER_AUTH_SECRET",
      "DATABASE_URL",
      "QUANT_ENGINE_API_TOKEN",
      "QUANT_WORKER_API_TOKEN",
      "DATAVEST_S3_ACCESS_KEY_ID",
      "DATAVEST_S3_SECRET_ACCESS_KEY",
      "DEEPSEEK_API_KEY",
      "DATAVEST_BACKUP_ENCRYPTION_SECRET",
    ]) {
      expect(entries[name]).toBe("");
    }
  });

  it("keeps encrypted PostgreSQL backup scheduling disabled until a restore drill passes", async () => {
    const service = parseUnit(await read("deploy/linux/systemd/datavest-postgres-backup.service"));
    const timer = parseUnit(await read("deploy/linux/systemd/datavest-postgres-backup.timer"));
    expect(service.Service).toMatchObject({
      Type: "oneshot",
      User: "datavest",
      Group: "datavest",
      ExecStart:
        "/opt/datavest/shared/python-venv/bin/python /usr/local/libexec/datavest/backup-postgres.py create --env-file /opt/datavest/shared/.env",
      TimeoutStartSec: "30min",
      MemoryMax: "400M",
      ProtectSystem: "strict",
      NoNewPrivileges: "true",
    });
    expect(timer.Timer).toMatchObject({
      OnCalendar: "*-*-* 04:45:00 Asia/Bangkok",
      Unit: "datavest-postgres-backup.service",
      Persistent: "true",
      RandomizedDelaySec: "10m",
    });
    expect(timer.Install.WantedBy).toBe("timers.target");
  });
});
