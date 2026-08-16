import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const COMPONENT_ROOT = resolve("src/components");
const BUILDER_ROOT = resolve(COMPONENT_ROOT, "portfolio-backtest-builder");
const PANEL_NAMES = [
  "PortfolioSetupPanel",
  "PortfolioAllocationPanel",
  "PortfolioAssumptionsPanel",
] as const;

describe("Portfolio Backtest Builder component boundaries", () => {
  it("keeps the workflow orchestrator small", () => {
    const source = readFileSync(resolve(COMPONENT_ROOT, "PortfolioBacktestBuilder.tsx"), "utf8");
    expect(source.split(/\r?\n/).length).toBeLessThanOrEqual(360);
  });

  it.each(PANEL_NAMES)("owns the %s panel in its domain module", (name) => {
    expect(existsSync(resolve(BUILDER_ROOT, `${name}.tsx`))).toBe(true);
  });

  it("keeps remote clients in the orchestrator", () => {
    const orchestrator = readFileSync(
      resolve(COMPONENT_ROOT, "PortfolioBacktestBuilder.tsx"),
      "utf8",
    );
    expect(orchestrator).toContain('from "@/lib/backtest/asset-client"');
    expect(orchestrator).toContain('from "@/lib/backtest/client"');
    expect(orchestrator).toContain('from "@/lib/backtest/optimizer-client"');

    for (const name of PANEL_NAMES) {
      const path = resolve(BUILDER_ROOT, `${name}.tsx`);
      if (!existsSync(path)) continue;
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(
        /\b(getQuantAssets|getStrategyCatalog|requestOptimizedAllocation|submitBacktest)\b/,
      );
    }
  });

  it.each(PANEL_NAMES)("keeps the %s panel below its line budget", (name) => {
    const path = resolve(BUILDER_ROOT, `${name}.tsx`);
    if (!existsSync(path)) return;
    const source = readFileSync(path, "utf8");
    expect(source.split(/\r?\n/).length).toBeLessThanOrEqual(420);
  });
});
