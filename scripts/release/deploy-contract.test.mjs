import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readlink, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const bash = "C:\\Program Files\\Git\\bin\\bash.exe";
const runner = fileURLToPath(new URL("deploy/linux/deploy-datavest.sh", root));
const gitSha = "0123456789abcdef0123456789abcdef01234567";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function bashPath(value) {
  return value
    .replace(/^([A-Za-z]):\\/, (_match, drive) => `/${drive.toLowerCase()}/`)
    .replaceAll("\\", "/");
}

async function makeArchive({ traversal = false } = {}) {
  const testRoot = await mkdtemp(path.join(tmpdir(), "datavest-deploy-"));
  const incoming = path.join(testRoot, "incoming");
  const releases = path.join(testRoot, "releases");
  const payload = path.join(testRoot, "payload", "release");
  await Promise.all([
    mkdir(incoming, { recursive: true }),
    mkdir(releases, { recursive: true }),
    mkdir(payload, { recursive: true }),
  ]);

  const runtime = "safe runtime\n";
  const release = {
    schemaVersion: 1,
    gitSha,
    builtAt: "2026-08-16T00:00:00.000Z",
    requirementsHash: "a".repeat(64),
    lockfileHash: "b".repeat(64),
    migrationToolingHash: "c".repeat(64),
    files: [{ path: "runtime.txt", sha256: digest(runtime) }],
  };
  const releaseJson = `${JSON.stringify(release, null, 2)}\n`;
  await writeFile(path.join(payload, "runtime.txt"), runtime);
  await writeFile(path.join(payload, "release.json"), releaseJson);
  await writeFile(
    path.join(payload, "manifest.sha256"),
    `${digest(runtime)}  runtime.txt\n${digest(releaseJson)}  release.json\n`,
  );

  const archive = path.join(incoming, `datavest-release-${gitSha.slice(0, 12)}.tar.gz`);
  const tarArgs = ["-C", bashPath(path.dirname(payload)), "-czf", bashPath(archive)];
  if (traversal) tarArgs.push("--transform=s#release#../escape#");
  tarArgs.push("release");
  const tar = spawnSync(bash, ["-lc", 'exec tar "$@"', "bash", ...tarArgs], {
    encoding: "utf8",
  });
  expect(tar.status, tar.stderr).toBe(0);
  const archiveBytes = await readFile(archive);
  await writeFile(`${archive}.sha256`, `${digest(archiveBytes)}  ${path.basename(archive)}\n`);
  return { testRoot, archive };
}

function validate(testRoot, archive, sha = gitSha, availableKb = "99999999") {
  return spawnSync(bash, [runner, "--validate-only", bashPath(testRoot), bashPath(archive), sha], {
    encoding: "utf8",
    env: { ...process.env, DATAVEST_TEST_AVAILABLE_KB: availableKb },
  });
}

describe("DataVest atomic deploy", () => {
  it("has strict, offline, checksummed deployment and rollback contracts", async () => {
    const source = await readFile(runner, "utf8");
    expect(source).toContain("set -Eeuo pipefail");
    expect(source).toContain('[[ "${EUID}" -ne 0 ]]');
    expect(source).toContain("flock -n 9");
    expect(source).toContain("realpath --");
    expect(source).toContain("sha256sum -c");
    expect(source).toContain("prisma migrate deploy");
    expect(source).toContain("systemctl restart datavest-quant-engine.service");
    expect(source).toContain("systemctl restart datavest-web.service");
    expect(source).not.toMatch(/git\s+pull|npm\s+(ci|install)|pip\s+install\s+-r/);
    expect(source).not.toMatch(/rm\s+-rf\s+[^\"]*\*/);
    expect(source).not.toContain("eval ");
    expect(source).not.toContain("set -x");
  });

  it("validates a checksummed release without changing current", async () => {
    const fixture = await makeArchive();
    const result = validate(fixture.testRoot, fixture.archive);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("deploy_status=validated");
    await expect(readFile(path.join(fixture.testRoot, "current"))).rejects.toThrow();
  });

  it.each([
    ["wrong identity", false, "f".repeat(40), "99999999"],
    ["low disk", false, gitSha, "0"],
    ["path traversal", true, gitSha, "99999999"],
  ])("rejects %s before changing current", async (_name, traversal, sha, disk) => {
    const fixture = await makeArchive({ traversal });
    await symlink("sentinel-release", path.join(fixture.testRoot, "current"));
    const result = validate(fixture.testRoot, fixture.archive, sha, disk);
    expect(result.status).not.toBe(0);
    expect(await readlink(path.join(fixture.testRoot, "current"))).toBe("sentinel-release");
  });
});
