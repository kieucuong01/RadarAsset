import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("daily dry-run reports FX synchronization before market publication", () => {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(root, "scripts", "run-market-ingestion.ps1"),
      "-Command",
      "daily",
      "-DryRun",
    ],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );

  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout.trim());
  assert.deepEqual(plan.stages, [
    "fx-rate-sync",
    "catalog-sync",
    "corporate-actions",
    "adjusted-publication",
  ]);
});
