import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readSmartInsightsSourceTree(): string {
  const root = join(process.cwd(), "src", "components", "smart-insights");
  return readdirSync(root)
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => readFileSync(join(root, name), "utf8"))
    .join("\n");
}

describe("Smart Insights source guard", () => {
  it("contains no runtime sample market facts", () => {
    const source =
      readSmartInsightsSourceTree() +
      readFileSync(join(process.cwd(), "src", "components", "SmartInsights.tsx"), "utf8") +
      readFileSync(join(process.cwd(), "src", "lib", "i18n", "dictionary.ts"), "utf8");
    for (const forbidden of [
      "const tickers",
      "const NEWS",
      "const CALENDAR",
      "76.2",
      "842M",
      "67K",
      "18-22%",
      "Risk-On",
    ])
      expect(source).not.toContain(forbidden);
  });

  it("keeps the cockpit split into approved component boundaries", () => {
    const source = readSmartInsightsSourceTree();
    for (const name of [
      "DecisionBrief",
      "PortfolioImpact",
      "MarketRegimeStrip",
      "CryptoPanel",
      "MacroPanel",
      "GoldPanel",
      "EconomicCalendar",
      "EvidenceDrawer",
      "DataHealthPanel",
    ])
      expect(source).toContain(`function ${name}`);
  });

  it("restores every legacy Smart Insights block around the quantitative cockpit", () => {
    const source = readSmartInsightsSourceTree();
    for (const name of [
      "LegacyDailyHero",
      "LegacyAIDigest",
      "LegacyInvestorIntelligence",
      "LegacyMarketPulse",
      "LegacyWatchlist",
      "LegacyExpertSignals",
    ])
      expect(source).toContain(`function ${name}`);

    for (const market of ['value="crypto"', 'value="macro"', 'value="gold"'])
      expect(source).toContain(market);
  });

  it("visibly labels the optional seed-backed block as sample data", () => {
    const source = readFileSync(
      join(process.cwd(), "src", "components", "smart-insights", "LegacyExpertSignals.tsx"),
      "utf8",
    );

    expect(source).toContain('status="SAMPLE"');
    expect(source).toContain("SAMPLE_EXPERT_SIGNALS");
  });

  it("labels calendar and data-health seed fallbacks inside their own blocks", () => {
    for (const [file, seedName] of [
      ["EconomicCalendar.tsx", "SAMPLE_CALENDAR_EVENTS"],
      ["DataHealthPanel.tsx", "SAMPLE_HEALTH_SOURCES"],
    ]) {
      const source = readFileSync(
        join(process.cwd(), "src", "components", "smart-insights", file),
        "utf8",
      );
      expect(source).toContain(seedName);
      expect(source).toContain('status="SAMPLE"');
    }
  });

  it("keeps quantitative charts, tables, and provenance in Crypto Market Pulse", () => {
    const source = readSmartInsightsSourceTree();

    for (const token of [
      "CryptoFearGreedPanel",
      "CryptoEtfFlowPanel",
      "LineChart",
      "BarChart",
      "alternative.me/crypto/fear-and-greed-index",
      "farside.co.uk",
      "Dữ liệu mẫu",
      "BTC",
      "ETH",
      "SOL",
    ]) {
      expect(source).toContain(token);
    }
  });
});
