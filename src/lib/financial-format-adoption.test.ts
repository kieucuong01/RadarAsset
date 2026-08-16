import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migratedFiles = [
  "src/components/MockPortfolio.tsx",
  "src/components/mock-portfolio/PortfolioHeader.tsx",
  "src/components/mock-portfolio/PortfolioOverviewPanel.tsx",
  "src/components/mock-portfolio/PortfolioHoldingsTable.tsx",
  "src/components/mock-portfolio/PortfolioRiskMetrics.tsx",
  "src/components/mock-portfolio/PortfolioTransactionLog.tsx",
  "src/components/PortfolioTransactionDialog.tsx",
  "src/components/PortfolioOptimizerWorkbench.tsx",
  "src/components/portfolio-optimizer/OptimizerConfigurationPanel.tsx",
  "src/components/portfolio-optimizer/OptimizerResultsPanel.tsx",
  "src/components/portfolio-optimizer/OptimizerVisualizations.tsx",
  "src/components/TickerTape.tsx",
  "src/components/FactorLab.tsx",
  "src/components/smart-insights/AssetOpinionCalculation.tsx",
  "src/components/smart-insights/CryptoQuantPulseTabs.tsx",
  "src/components/smart-insights/EventRiskPanel.tsx",
  "src/components/backtest-results/BacktestTradeList.tsx",
  "src/components/backtest-results/BacktestAdvancedAnalysis.tsx",
  "src/components/backtest-results/advanced/AdvancedAnalysisSummary.tsx",
  "src/components/backtest-results/advanced/AggregatePortfolioAnalysis.tsx",
  "src/components/backtest-results/advanced/BacktestLegAnalysis.tsx",
];

const mockPortfolioDateTimeFormatter =
  /new Date\(portfolio\.dataAsOf\)\.toLocaleString\("en-US",\s*\{[\s\S]*?\}\)/;

describe("financial formatter adoption", () => {
  it.each(migratedFiles)("does not format financial numbers ad hoc in %s", (file) => {
    const source = readFileSync(file, "utf8");
    const sourceWithoutDateTime = source.replace(mockPortfolioDateTimeFormatter, "");

    expect(source).not.toMatch(/new Intl\.NumberFormat/);
    expect(sourceWithoutDateTime).not.toMatch(/\.toLocaleString\(/);
    expect(source).not.toMatch(/\.toFixed\(/);
  });
});
