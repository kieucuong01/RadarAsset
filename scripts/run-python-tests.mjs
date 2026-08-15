import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { resolvePythonExecutable } from "./dev-local.mjs";

export function runPythonTests({ repoRoot, args = [], env = process.env, spawn = spawnSync }) {
  const root = path.resolve(repoRoot);
  const python = resolvePythonExecutable(root, env);
  const basetemp = path.join(root, ".pytest-tmp-root");
  const result = spawn(python, ["-m", "pytest", `--basetemp=${basetemp}`, ...args], {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  process.exitCode = runPythonTests({ repoRoot, args: process.argv.slice(2) });
}
