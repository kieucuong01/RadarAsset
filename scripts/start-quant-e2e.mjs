import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnvFile } from "dotenv";

import { validateIntegrationDatabases } from "./database-safety.mjs";
import { resolveLocalEnvFile, resolvePythonExecutable } from "./dev-local.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fileEnv = {};
const envFile = resolveLocalEnvFile(repoRoot, existsSync);
if (envFile) loadEnvFile({ path: envFile, processEnv: fileEnv, quiet: true });
const developmentUrl = process.env.DATABASE_URL ?? fileEnv.DATABASE_URL;
function defaultTestUrl(value) {
  if (!value) return undefined;
  const parsed = new URL(value);
  parsed.pathname = `${parsed.pathname.replace(/_test$/, "")}_test`;
  return parsed.toString();
}
const testUrl =
  process.env.TEST_DATABASE_URL ?? fileEnv.TEST_DATABASE_URL ?? defaultTestUrl(developmentUrl);
validateIntegrationDatabases(developmentUrl, testUrl);

const env = {
  ...fileEnv,
  ...process.env,
  DATABASE_URL: testUrl,
  TEST_DATABASE_URL: testUrl,
  BETTER_AUTH_URL: "http://localhost:3102",
  NEXT_PUBLIC_APP_URL: "http://localhost:3102",
};

for (const [command, args] of [
  [
    process.execPath,
    [path.join(repoRoot, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"],
  ],
  [process.execPath, ["--import", "tsx", path.join(repoRoot, "scripts", "seed-quant-e2e.ts")]],
]) {
  const result = spawnSync(command, args, { cwd: repoRoot, env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const python = resolvePythonExecutable(repoRoot, env, existsSync);
const productionMode = process.env.E2E_PRODUCTION === "1";
const nextArgs = productionMode
  ? [path.join(repoRoot, "node_modules", "next", "dist", "bin", "next"), "start", "-p", "3102"]
  : [
      path.join(repoRoot, "node_modules", "next", "dist", "bin", "next"),
      "dev",
      "-p",
      "3102",
      "--webpack",
    ];
const children = [
  spawn(process.execPath, nextArgs, { cwd: repoRoot, env, stdio: "inherit", windowsHide: true }),
  spawn(python, [path.join(repoRoot, "quant-worker", "worker.py")], {
    cwd: repoRoot,
    env,
    stdio: "inherit",
    windowsHide: true,
  }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill();
  process.exitCode = code;
}
for (const child of children) {
  child.once("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.once("exit", (code) => {
    if (!stopping) stop(code === 0 ? 1 : (code ?? 1));
  });
}
process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));
