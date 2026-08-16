import { readFile } from "node:fs/promises";

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
      EnvironmentFile: "/opt/datavest/shared/.env",
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
        EnvironmentFile: "/opt/datavest/shared/.env",
        NoNewPrivileges: "true",
        PrivateTmp: "true",
        ProtectSystem: "strict",
        ProtectHome: "true",
        UMask: "0027",
      });
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
});
