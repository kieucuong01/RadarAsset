import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config as loadEnvFile } from "dotenv";

function checkoutCandidates(repoRoot) {
  const marker = `${path.sep}.worktrees${path.sep}`;
  const markerIndex = repoRoot.indexOf(marker);
  return markerIndex === -1 ? [repoRoot] : [repoRoot, repoRoot.slice(0, markerIndex)];
}

export function resolveLocalEnvFile(repoRoot, exists = existsSync) {
  return (
    checkoutCandidates(repoRoot)
      .map((root) => path.join(root, ".env.local"))
      .find(exists) ?? null
  );
}

export function resolvePythonExecutable(repoRoot, env = process.env, exists = existsSync) {
  if (env.PYTHON_EXECUTABLE) return env.PYTHON_EXECUTABLE;
  return (
    checkoutCandidates(repoRoot)
      .map((root) => path.join(root, ".venv", "Scripts", "python.exe"))
      .find(exists) ?? "python"
  );
}

export function childSpecs(repoRoot, pythonExecutable) {
  return [
    {
      name: "web",
      command: process.execPath,
      args: [
        path.join(repoRoot, "node_modules", "next", "dist", "bin", "next"),
        "dev",
        "-p",
        "3100",
        "--webpack",
      ],
    },
    {
      name: "worker",
      command: pythonExecutable,
      args: [path.join(repoRoot, "quant-worker", "worker.py")],
    },
    {
      name: "quant-engine",
      command: pythonExecutable,
      args: [
        "-m",
        "uvicorn",
        "service:app",
        "--app-dir",
        path.join(repoRoot, "quant-worker"),
        "--host",
        "127.0.0.1",
        "--port",
        "8100",
      ],
    },
    {
      name: "ingestion-worker",
      command: pythonExecutable,
      args: [
        path.join(repoRoot, "quant-worker", "process_ingestion_requests.py"),
        "--watch",
        "--poll-seconds",
        "5",
      ],
    },
  ];
}

function startLocalDevelopment() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const specs = childSpecs(repoRoot, resolvePythonExecutable(repoRoot));
  const childEnv = { ...process.env };
  const envFile = resolveLocalEnvFile(repoRoot);
  if (envFile) loadEnvFile({ path: envFile, processEnv: childEnv, quiet: true });
  const children = new Map();
  let stopping = false;

  function stop(exitCode = 0) {
    if (stopping) return;
    stopping = true;
    for (const child of children.values()) {
      if (!child.killed) child.kill();
    }
    process.exitCode = exitCode;
  }

  for (const spec of specs) {
    const child = spawn(spec.command, spec.args, {
      cwd: repoRoot,
      env: childEnv,
      stdio: "inherit",
      windowsHide: true,
    });
    children.set(spec.name, child);
    child.once("error", (error) => {
      console.error(`[${spec.name}] ${error.message}`);
      stop(1);
    });
    child.once("exit", (code, signal) => {
      children.delete(spec.name);
      if (!stopping) {
        console.error(`[${spec.name}] exited (${signal ?? code ?? "unknown"}).`);
        stop(code === 0 ? 1 : (code ?? 1));
      }
    });
  }

  process.once("SIGINT", () => stop(0));
  process.once("SIGTERM", () => stop(0));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startLocalDevelopment();
}
