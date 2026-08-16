import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { assembleRelease } from "./build-release.mjs";

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function write(root, relativePath, content = relativePath) {
  const target = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function fakeRepository() {
  const root = await mkdtemp(path.join(tmpdir(), "datavest-release-source-"));
  await write(root, ".next/standalone/server.js", "server");
  await write(root, ".next/standalone/node_modules/runtime/index.js", "runtime");
  await write(root, ".next/static/chunks/app.js", "chunk");
  await write(root, "public/logo.svg", "logo");
  await write(root, "quant-worker/service.py", "service");
  await write(root, "quant-worker/smart_insights/artifacts.py", "artifacts");
  await write(root, "quant-worker/tests/test_service.py", "test");
  await write(root, "quant-worker/__pycache__/service.pyc", "cache");
  await write(root, "quant-worker/requirements.txt", "fastapi==1\n");
  await write(root, "prisma/schema.prisma", "model User {}\n");
  await write(root, "prisma/migrations/001_init/migration.sql", "SELECT 1;\n");
  await write(root, "deploy/linux/provision-datavest.sh", "#!/bin/bash\n");
  await write(root, "dist/wheelhouse/runtime.whl", "wheel");
  await write(root, "dist/migration-tooling/node_modules/prisma/build/index.js", "prisma");
  await write(root, "package-lock.json", '{"lockfileVersion":3}\n');
  await write(root, ".env.local", "SECRET=value\n");
  await write(root, "node_modules/dev-only/index.js", "dev");
  return root;
}

describe("production release assembler", () => {
  it("copies only the allow-listed runtime payload and writes verifiable metadata", async () => {
    const repoRoot = await fakeRepository();
    const outputRoot = path.join(repoRoot, "dist", "release");

    await assembleRelease({
      repoRoot,
      outputRoot,
      gitSha: "a".repeat(40),
      builtAt: "2026-08-16T00:00:00.000Z",
    });

    for (const relativePath of [
      "web/server.js",
      "web/node_modules/runtime/index.js",
      "web/.next/static/chunks/app.js",
      "web/public/logo.svg",
      "quant-worker/service.py",
      "quant-worker/smart_insights/artifacts.py",
      "quant-worker/requirements.txt",
      "prisma/schema.prisma",
      "prisma/migrations/001_init/migration.sql",
      "deploy/linux/provision-datavest.sh",
      "wheelhouse/runtime.whl",
      "migration-tooling/node_modules/prisma/build/index.js",
      "release.json",
      "manifest.sha256",
    ]) {
      expect(await exists(path.join(outputRoot, ...relativePath.split("/")))).toBe(true);
    }

    for (const relativePath of [
      ".env.local",
      "node_modules/dev-only/index.js",
      "quant-worker/tests/test_service.py",
      "quant-worker/__pycache__/service.pyc",
    ]) {
      expect(await exists(path.join(outputRoot, ...relativePath.split("/")))).toBe(false);
    }

    const metadata = JSON.parse(await readFile(path.join(outputRoot, "release.json"), "utf8"));
    expect(metadata.gitSha).toBe("a".repeat(40));
    expect(metadata.files.some((file) => file.path === "web/server.js")).toBe(true);
  });

  it("fails before deleting output when the standalone server is missing", async () => {
    const repoRoot = await fakeRepository();
    const outputRoot = path.join(repoRoot, "dist", "release");
    await writeFile(path.join(outputRoot, "keep.txt"), "keep", { flag: "w" }).catch(async () => {
      await mkdir(outputRoot, { recursive: true });
      await writeFile(path.join(outputRoot, "keep.txt"), "keep");
    });
    await import("node:fs/promises").then(({ rm }) =>
      rm(path.join(repoRoot, ".next", "standalone", "server.js")),
    );

    await expect(
      assembleRelease({
        repoRoot,
        outputRoot,
        gitSha: "a".repeat(40),
        builtAt: "2026-08-16T00:00:00.000Z",
      }),
    ).rejects.toThrow("standalone server.js is required");
    await expect(readFile(path.join(outputRoot, "keep.txt"), "utf8")).resolves.toBe("keep");
  });

  it("rejects output paths outside an exact dist/release directory", async () => {
    const repoRoot = await fakeRepository();

    await expect(
      assembleRelease({
        repoRoot,
        outputRoot: path.join(repoRoot, "dist", "other"),
        gitSha: "a".repeat(40),
        builtAt: "2026-08-16T00:00:00.000Z",
      }),
    ).rejects.toThrow("dist/release");
  });
});
