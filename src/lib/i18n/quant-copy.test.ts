import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const QUANT_FILES = [
  "src/components/QuantLab.tsx",
  "src/components/MarketDataHealthPanel.tsx",
  "src/components/PortfolioOptimizerWorkbench.tsx",
  "src/components/portfolio-optimizer/OptimizerConfigurationPanel.tsx",
  "src/components/portfolio-optimizer/OptimizerResultsPanel.tsx",
  "src/components/portfolio-optimizer/OptimizerVisualizations.tsx",
  "src/components/StrategyLab.tsx",
  "src/components/strategy-lab/StrategyLibraryPanel.tsx",
  "src/components/strategy-lab/StrategyBuilderPanel.tsx",
  "src/components/strategy-lab/SavedStrategiesPanel.tsx",
  "src/components/FactorLab.tsx",
  "src/components/BacktestWorkbench.tsx",
  "src/components/PortfolioBacktestBuilder.tsx",
  "src/components/portfolio-backtest-builder/PortfolioSetupPanel.tsx",
  "src/components/portfolio-backtest-builder/PortfolioAllocationPanel.tsx",
  "src/components/portfolio-backtest-builder/PortfolioAssumptionsPanel.tsx",
  "src/components/BacktestLegCard.tsx",
  "src/components/backtest-results/BacktestResultsEmpty.tsx",
  "src/components/backtest-results/ActiveBacktestPortfolio.tsx",
  "src/components/backtest-results/EquityDrawdownChart.tsx",
  "src/components/backtest-results/BacktestKpiGrid.tsx",
  "src/components/backtest-results/BacktestTradeList.tsx",
  "src/components/backtest-results/BacktestAdvancedAnalysis.tsx",
  "src/components/backtest-results/advanced/AdvancedAnalysisSummary.tsx",
  "src/components/backtest-results/advanced/AggregatePortfolioAnalysis.tsx",
  "src/components/backtest-results/advanced/BacktestLegAnalysis.tsx",
  "src/components/PortfolioStrategyForwardTests.tsx",
  "src/components/StrategyAssignmentPanel.tsx",
];

describe("Quant UI copy", () => {
  it("contains no common UTF-8 mojibake sequences", () => {
    for (const file of QUANT_FILES) {
      const source = readFileSync(resolve(file), "utf8");
      expect(source, file).not.toMatch(/Ã|Â|áº|á»|�/u);
    }
  });

  it("uses translated optimizer method and strategy style labels", () => {
    const optimizer = [
      "src/components/PortfolioOptimizerWorkbench.tsx",
      "src/components/portfolio-optimizer/OptimizerConfigurationPanel.tsx",
      "src/components/portfolio-optimizer/OptimizerResultsPanel.tsx",
    ]
      .map((file) => readFileSync(resolve(file), "utf8"))
      .join("\n");
    const strategies = readFileSync(resolve("src/components/StrategyLab.tsx"), "utf8");

    expect(optimizer).not.toContain("OPTIMIZER_METHOD_LABELS");
    expect(optimizer).not.toContain("OPTIMIZER_METHOD_DESCRIPTIONS");
    expect(strategies).not.toContain("STYLE_LABELS");
  });

  it("formats Quant dates and counts with the active locale", () => {
    const health = readFileSync(resolve("src/components/MarketDataHealthPanel.tsx"), "utf8");
    expect(health).toContain("const { t, locale } = useI18n()");
    expect(health).not.toContain("Intl.DateTimeFormat(undefined");
    expect(health).not.toContain(".toLocaleString()");
  });
});
