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
});
