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

  it("keeps the old shell while replacing the three overlapping intelligence blocks", () => {
    const source = readSmartInsightsSourceTree();
    for (const name of ["LegacyDailyHero", "LegacyMarketPulse", "LegacyWatchlist"])
      expect(source).toContain(`function ${name}`);

    const smartInsightsPage = readFileSync(
      join(process.cwd(), "src", "components", "SmartInsights.tsx"),
      "utf8",
    );
    expect(smartInsightsPage).toContain("<AssetOpinions");
    for (const removed of ["LegacyAIDigest", "LegacyInvestorIntelligence", "LegacyExpertSignals"])
      expect(smartInsightsPage).not.toContain(removed);
    for (const endpoint of ["/api/research/runs", "/intelligence", "/api/insights"])
      expect(smartInsightsPage).not.toContain(endpoint);

    const assetOpinions = readFileSync(
      join(process.cwd(), "src", "components", "smart-insights", "AssetOpinions.tsx"),
      "utf8",
    );
    expect(assetOpinions).not.toContain("fetch(");
    expect(assetOpinions).not.toMatch(/SAMPLE_|Dữ liệu mẫu/);

    for (const market of ['value="crypto"', 'value="macro"', 'value="gold"'])
      expect(source).toContain(market);
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
      "Dữ liệu một phần",
      "BTC",
      "ETH",
      "SOL",
    ]) {
      expect(source).toContain(token);
    }
  });

  it("keeps CoinShares sample data UI-only and composes the dedicated Crypto request", () => {
    const source = readSmartInsightsSourceTree();
    for (const token of [
      "CryptoFundFlowPanel",
      "COINSHARES_SAMPLE_12_WEEKS",
      "coinshares.com/corp/resources/market-activity",
      "fetchCryptoMarketPulse",
    ]) {
      expect(source).toContain(token);
    }

    const backend = readFileSync(
      join(process.cwd(), "src", "lib", "backend", "crypto-market-pulse.ts"),
      "utf8",
    );
    const route = readFileSync(
      join(process.cwd(), "src", "app", "api", "smart-insights", "crypto-market-pulse", "route.ts"),
      "utf8",
    );
    expect(backend).not.toContain("COINSHARES_SAMPLE_12_WEEKS");
    expect(route).not.toContain("COINSHARES_SAMPLE_12_WEEKS");
  });

  it("keeps the BTC large-address panel chart-first, sourced, and sample-labelled", () => {
    const source = readSmartInsightsSourceTree();
    for (const token of [
      "CryptoLargeAddressPanel",
      "LARGE_ADDRESS_SAMPLE",
      "Hành động ví lớn BTC",
      "Dữ liệu mẫu",
      "mempool.space",
      "bitinfocharts.com/top-100-richest-bitcoin-addresses",
      "ComposedChart",
      "LineChart",
      "Áp lực lên sàn",
      "Độ rộng tích lũy",
    ]) {
      expect(source).toContain(token);
    }

    const backend = readFileSync(
      join(process.cwd(), "src", "lib", "backend", "crypto-market-pulse.ts"),
      "utf8",
    );
    expect(backend).not.toContain("LARGE_ADDRESS_SAMPLE");
  });

  it("does not render the removed featured-assets ticker block", () => {
    const source = readFileSync(
      join(process.cwd(), "src", "components", "smart-insights", "LegacyMarketPulse.tsx"),
      "utf8",
    );

    expect(source).not.toContain("curatedTickerUrl()");
    expect(source).not.toContain("resolveCuratedTickerSnapshot");
    expect(source).not.toContain("overview.market.trendingAssets");
    expect(source).not.toContain("SAMPLE_TICKERS");
    expect(source).not.toContain("rows.slice(0, 8)");
  });

  it("renders sourced Crypto metric trends without inventing unavailable history", () => {
    const source = readSmartInsightsSourceTree();

    for (const token of [
      "function CryptoMetricTrendPanel",
      "ResponsiveContainer",
      "LineChart",
      "trendPoints",
      "FreshnessBadge",
      "sourceUrl",
      "effectiveAt",
      'status="UNAVAILABLE"',
    ]) {
      expect(source).toContain(token);
    }
  });

  it("organizes Crypto Quant Pulse into the six approved chart-first tabs", () => {
    const source = readSmartInsightsSourceTree();

    expect(source).toContain("function CryptoQuantPulseTabs");
    expect(source).toContain('defaultValue="overview"');
    for (const value of ["overview", "flows", "sentiment", "cycle", "onchain", "whales"])
      expect(source).toContain(`value="${value}"`);
    for (const label of [
      "Tổng quan",
      "Dòng tiền",
      "Tâm lý &amp; Phái sinh",
      "Chu kỳ",
      "On-chain",
      "Cá voi BTC",
    ])
      expect(source).toContain(label);

    const tabs = readFileSync(
      join(process.cwd(), "src", "components", "smart-insights", "CryptoQuantPulseTabs.tsx"),
      "utf8",
    );
    expect(tabs).not.toContain("fetch(");
    expect(tabs).not.toContain("fetchCryptoMarketPulse");
  });

  it("keeps CoinGlass pressure and cycle panels sourced and unit-separated", () => {
    const source = readSmartInsightsSourceTree();
    for (const token of [
      "CryptoDerivativesPressurePanel",
      "CryptoCyclePanel",
      "coinglass.com/pro/i/MarginFeeChart",
      "coinglass.com/liquidation-maxpain",
      "blockchaincenter.net/altcoin-season-index",
      "colintalkscrypto.com/cbbi",
      "annualizedRate",
      "dailyRate",
      "hourlyRate",
      "currentPriceUsd",
      "season90d",
      "CBBI Confidence",
      "Không phải mức giá mục tiêu hoặc khuyến nghị giao dịch",
    ])
      expect(source).toContain(token);
  });

  it("uses theme chart colors and exposes the regime effective time", () => {
    const trendPanel = readFileSync(
      join(process.cwd(), "src", "components", "smart-insights", "CryptoMetricTrendPanel.tsx"),
      "utf8",
    );
    const tabs = readFileSync(
      join(process.cwd(), "src", "components", "smart-insights", "CryptoQuantPulseTabs.tsx"),
      "utf8",
    );

    expect(trendPanel).toContain('"var(--chart-1)"');
    expect(trendPanel).not.toContain("hsl(var(--chart-1))");
    expect(trendPanel).not.toContain("#6366f1");
    expect(tabs).toContain("dateTime={regime.effectiveAt}");
  });
});
