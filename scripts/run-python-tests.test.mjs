import { strict as assert } from "node:assert";
import test from "node:test";
import path from "node:path";

import { runPythonTests } from "./run-python-tests.mjs";

test("runs pytest from the repository root with the resolved Python", () => {
  const calls = [];
  const exitCode = runPythonTests({
    repoRoot: "C:\\repo",
    args: ["-q"],
    env: { PYTHON_EXECUTABLE: "C:\\python\\python.exe" },
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls[0].command, "C:\\python\\python.exe");
  assert.deepEqual(calls[0].args, [
    "-m",
    "pytest",
    `--basetemp=${path.join(path.resolve("C:\\repo"), ".pytest-tmp-root")}`,
    "-q",
  ]);
  assert.equal(calls[0].options.cwd, path.resolve("C:\\repo"));
});
