import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const RESULTS_ROOT = resolve("src/components/backtest-results");
const ADVANCED_ROOT = resolve(RESULTS_ROOT, "advanced");
const MODULE_NAMES = [
  "AdvancedAnalysisSummary",
  "AggregatePortfolioAnalysis",
  "BacktestLegAnalysis",
] as const;

describe("Backtest advanced analysis boundaries", () => {
  it("keeps the mutation orchestrator small", () => {
    const source = readFileSync(resolve(RESULTS_ROOT, "BacktestAdvancedAnalysis.tsx"), "utf8");
    expect(source.split(/\r?\n/).length).toBeLessThanOrEqual(220);
  });

  it.each(MODULE_NAMES)("owns %s in its domain module", (name) => {
    expect(existsSync(resolve(ADVANCED_ROOT, `${name}.tsx`))).toBe(true);
  });

  it("keeps mutations in the orchestrator", () => {
    const orchestrator = readFileSync(
      resolve(RESULTS_ROOT, "BacktestAdvancedAnalysis.tsx"),
      "utf8",
    );
    expect(orchestrator).toContain('fetch("/api/portfolio/strategy-assignments"');
    expect(orchestrator).toContain("normalizeStrategyAssignment");
    expect(orchestrator).toContain("toast.success");

    for (const name of MODULE_NAMES) {
      const path = resolve(ADVANCED_ROOT, `${name}.tsx`);
      if (!existsSync(path)) continue;
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(/\b(fetch|toast|normalizeStrategyAssignment)\b/);
    }
  });

  it.each(MODULE_NAMES)("keeps %s below its line budget", (name) => {
    const path = resolve(ADVANCED_ROOT, `${name}.tsx`);
    if (!existsSync(path)) return;
    const source = readFileSync(path, "utf8");
    expect(source.split(/\r?\n/).length).toBeLessThanOrEqual(360);
  });

  it("preserves every advanced analysis domain", () => {
    const source = [
      "BacktestAdvancedAnalysis.tsx",
      ...MODULE_NAMES.map((name) => `advanced/${name}.tsx`),
    ]
      .map((file) => {
        const path = resolve(RESULTS_ROOT, file);
        return existsSync(path) ? readFileSync(path, "utf8") : "";
      })
      .join("\n");

    for (const key of [
      "reportTitle",
      "holdoutTitle",
      "contributionTitle",
      "cashFlowTitle",
      "completedTrades",
      "applySuccess",
    ]) {
      expect(source).toContain(key);
    }
  });
});
