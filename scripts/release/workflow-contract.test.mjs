import { readFile } from "node:fs/promises";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

const workflowPath = new URL(
  "../../.github/workflows/build-production-artifact.yml",
  import.meta.url,
);

async function loadWorkflow() {
  const source = await readFile(workflowPath, "utf8");
  return { source, workflow: yaml.load(source) };
}

describe("production artifact workflow", () => {
  it("parses as YAML and exposes only a manual, read-only build", async () => {
    const { workflow } = await loadWorkflow();

    expect(workflow.on).toEqual({ workflow_dispatch: null });
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.concurrency).toEqual({
      group: "datavest-production-artifact",
      "cancel-in-progress": false,
    });
    expect(workflow.jobs.build["runs-on"]).toBe("ubuntu-24.04");
    expect(workflow.jobs.build.environment).toBeUndefined();
  });

  it("runs every build gate before uploading a checksummed artifact", async () => {
    const { workflow } = await loadWorkflow();
    const steps = workflow.jobs.build.steps;
    const runs = steps.flatMap((step) => (typeof step.run === "string" ? [step.run] : []));
    const commands = runs.join("\n");

    expect(steps.find((step) => step.uses?.startsWith("actions/setup-node@"))?.with).toMatchObject({
      "node-version": "24",
      cache: "npm",
    });
    expect(
      steps.find((step) => step.uses?.startsWith("actions/setup-python@"))?.with,
    ).toMatchObject({
      "python-version": "3.12",
    });
    expect(commands).toContain("npm ci");
    expect(commands).toContain("python -m pip install -r quant-worker/requirements.txt");
    expect(commands).toContain("npm run check");
    expect(commands).toContain("npm run build");
    expect(commands).toContain("python -m pip wheel");
    expect(commands).toContain("npm run release:assemble");
    expect(commands).toContain("sha256sum");

    const upload = steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
    expect(upload?.with?.["retention-days"]).toBe(14);
    expect(upload?.with?.name).toContain("github.sha");
  });

  it("does not grant the build job production application secrets", async () => {
    const { source, workflow } = await loadWorkflow();

    expect(workflow.jobs.build.env).toBeUndefined();
    expect(source).not.toMatch(
      /DATABASE_URL|DEEPSEEK|S3_SECRET|BETTER_AUTH_SECRET|QUANT_ENGINE_API_TOKEN/,
    );
  });
});
