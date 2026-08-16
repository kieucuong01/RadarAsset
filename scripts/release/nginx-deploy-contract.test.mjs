import { readFile } from "node:fs/promises";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

describe("DataVest edge and production delivery", () => {
  it("defines a bounded loopback-only Nginx upstream and canonical www redirect", async () => {
    const source = await read("deploy/linux/nginx/datavest.conf");
    expect(source).toContain("server_name datavest.vn;");
    expect(source).toContain("server_name www.datavest.vn;");
    expect(source).toContain("return 308 https://datavest.vn$request_uri;");
    expect(source).toContain("proxy_pass http://127.0.0.1:4200;");
    expect(source).toContain("proxy_set_header Host $host;");
    expect(source).toContain("proxy_set_header X-Forwarded-Proto $scheme;");
    expect(source).toContain("proxy_set_header X-Real-IP $remote_addr;");
    expect(source).toContain("proxy_set_header Upgrade $http_upgrade;");
    expect(source).toContain("client_max_body_size 2m;");
    expect(source).toMatch(/proxy_(connect|read|send)_timeout\s+\d+s;/g);
    expect(source).not.toMatch(/proxy_pass\s+http:\/\/(?!127\.0\.0\.1:4200)/);
  });

  it("deploys the built artifact through pinned-key SSH in the production environment", async () => {
    const source = await read(".github/workflows/build-production-artifact.yml");
    const workflow = yaml.load(source);
    const deploy = workflow.jobs.deploy;
    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(workflow.on.push.branches).toEqual(["main"]);
    expect(deploy.needs).toBe("build");
    expect(deploy.environment).toBe("production");
    expect(deploy.if).toBe("github.event_name == 'workflow_dispatch'");
    expect(deploy.steps.some((step) => step.uses === "actions/download-artifact@v4")).toBe(true);
    const commands = deploy.steps
      .filter((step) => typeof step.run === "string")
      .map((step) => step.run)
      .join("\n");
    expect(commands).toContain("sha256sum -c");
    expect(commands).toContain("scp");
    expect(commands).toContain("ssh");
    expect(commands).toContain("StrictHostKeyChecking=yes");
    expect(commands).toContain("UserKnownHostsFile=");
    expect(commands).toContain("sudo /usr/local/sbin/deploy-datavest");
    expect(commands).toContain("/opt/datavest/incoming/");
    expect(commands).toContain('chmod 600 "$key_file"');
    expect(commands).toContain("rm -f");
    expect(source).toContain("DATAVEST_VPS_KNOWN_HOSTS");
    for (const name of [
      "DATAVEST_VPS_HOST",
      "DATAVEST_VPS_PORT",
      "DATAVEST_VPS_USER",
      "DATAVEST_VPS_SSH_KEY",
    ]) {
      expect(source).toContain(name);
    }
    expect(source).not.toContain("StrictHostKeyChecking=no");
    expect(source).not.toMatch(/sshpass|password/i);
    expect(source).not.toMatch(/DEEPSEEK_API_KEY|DATAVEST_S3_SECRET_ACCESS_KEY/);
  });
});
