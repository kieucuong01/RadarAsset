import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/DataStatusBadge", () => ({
  DataStatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

import type { CryptoMarketPulseModel } from "@/lib/crypto-market-pulse-client";
import { I18nProvider } from "@/lib/i18n/provider";
import type { EnergyPulseModel } from "@/lib/smart-insights-client";
import type { MetricModel } from "@/lib/smart-insights-client";

import { CryptoDerivativesPressurePanel } from "./CryptoDerivativesPressurePanel";
import { CryptoLargeAddressPanel } from "./CryptoLargeAddressPanel";
import { CryptoMetricTrendPanel } from "./CryptoMetricTrendPanel";
import { CryptoQuantPulseTabs } from "./CryptoQuantPulseTabs";
import { EconomicCalendar } from "./EconomicCalendar";
import { EnergyPulsePanel } from "./EnergyPulsePanel";
import { LegacyInvestorIntelligence } from "./LegacyInvestorIntelligence";
import { LegacyWatchlist } from "./LegacyWatchlist";

function textContent(html: string): string {
  return html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'");
}

const observedAt = "2026-08-16T00:00:00Z";

const largeAddressActivity = {
  status: "system",
  sourceCodes: ["mempool-btc-large-addresses"],
  effectiveAt: observedAt,
  universeObservedAt: observedAt,
  score: 38,
  state: "accumulation",
  confidence: 74,
  calibrationStatus: "calibrated",
  horizons: {
    oneDay: {
      netAccumulationBtc: 12_345,
      accumulationBreadth: 0.4,
      distributionBreadth: 0.2,
      accumulatingCount: 20,
      distributingCount: 10,
      unchangedCount: 20,
    },
    sevenDay: {
      netAccumulationBtc: 12_345,
      accumulationBreadth: 0.4,
      distributionBreadth: 0.2,
      accumulatingCount: 20,
      distributingCount: 10,
      unchangedCount: 20,
    },
    thirtyDay: {
      netAccumulationBtc: 12_345,
      accumulationBreadth: 0.4,
      distributionBreadth: 0.2,
      accumulatingCount: 20,
      distributingCount: 10,
      unchangedCount: 20,
    },
  },
  exchangeFlows: [
    { effectiveAt: observedAt, toExchangeBtc: 100, fromExchangeBtc: 80, pressureBtc: 20 },
  ],
  concentrationSeries: [{ effectiveAt: observedAt, top10Ratio: 0.61 }],
  breadthSeries: [
    {
      effectiveAt: observedAt,
      netAccumulationBtc: 12_345,
      accumulationBreadth: 0.4,
      distributionBreadth: 0.2,
      accumulatingCount: 20,
      distributingCount: 10,
      unchangedCount: 20,
    },
  ],
  notableActivity: [],
  entrantsExits: null,
  qualityFlags: [],
  sources: [
    {
      sourceCode: "mempool-btc-large-addresses",
      sourceUrl: "https://mempool.space/",
      observedAt,
    },
  ],
  methodologyVersion: "btc-large-address-action-v1",
} satisfies NonNullable<CryptoMarketPulseModel["largeAddressActivity"]>;

const energy = {
  generatedAt: observedAt,
  methodology: "energy-oil-shock-v1",
  status: "AVAILABLE",
  oilShockScore: null,
  freshWeight: 1,
  asOf: observedAt,
  cards: [{ code: "wti", label: "WTI", value: 83.46, unit: "USD/barrel", asOf: observedAt }],
  priceSeries: [{ ts: observedAt, brent: 84.1, wti: 83.46 }],
  inventoryProduction: [],
  evidence: [],
} satisfies EnergyPulseModel;

describe("Smart Insights number formatting", () => {
  it("groups whale BTC quantities without inventing an explicit plus sign", () => {
    const text = textContent(
      renderToStaticMarkup(
        <CryptoLargeAddressPanel data={largeAddressActivity} mode="system" locale="vi" />,
      ),
    );

    expect(text).toContain("12,345 BTC");
    expect(text).not.toContain("+12,345 BTC");
  });

  it("uses a Unicode minus and two decimals for derivative percentages", () => {
    const data = {
      marginBorrow: {
        status: "system" as const,
        sourceCode: "coinglass-margin-borrow" as const,
        sourceUrl: "https://www.coinglass.com/pro/i/MarginFeeChart",
        observedAt,
        series: [
          {
            effectiveAt: observedAt,
            annualizedRate: -4.25,
            dailyRate: -0.5,
            hourlyRate: -0.02,
          },
        ],
      },
      liquidationMaxPain: {
        status: "unavailable" as const,
        sourceCode: "coinglass-liquidation-maxpain" as const,
        sourceUrl: "https://www.coinglass.com/liquidation-maxpain",
        observedAt: null,
        rows: [],
      },
    };
    const text = textContent(
      renderToStaticMarkup(
        <CryptoDerivativesPressurePanel data={data} mode="system" locale="vi" />,
      ),
    );

    expect(text).toContain("−4.25%");
  });

  it("translates explicit metric units while leaving chart series numeric", () => {
    const text = textContent(
      renderToStaticMarkup(
        <CryptoMetricTrendPanel
          title="Flows"
          description="Flow metrics"
          emptyDescription="Unavailable"
          locale="vi"
          series={[
            {
              key: "flow",
              metricCode: "crypto.coinshares.net_flow_usd",
              asset: "BTC",
              unit: "USD_MILLION",
              latest: {
                effectiveAt: observedAt,
                value: 120.5,
                sourceCode: "coinshares-weekly",
                sourceUrl: "https://coinshares.com/",
                freshness: "fresh",
              },
              points: [],
              trendPoints: [],
            },
          ]}
        />,
      ),
    );

    expect(text).toContain("120.5 triệu USD");
  });

  it("formats ratio-backed overview returns as percentages", () => {
    const metric = {
      observationId: "onchain-return",
      metricCode: "crypto.onchain.active_addresses_change_30d",
      market: "crypto",
      asset: "BTC",
      value: "-0.0425",
      unit: "return",
      delta: null,
      percentile: null,
      effectiveStart: observedAt,
      effectiveEnd: observedAt,
      observedAt,
      sourceCode: "coinmetrics-community",
      sourceUrl: "https://community-api.coinmetrics.io/",
      freshness: "fresh",
      qualityWarnings: [],
      methodologyVersion: "v1",
    } satisfies MetricModel;
    const text = textContent(
      renderToStaticMarkup(
        <CryptoQuantPulseTabs
          cryptoPulse={null}
          cryptoPulseState="loaded"
          metrics={[metric]}
          regime={undefined}
          locale="vi"
          kronosShadow={null}
          kronosShadowState="idle"
        />,
      ),
    );

    expect(text).toContain("−4.25%");
    expect(text).not.toContain("return");
  });

  it("translates the explicit oil unit", () => {
    const text = textContent(
      renderToStaticMarkup(<EnergyPulsePanel data={energy} state="loaded" locale="vi" />),
    );

    expect(text).toContain("83.46 USD/thùng");
  });

  it("preserves provider calendar strings because the contract has no value unit", () => {
    const text = textContent(
      renderToStaticMarkup(
        <EconomicCalendar
          impact="all"
          onImpactChange={() => undefined}
          events={[
            {
              id: "calendar-1",
              event: "Non-farm payrolls",
              country: "US",
              currency: "USD",
              impact: "high",
              actual: "123K",
              forecast: "120K",
              previous: "98K revised",
              eventDate: "2026-08-16",
              eventAt: observedAt,
              timeStatus: "released",
              surprise: null,
              portfolioRelevance: "0",
              sourceCode: "cryptocraft",
              sourceUrl: "https://www.cryptocraft.com/calendar",
              observedAt,
              licenseScope: "research_only",
            },
          ]}
        />,
      ),
    );

    expect(text).toContain("Actual 123K · Forecast 120K · Previous 98K revised");
  });

  it("formats legacy watchlist prices as declared monetary values", () => {
    const text = textContent(
      renderToStaticMarkup(
        <I18nProvider>
          <LegacyWatchlist />
        </I18nProvider>,
      ),
    );

    expect(text).toContain("100 VND");
  });

  it("does not turn missing legacy sentiment counts into zero", () => {
    const text = textContent(
      renderToStaticMarkup(
        <I18nProvider>
          <LegacyInvestorIntelligence />
        </I18nProvider>,
      ),
    );

    expect(text).toContain("—bull—bear—neutral");
  });
});
