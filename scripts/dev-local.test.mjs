import assert from "node:assert/strict";
import test from "node:test";

import { childSpecs, resolveLocalEnvFile, resolvePythonExecutable } from "./dev-local.mjs";

test("starts Next.js on the fixed local port and the continuous quant worker", () => {
  assert.deepEqual(childSpecs("C:\\repo", "C:\\Python\\python.exe"), [
    {
      name: "web",
      command: process.execPath,
      args: ["C:\\repo\\node_modules\\next\\dist\\bin\\next", "dev", "-p", "3100", "--webpack"],
    },
    {
      name: "worker",
      command: "C:\\Python\\python.exe",
      args: ["C:\\repo\\quant-worker\\worker.py"],
    },
    {
      name: "quant-engine",
      command: "C:\\Python\\python.exe",
      args: [
        "-m",
        "uvicorn",
        "service:app",
        "--app-dir",
        "C:\\repo\\quant-worker",
        "--host",
        "127.0.0.1",
        "--port",
        "8100",
      ],
    },
    {
      name: "ingestion-worker",
      command: "C:\\Python\\python.exe",
      args: [
        "C:\\repo\\quant-worker\\process_ingestion_requests.py",
        "--watch",
        "--poll-seconds",
        "5",
      ],
    },
  ]);
});

test("prefers an explicit Python executable", () => {
  assert.equal(
    resolvePythonExecutable("C:\\repo", {
      PYTHON_EXECUTABLE: "D:\\tools\\python.exe",
    }),
    "D:\\tools\\python.exe",
  );
});

test("reuses the main checkout environment and virtualenv from a worktree", () => {
  const repoRoot = "C:\\project\\.worktrees\\feature";
  const existing = new Set(["C:\\project\\.env.local", "C:\\project\\.venv\\Scripts\\python.exe"]);
  const exists = (candidate) => existing.has(candidate);

  assert.equal(resolveLocalEnvFile(repoRoot, exists), "C:\\project\\.env.local");
  assert.equal(
    resolvePythonExecutable(repoRoot, {}, exists),
    "C:\\project\\.venv\\Scripts\\python.exe",
  );
});
