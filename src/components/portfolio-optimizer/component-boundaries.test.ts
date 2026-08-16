import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const COMPONENT_ROOT = resolve("src/components");
const OPTIMIZER_ROOT = resolve(COMPONENT_ROOT, "portfolio-optimizer");
const MODULE_NAMES = [
  "OptimizerConfigurationPanel",
  "OptimizerResultsPanel",
  "OptimizerVisualizations",
] as const;

describe("Portfolio Optimizer component boundaries", () => {
  it("keeps the request orchestrator small", () => {
    const source = readFileSync(resolve(COMPONENT_ROOT, "PortfolioOptimizerWorkbench.tsx"), "utf8");
    expect(source.split(/\r?\n/).length).toBeLessThanOrEqual(240);
  });

  it.each(MODULE_NAMES)("owns %s in its domain module", (name) => {
    expect(existsSync(resolve(OPTIMIZER_ROOT, `${name}.tsx`))).toBe(true);
  });

  it("keeps remote clients in the orchestrator", () => {
    const orchestrator = readFileSync(
      resolve(COMPONENT_ROOT, "PortfolioOptimizerWorkbench.tsx"),
      "utf8",
    );
    expect(orchestrator).toContain('from "@/lib/backtest/asset-client"');
    expect(orchestrator).toContain('from "@/lib/backtest/optimizer-client"');

    for (const name of MODULE_NAMES) {
      const path = resolve(OPTIMIZER_ROOT, `${name}.tsx`);
      if (!existsSync(path)) continue;
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(/\b(getQuantAssets|requestOptimizedAllocation)\b/);
    }
  });

  it.each(MODULE_NAMES)("keeps %s below its line budget", (name) => {
    const path = resolve(OPTIMIZER_ROOT, `${name}.tsx`);
    if (!existsSync(path)) return;
    const source = readFileSync(path, "utf8");
    expect(source.split(/\r?\n/).length).toBeLessThanOrEqual(380);
  });
});
