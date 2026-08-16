import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createReleaseMetadata, sha256File, validateGitSha } from "./release-manifest.mjs";

async function temporaryDirectory() {
  return mkdtemp(path.join(tmpdir(), "datavest-manifest-"));
}

describe("release manifest", () => {
  it("accepts only a canonical full Git SHA", () => {
    expect(validateGitSha("a".repeat(40))).toBe("a".repeat(40));
    for (const value of ["main", "A".repeat(40), "a".repeat(39), `${"a".repeat(40)}../`]) {
      expect(() => validateGitSha(value)).toThrow("40 lowercase");
    }
  });

  it("calculates the standard SHA-256 digest for file bytes", async () => {
    const root = await temporaryDirectory();
    const file = path.join(root, "hello.txt");
    await writeFile(file, "hello");

    await expect(sha256File(file)).resolves.toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("emits sorted normalized payload paths and exact release inputs", async () => {
    const root = await temporaryDirectory();
    await mkdir(path.join(root, "web"), { recursive: true });
    await writeFile(path.join(root, "z.txt"), "z");
    await writeFile(path.join(root, "web", "server.js"), "server");

    const metadata = await createReleaseMetadata({
      root,
      gitSha: "a".repeat(40),
      builtAt: "2026-08-16T00:00:00.000Z",
      requirementsHash: "b".repeat(64),
      lockfileHash: "c".repeat(64),
      migrationToolingHash: "d".repeat(64),
    });

    expect(metadata).toMatchObject({
      schemaVersion: 1,
      gitSha: "a".repeat(40),
      builtAt: "2026-08-16T00:00:00.000Z",
      requirementsHash: "b".repeat(64),
      lockfileHash: "c".repeat(64),
      migrationToolingHash: "d".repeat(64),
    });
    expect(metadata.files.map((file) => file.path)).toEqual(["web/server.js", "z.txt"]);
  });

  it("rejects secret-like files instead of publishing them", async () => {
    const root = await temporaryDirectory();
    await writeFile(path.join(root, ".env.production"), "SECRET=value\n");

    await expect(
      createReleaseMetadata({
        root,
        gitSha: "a".repeat(40),
        builtAt: "2026-08-16T00:00:00.000Z",
        requirementsHash: "b".repeat(64),
        lockfileHash: "c".repeat(64),
        migrationToolingHash: "d".repeat(64),
      }),
    ).rejects.toThrow("Environment files are not allowed");
  });

  it("rejects symbolic links from the release payload", async () => {
    const root = await temporaryDirectory();
    const outside = path.join(root, "outside.txt");
    await writeFile(outside, "outside");
    try {
      await symlink(outside, path.join(root, "linked.txt"));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EPERM") return;
      throw error;
    }

    await expect(
      createReleaseMetadata({
        root,
        gitSha: "a".repeat(40),
        builtAt: "2026-08-16T00:00:00.000Z",
        requirementsHash: "b".repeat(64),
        lockfileHash: "c".repeat(64),
        migrationToolingHash: "d".repeat(64),
      }),
    ).rejects.toThrow("Symbolic links are not allowed");
  });
});
