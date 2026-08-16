import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const scriptUrl = new URL("../../deploy/linux/provision-datavest.sh", import.meta.url);

describe("DataVest provisioning entry point", () => {
  it("passes a real Bash syntax check", async () => {
    const scriptPath = decodeURIComponent(scriptUrl.pathname).replace(/^\/(?:([A-Za-z]:))/, "$1");
    const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
    const result = spawnSync(bash, ["-n", scriptPath], { encoding: "utf8" });

    expect(result.status, result.stderr).toBe(0);
  });

  it("installs the credential-safe S3 verifier for post-provision checks", async () => {
    const source = await readFile(scriptUrl, "utf8");
    expect(source).toContain('"${script_dir}/verify-s3-access.py"');
    expect(source).toContain("/usr/local/libexec/datavest/verify-s3-access.py");
  });
});
