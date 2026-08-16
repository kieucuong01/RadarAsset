# DataVest Release Artifact and CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a tested Linux release artifact containing the Next.js standalone server, Python application source, pinned Python wheels, Prisma migration material, and verifiable release metadata without building on the VPS.

**Architecture:** Keep build and dependency resolution in GitHub Actions. Add explicit liveness/readiness routes, then use a small Node release builder to assemble only runtime files under `dist/release`. A manually triggered workflow verifies the repository, builds the release, creates the wheelhouse, checksums the payload, and publishes a GitHub Actions artifact for the later deployment plan.

**Tech Stack:** Next.js 16 standalone output, React 19, TypeScript, Prisma 7, Node.js 24, Python 3.12, npm, pip wheel, Vitest, pytest, GitHub Actions, tar, SHA-256.

## Global Constraints

- The VPS must not run `next build`, compile Python dependencies, or resolve packages online during a normal deployment.
- The release must not contain `.env*`, credentials, `.git`, tests, browser binaries, local datasets, caches, or full development `node_modules`.
- Next.js runtime output must include `.next/standalone`, `.next/static`, and `public` in the paths expected by `server.js`.
- Release metadata must include the full Git SHA, UTC build time, requirements hash, lockfile hash, and checksums.
- Use Node.js 24 and Python 3.12 on the Linux builder.
- Do not add a container runtime or registry.
- Every health response must be `Cache-Control: no-store` and must not expose secret values or database errors.

---

### Task 1: Production standalone output and health boundaries

**Files:**
- Modify: `next.config.ts`
- Create: `src/app/api/health/live/route.ts`
- Create: `src/app/api/health/live/route.test.ts`
- Create: `src/app/api/health/ready/route.ts`
- Create: `src/app/api/health/ready/route.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `GET /api/health/live` returning `{ status: "ok", service: "datavest-web", release: string }` with HTTP 200.
- Produces: `GET /api/health/ready` returning the same public shape with HTTP 200 after `SELECT 1`, or `{ status: "unavailable", service: "datavest-web", release: string }` with HTTP 503.
- Consumes: `getPrisma()` from `src/lib/db/prisma.ts` and `DATAVEST_RELEASE_SHA` from the server environment.

- [ ] **Step 1: Write failing route tests**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();
vi.mock("@/lib/db/prisma", () => ({
  getPrisma: () => ({ $queryRaw: queryRaw }),
}));

describe("production health routes", () => {
  beforeEach(() => {
    queryRaw.mockReset();
    process.env.DATAVEST_RELEASE_SHA = "abc123";
  });

  it("reports process liveness without touching the database", async () => {
    const { GET } = await import("./live/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "datavest-web",
      release: "abc123",
    });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("returns 503 without leaking the readiness error", async () => {
    queryRaw.mockRejectedValueOnce(new Error("postgresql://secret"));
    const { GET } = await import("./ready/route");
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run src/app/api/health/live/route.test.ts src/app/api/health/ready/route.test.ts`

Expected: FAIL because both route modules are absent.

- [ ] **Step 3: Enable standalone mode and implement both routes**

Add `output: "standalone"` to `nextConfig`. Implement liveness as a pure response. Implement readiness with a bounded database probe:

```ts
import { getPrisma } from "@/lib/db/prisma";

const headers = { "Cache-Control": "no-store" };
const release = () => process.env.DATAVEST_RELEASE_SHA ?? "unknown";

export async function GET() {
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    return Response.json(
      { status: "ok", service: "datavest-web", release: release() },
      { headers },
    );
  } catch {
    return Response.json(
      { status: "unavailable", service: "datavest-web", release: release() },
      { status: 503, headers },
    );
  }
}
```

The liveness route uses the same response shape without importing Prisma. Add `DATAVEST_RELEASE_SHA=development` to `.env.example`.

- [ ] **Step 4: Run focused tests and type checking**

Run: `npx vitest run src/app/api/health/live/route.test.ts src/app/api/health/ready/route.test.ts && npm run typecheck`

Expected: both route tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit the health slice**

```bash
git add next.config.ts .env.example src/app/api/health/live src/app/api/health/ready
git commit -m "feat: add production health endpoints"
```

---

### Task 2: Deterministic release manifest and runtime assembler

**Files:**
- Create: `scripts/release/release-manifest.mjs`
- Create: `scripts/release/release-manifest.test.mjs`
- Create: `scripts/release/build-release.mjs`
- Create: `scripts/release/build-release.test.mjs`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `sha256File(path): Promise<string>`.
- Produces: `createReleaseMetadata({ root, gitSha, builtAt, requirementsHash, lockfileHash }): Promise<ReleaseMetadata>`.
- Produces: `validateGitSha(value): string` accepting exactly 40 lowercase hexadecimal characters.
- Produces: `assembleRelease({ repoRoot, outputRoot, metadata }): Promise<void>`.
- Produces npm script: `release:assemble` running `node scripts/release/build-release.mjs`.

- [ ] **Step 1: Write failing manifest security tests**

```js
import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createReleaseMetadata,
  sha256File,
  validateGitSha,
} from "./release-manifest.mjs";

it("rejects non-canonical release SHAs", () => {
  expect(() => validateGitSha("main")).toThrow("40 lowercase");
  expect(() => validateGitSha("a".repeat(40) + "../")).toThrow("40 lowercase");
});

it("hashes every regular payload file using normalized relative paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "datavest-release-"));
  await writeFile(path.join(root, "server.js"), "ok\n");
  const metadata = await createReleaseMetadata({
    root,
    gitSha: "a".repeat(40),
    builtAt: "2026-08-16T00:00:00.000Z",
    requirementsHash: "b".repeat(64),
    lockfileHash: "c".repeat(64),
  });
  expect(metadata.files).toEqual([
    { path: "server.js", sha256: await sha256File(path.join(root, "server.js")) },
  ]);
});
```

- [ ] **Step 2: Run manifest tests and verify RED**

Run: `npx vitest run scripts/release/release-manifest.test.mjs scripts/release/build-release.test.mjs`

Expected: FAIL because the release modules do not exist.

- [ ] **Step 3: Implement canonical hashing and metadata**

Use `createHash("sha256")`, `createReadStream`, `readdir({ recursive: true, withFileTypes: true })`, `relative`, and `path.posix`. Reject symlinks, paths containing `..`, absolute paths, and files named `.env` or beginning `.env.`. Sort files by normalized relative path before serializing:

```js
export function validateGitSha(value) {
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw new Error("Release Git SHA must contain 40 lowercase hexadecimal characters.");
  }
  return value;
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}
```

Write metadata to `release.json` only after payload enumeration; write a separate `manifest.sha256` that also covers `release.json`.

- [ ] **Step 4: Implement the allow-listed assembler**

`assembleRelease` must delete only the caller-supplied `outputRoot` after verifying that its basename is `release` and its parent basename is `dist`. Copy these allow-listed inputs:

```text
.next/standalone/**                 -> web/**
.next/static/**                     -> web/.next/static/**
public/**                           -> web/public/**
quant-worker/**/*.py                -> quant-worker/**
quant-worker/requirements.txt       -> quant-worker/requirements.txt
prisma/schema.prisma                -> prisma/schema.prisma
prisma/migrations/**                -> prisma/migrations/**
deploy/linux/**                      -> deploy/linux/**
dist/wheelhouse/**                  -> wheelhouse/**
dist/migration-tooling/**           -> migration-tooling/**
```

Do not copy `.pytest_cache`, `__pycache__`, `.local-data`, test directories, `.env*`, the repository's development `node_modules`, Playwright browsers, or generated logs. The allow-listed `dist/migration-tooling/node_modules` is the only Node dependency directory copied outside Next.js standalone output.

- [ ] **Step 5: Test traversal, secret exclusion, and required-file failure**

Add cases that create a miniature fake repository and assert:

```js
await expect(assembleRelease({ repoRoot, outputRoot, metadata })).rejects.toThrow(
  "standalone server.js is required",
);
expect(await pathExists(path.join(outputRoot, ".env.local"))).toBe(false);
expect(await pathExists(path.join(outputRoot, "quant-worker", "tests"))).toBe(false);
```

Then run: `npx vitest run scripts/release/release-manifest.test.mjs scripts/release/build-release.test.mjs`

Expected: PASS.

- [ ] **Step 6: Add scripts and ignore generated output**

Add these package scripts:

```json
{
  "release:assemble": "node scripts/release/build-release.mjs",
  "release:test": "vitest run scripts/release/release-manifest.test.mjs scripts/release/build-release.test.mjs"
}
```

Add `/dist/` to `.gitignore`.

- [ ] **Step 7: Commit the release builder**

```bash
git add .gitignore package.json scripts/release
git commit -m "build: assemble minimal production release"
```

---

### Task 3: Linux artifact workflow

**Files:**
- Create: `.github/workflows/build-production-artifact.yml`
- Create: `docs/operations/production-build.md`
- Create: `scripts/release/workflow-contract.test.mjs`

**Interfaces:**
- Produces workflow artifact: `datavest-release-<full-sha>` containing `datavest-release-<short-sha>.tar.gz` and its `.sha256` file.
- Consumes: repository code only; no production application secret is available to the build job.
- Produces: 14-day GitHub Actions artifact retention.

- [ ] **Step 1: Write the failing workflow contract test**

Read the workflow as text and assert all security and build gates:

```js
expect(workflow).toContain("workflow_dispatch:");
expect(workflow).toContain("permissions:\n  contents: read");
expect(workflow).toContain("node-version: '24'");
expect(workflow).toContain("python-version: '3.12'");
expect(workflow).toContain("npm ci");
expect(workflow).toContain("npm run check");
expect(workflow).toContain("npm run build");
expect(workflow).toContain("pip wheel");
expect(workflow).toContain("npm run release:assemble");
expect(workflow).not.toMatch(/DEEPSEEK|DATABASE_URL|S3_SECRET/i);
```

- [ ] **Step 2: Run the workflow contract and verify RED**

Run: `npx vitest run scripts/release/workflow-contract.test.mjs`

Expected: FAIL because the workflow is absent.

- [ ] **Step 3: Implement the build workflow**

Use pinned major official actions and a concurrency group that does not cancel an active build:

```yaml
name: Build production artifact
on:
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: datavest-production-artifact
  cancel-in-progress: false
```

The Linux job must run, in order:

```bash
npm ci
python -m pip install -r quant-worker/requirements.txt
npm run check
npm run build
python -m pip wheel --wheel-dir dist/wheelhouse -r quant-worker/requirements.txt
PRISMA_VERSION="$(node -p \"require('./node_modules/prisma/package.json').version\")"
npm install --prefix dist/migration-tooling --package-lock=false --no-audit --no-fund "prisma@${PRISMA_VERSION}"
node dist/migration-tooling/node_modules/prisma/build/index.js --version
GIT_SHA="$GITHUB_SHA" BUILD_TIME="$(date -u +%FT%TZ)" npm run release:assemble
tar -C dist -czf "datavest-release-${GITHUB_SHA::12}.tar.gz" release
sha256sum "datavest-release-${GITHUB_SHA::12}.tar.gz" > "datavest-release-${GITHUB_SHA::12}.tar.gz.sha256"
```

Upload only the archive and checksum with `retention-days: 14`. Add workflow path filters only after the first production deployment; the initial manual workflow always builds the selected SHA.

- [ ] **Step 4: Document artifact evidence**

In `docs/operations/production-build.md`, record the workflow input, output names, required job gates, how to download and verify an artifact, and the rule that a successful artifact build is not production-deployment evidence.

- [ ] **Step 5: Run workflow contract and YAML parse check**

Run: `npx vitest run scripts/release/workflow-contract.test.mjs`

Run on Linux CI: `python -c "import pathlib, yaml; yaml.safe_load(pathlib.Path('.github/workflows/build-production-artifact.yml').read_text())"`

Expected: contract PASS and YAML parses successfully.

- [ ] **Step 6: Commit the build workflow**

```bash
git add .github/workflows/build-production-artifact.yml docs/operations/production-build.md scripts/release/workflow-contract.test.mjs
git commit -m "ci: build DataVest production artifacts"
```

---

### Task 4: Release-build verification gate

**Files:**
- Modify only files from Tasks 1-3 if verification finds an issue.

**Interfaces:**
- Produces: a locally verified repository and a GitHub Linux workflow capable of creating the runtime artifact.

- [ ] **Step 1: Run repository gates**

Run:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:python
npm run build
```

Expected: every command exits 0.

- [ ] **Step 2: Inspect the standalone payload**

Run the standalone check locally:

```bash
test -f .next/standalone/server.js
test -d .next/static
```

Run the complete assembler check in the Linux artifact job after wheelhouse and migration-tooling creation:

```bash
GIT_SHA="$(git rev-parse HEAD)" BUILD_TIME="$(date -u +%FT%TZ)" npm run release:assemble
find dist/release -type f -print | sort
```

Expected: runtime, Prisma, Python, wheelhouse, and manifest files are present; no `.env`, test directory, cache, or development `node_modules` is listed.

- [ ] **Step 3: Verify clean Git scope**

Run: `git status --short && git diff --check`

Expected: no uncommitted changes and no whitespace errors.
