import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const FULL_GIT_SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function validateGitSha(value) {
  if (!FULL_GIT_SHA.test(value)) {
    throw new Error("Release Git SHA must contain 40 lowercase hexadecimal characters.");
  }
  return value;
}

function validateSha256(value, label) {
  if (!SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  return value;
}

function validateBuiltAt(value) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error("Release build time must be a canonical UTC ISO timestamp.");
  }
  return value;
}

function normalizedRelativePath(root, filePath) {
  const relative = path.relative(root, filePath);
  if (!relative || path.isAbsolute(relative) || relative.split(path.sep).includes("..")) {
    throw new Error("Release file must stay inside the release root.");
  }
  return relative.split(path.sep).join(path.posix.sep);
}

function assertAllowedFileName(relativePath) {
  const basename = path.posix.basename(relativePath);
  if (basename === ".env" || basename.startsWith(".env.")) {
    throw new Error("Environment files are not allowed in a release.");
  }
  if (relativePath.includes("\n") || relativePath.includes("\r")) {
    throw new Error("Release paths must not contain line breaks.");
  }
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function payloadFiles(root, directory = root) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    const relativePath = normalizedRelativePath(root, filePath);
    if (entry.isSymbolicLink()) throw new Error("Symbolic links are not allowed in a release.");
    if (entry.isDirectory()) {
      files.push(...(await payloadFiles(root, filePath)));
      continue;
    }
    if (!entry.isFile()) throw new Error(`Unsupported release entry: ${relativePath}`);
    if (relativePath === "release.json" || relativePath === "manifest.sha256") continue;
    assertAllowedFileName(relativePath);
    files.push({ path: relativePath, sha256: await sha256File(filePath) });
  }
  return files;
}

export async function createReleaseMetadata({
  root,
  gitSha,
  builtAt,
  requirementsHash,
  lockfileHash,
  migrationToolingHash,
}) {
  const resolvedRoot = path.resolve(root);
  const files = await payloadFiles(resolvedRoot);
  files.sort((left, right) => left.path.localeCompare(right.path, "en"));
  return {
    schemaVersion: 1,
    gitSha: validateGitSha(gitSha),
    builtAt: validateBuiltAt(builtAt),
    requirementsHash: validateSha256(requirementsHash, "Requirements hash"),
    lockfileHash: validateSha256(lockfileHash, "Lockfile hash"),
    migrationToolingHash: validateSha256(migrationToolingHash, "Migration tooling hash"),
    files,
  };
}

export async function writeReleaseManifest(root, metadata) {
  const releaseJson = `${JSON.stringify(metadata, null, 2)}\n`;
  const releaseJsonPath = path.join(root, "release.json");
  await writeFile(releaseJsonPath, releaseJson, { encoding: "utf8", flag: "wx" });
  const releaseHash = await sha256File(releaseJsonPath);
  const lines = [
    ...metadata.files.map((file) => `${file.sha256}  ${file.path}`),
    `${releaseHash}  release.json`,
  ];
  await writeFile(path.join(root, "manifest.sha256"), `${lines.join("\n")}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}
