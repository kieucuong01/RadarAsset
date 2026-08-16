import { createHash } from "node:crypto";
import { access, cp, lstat, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createReleaseMetadata,
  sha256File,
  validateGitSha,
  writeReleaseManifest,
} from "./release-manifest.mjs";

const SKIPPED_DIRECTORY_NAMES = new Set(["tests", "__pycache__", ".pytest_cache"]);

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function assertSafeOutputRoot(repoRoot, outputRoot) {
  const expected = path.resolve(repoRoot, "dist", "release");
  const actual = path.resolve(outputRoot);
  if (actual !== expected) {
    throw new Error("Release output must be the exact repository dist/release directory.");
  }
  return actual;
}

async function requireRegularFile(filePath, label) {
  let details;
  try {
    details = await lstat(filePath);
  } catch {
    throw new Error(`${label} is required.`);
  }
  if (!details.isFile() || details.isSymbolicLink()) throw new Error(`${label} is required.`);
}

async function copyTree(source, destination, { filter } = {}) {
  if (!(await pathExists(source))) return;
  await cp(source, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: async (entrySource) => {
      const relative = path.relative(source, entrySource);
      if (!relative) return true;
      const parts = relative.split(path.sep);
      if (parts.some((part) => SKIPPED_DIRECTORY_NAMES.has(part))) return false;
      if (parts.some((part) => part === ".env" || part.startsWith(".env."))) return false;
      const details = await lstat(entrySource);
      if (details.isSymbolicLink()) throw new Error("Symbolic links are not allowed in a release.");
      if (details.isDirectory()) return true;
      if (!details.isFile()) throw new Error("Unsupported release source entry.");
      if (entrySource.endsWith(".pyc")) return false;
      return filter ? filter(entrySource, relative) : true;
    },
  });
}

async function hashTree(root) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Symbolic links are not allowed in tooling.");
      if (entry.isDirectory()) await visit(filePath);
      else if (entry.isFile()) files.push(filePath);
      else throw new Error("Unsupported migration tooling entry.");
    }
  }
  await visit(root);
  files.sort((left, right) => left.localeCompare(right, "en"));
  const hash = createHash("sha256");
  for (const filePath of files) {
    hash.update(path.relative(root, filePath).split(path.sep).join("/"));
    hash.update("\0");
    hash.update(await sha256File(filePath));
    hash.update("\n");
  }
  return hash.digest("hex");
}

export async function assembleRelease({ repoRoot, outputRoot, gitSha, builtAt }) {
  const root = path.resolve(repoRoot);
  const output = assertSafeOutputRoot(root, outputRoot);
  const standaloneServer = path.join(root, ".next", "standalone", "server.js");
  await requireRegularFile(standaloneServer, "Next.js standalone server.js");
  await requireRegularFile(
    path.join(root, "quant-worker", "requirements.txt"),
    "Python requirements.txt",
  );
  await requireRegularFile(path.join(root, "package-lock.json"), "package-lock.json");
  await requireRegularFile(path.join(root, "prisma", "schema.prisma"), "Prisma schema");
  await requireRegularFile(
    path.join(root, "dist", "migration-tooling", "node_modules", "prisma", "build", "index.js"),
    "Offline Prisma migration tooling",
  );

  validateGitSha(gitSha);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });

  await copyTree(path.join(root, ".next", "standalone"), path.join(output, "web"));
  await copyTree(path.join(root, ".next", "static"), path.join(output, "web", ".next", "static"));
  await copyTree(path.join(root, "public"), path.join(output, "web", "public"));
  await copyTree(path.join(root, "quant-worker"), path.join(output, "quant-worker"), {
    filter: (source) => source.endsWith(".py") || source.endsWith("requirements.txt"),
  });
  await copyTree(path.join(root, "prisma"), path.join(output, "prisma"), {
    filter: (_source, relative) =>
      relative === "schema.prisma" || relative.split(path.sep)[0] === "migrations",
  });
  await copyTree(path.join(root, "deploy", "linux"), path.join(output, "deploy", "linux"));
  await copyTree(path.join(root, "dist", "wheelhouse"), path.join(output, "wheelhouse"));
  await copyTree(
    path.join(root, "dist", "migration-tooling"),
    path.join(output, "migration-tooling"),
  );

  const metadata = await createReleaseMetadata({
    root: output,
    gitSha,
    builtAt,
    requirementsHash: await sha256File(path.join(root, "quant-worker", "requirements.txt")),
    lockfileHash: await sha256File(path.join(root, "package-lock.json")),
    migrationToolingHash: await hashTree(path.join(root, "dist", "migration-tooling")),
  });
  await writeReleaseManifest(output, metadata);
  return metadata;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const metadata = await assembleRelease({
    repoRoot,
    outputRoot: path.join(repoRoot, "dist", "release"),
    gitSha: process.env.GIT_SHA ?? "",
    builtAt: process.env.BUILD_TIME ?? "",
  });
  process.stdout.write(`release_files=${metadata.files.length}\n`);
}
