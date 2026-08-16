import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const scriptUrl = new URL("../../deploy/linux/provision-datavest.sh", import.meta.url);

describe("DataVest provisioning entry point", () => {
  it("passes a real Bash syntax check", async () => {
    const scriptPath = decodeURIComponent(scriptUrl.pathname).replace(/^\/(?:([A-Za-z]:))/, "$1");
    const bash = "C:\\Program Files\\Git\\bin\\bash.exe";
    const result = spawnSync(bash, ["-n", scriptPath], { encoding: "utf8" });

    expect(result.status, result.stderr).toBe(0);
  });
});
