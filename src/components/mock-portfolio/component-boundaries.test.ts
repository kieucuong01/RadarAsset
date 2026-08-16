import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const COMPONENT_ROOT = resolve("src/components");
const PORTFOLIO_ROOT = resolve(COMPONENT_ROOT, "mock-portfolio");
const PANEL_NAMES = [
  "PortfolioHeader",
  "PortfolioOverviewPanel",
  "PortfolioHoldingsTable",
  "PortfolioRiskMetrics",
  "PortfolioTransactionLog",
] as const;

describe("Mock Portfolio component boundaries", () => {
  it("keeps the data orchestrator small", () => {
    const source = readFileSync(resolve(COMPONENT_ROOT, "MockPortfolio.tsx"), "utf8");
    expect(source.split(/\r?\n/).length).toBeLessThanOrEqual(260);
  });

  it.each(PANEL_NAMES)("owns the %s section in its domain module", (name) => {
    expect(existsSync(resolve(PORTFOLIO_ROOT, `${name}.tsx`))).toBe(true);
  });

  it("keeps portfolio cache clients in the orchestrator", () => {
    const orchestrator = readFileSync(resolve(COMPONENT_ROOT, "MockPortfolio.tsx"), "utf8");
    expect(orchestrator).toContain('from "@/lib/portfolio-client"');

    for (const name of PANEL_NAMES) {
      const path = resolve(PORTFOLIO_ROOT, `${name}.tsx`);
      if (!existsSync(path)) continue;
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(/\b(getCachedPortfolio|clearCachedPortfolio)\b/);
    }
  });

  it.each(PANEL_NAMES)("keeps the %s section below its line budget", (name) => {
    const path = resolve(PORTFOLIO_ROOT, `${name}.tsx`);
    if (!existsSync(path)) return;
    const source = readFileSync(path, "utf8");
    expect(source.split(/\r?\n/).length).toBeLessThanOrEqual(360);
  });

  it("keeps the primary transaction action at the top and risk directly after holdings", () => {
    const orchestrator = readFileSync(resolve(COMPONENT_ROOT, "MockPortfolio.tsx"), "utf8");
    const overview = readFileSync(resolve(PORTFOLIO_ROOT, "PortfolioOverviewPanel.tsx"), "utf8");
    const transactionLog = readFileSync(
      resolve(PORTFOLIO_ROOT, "PortfolioTransactionLog.tsx"),
      "utf8",
    );

    expect(orchestrator).not.toContain("FavoriteAssetsPanel");
    expect(orchestrator.indexOf("<PortfolioOverviewPanel")).toBeLessThan(
      orchestrator.indexOf("<PortfolioHoldingsTable"),
    );
    expect(orchestrator.indexOf("<PortfolioHoldingsTable")).toBeLessThan(
      orchestrator.indexOf("<PortfolioRiskMetrics"),
    );
    expect(overview).toContain("PortfolioTransactionDialog");
    expect(overview).toContain("AssetIcon");
    expect(transactionLog).not.toContain("PortfolioTransactionDialog");
  });
});
