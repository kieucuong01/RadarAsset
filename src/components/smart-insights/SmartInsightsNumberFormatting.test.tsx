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
import { CryptoEtfFlowPanel } from "./CryptoEtfFlowPanel";
import { CryptoFearGreedPanel } from "./CryptoFearGreedPanel";
import { CryptoFundFlowPanel } from "./CryptoFundFlowPanel";
import { CryptoLargeAddressPanel } from "./CryptoLargeAddressPanel";
import { CryptoMetricTrendPanel } from "./CryptoMetricTrendPanel";
import { CryptoQuantPulseTabs } from "./CryptoQuantPulseTabs";
import { CryptoCyclePanel } from "./CryptoCyclePanel";
import { EconomicCalendar } from "./EconomicCalendar";
import { EnergyPulsePanel } from "./EnergyPulsePanel";
import { GoldPanel } from "./GoldPanel";
import { LegacyMarketPulse } from "./LegacyMarketPulse";
import { MacroPanel } from "./MacroPanel";

function textContent(html: string): string {
  return html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'");
}

const observedAt = "2026-08-16T00:00:00Z";

function metric(
  observationId: string,
  market: MetricModel["market"],
  metricCode: string,
  value: string,
  unit: string,
): MetricModel {
  return {
    observationId,
    metricCode,
    market,
    asset: market === "gold" ? "XAU" : null,
    value,
    unit,
    delta: null,
    percentile: null,
    effectiveStart: observedAt,
    effectiveEnd: observedAt,
    observedAt,
    sourceCode: "source-system",
    sourceUrl: "https://example.test/source",
    freshness: "fresh",
    qualityWarnings: [],
    methodologyVersion: "v1",
  };
}

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

  it("maps production open-interest metadata to localized contracts", () => {
    const text = textContent(
      renderToStaticMarkup(
        <CryptoMetricTrendPanel
          title="Derivatives"
          description="Open interest"
          emptyDescription="Unavailable"
          locale="vi"
          series={[
            {
              key: "open-interest",
              metricCode: "crypto.derivatives.open_interest",
              asset: "BTC",
              unit: "native",
              latest: {
                effectiveAt: observedAt,
                value: 12_345,
                sourceCode: "deribit-public",
                sourceUrl: "https://www.deribit.com/",
                freshness: "fresh",
              },
              points: [
                {
                  effectiveAt: "2026-08-15T00:00:00Z",
                  value: 12_000,
                  sourceCode: "deribit-public",
                  sourceUrl: "https://www.deribit.com/",
                  freshness: "fresh",
                },
                {
                  effectiveAt: observedAt,
                  value: 12_345,
                  sourceCode: "deribit-public",
                  sourceUrl: "https://www.deribit.com/",
                  freshness: "fresh",
                },
              ],
              trendPoints: [
                {
                  effectiveAt: "2026-08-15T00:00:00Z",
                  value: 12_000,
                  sourceCode: "deribit-public",
                  sourceUrl: "https://www.deribit.com/",
                  freshness: "fresh",
                },
                {
                  effectiveAt: observedAt,
                  value: 12_345,
                  sourceCode: "deribit-public",
                  sourceUrl: "https://www.deribit.com/",
                  freshness: "fresh",
                },
              ],
            },
          ]}
        />,
      ),
    );

    expect(text).toContain("12,345 hợp đồng");
    expect(text).not.toContain("native");
  });

  it("formats the production Farside ETF panel with shared million-USD semantics", () => {
    const text = textContent(
      renderToStaticMarkup(
        <CryptoEtfFlowPanel
          locale="vi"
          mode="system"
          data={{
            status: "system",
            sourceCodes: ["farside-btc-etf"],
            series: [
              {
                effectiveAt: observedAt,
                btc: -120_500_000,
                eth: null,
                sol: null,
                total: -120_500_000,
              },
            ],
            summaries: [
              {
                asset: "BTC",
                latest: -120_500_000,
                fiveDay: -120_500_000,
                thirtyDay: -120_500_000,
                latestEffectiveAt: observedAt,
              },
            ],
          }}
        />,
      ),
    );

    expect(text).toContain("−120.5 triệu USD");
    expect(text).not.toContain("-US$120.5m");
  });

  it("formats the production CoinShares panel with shared million-USD semantics", () => {
    const text = textContent(
      renderToStaticMarkup(
        <CryptoFundFlowPanel
          locale="vi"
          mode="system"
          data={{
            status: "system",
            sourceCode: "coinshares-weekly",
            sourceUrl: "https://coinshares.com/",
            series: [
              {
                effectiveAt: observedAt,
                total: -120_500_000,
                assets: [{ label: "Bitcoin", value: -120_500_000 }],
              },
            ],
            latestBreakdown: [{ label: "Bitcoin", value: -120_500_000 }],
          }}
        />,
      ),
    );

    expect(text).toContain("−120.5 triệu USD");
    expect(text).not.toContain("-US$120.5m");
  });

  it("formats the production Fear and Greed index with a localized unit", () => {
    const text = textContent(
      renderToStaticMarkup(
        <CryptoFearGreedPanel
          locale="vi"
          mode="system"
          data={{
            status: "system",
            sourceCode: "alternative-fng",
            sourceUrl: "https://alternative.me/crypto/fear-and-greed-index/",
            latest: { effectiveAt: observedAt, value: 62.5, classification: "Greed" },
            series: [{ effectiveAt: observedAt, value: 62.5, classification: "Greed" }],
          }}
        />,
      ),
    );

    expect(text).toContain("62.5 điểm");
  });

  it("formats production cycle indices and confidence through shared semantics", () => {
    const components = [
      "pi_cycle",
      "rupl_nupl",
      "rhodl",
      "puell",
      "two_year_ma",
      "trolololo",
      "mvrv",
      "reserve_risk",
      "woobull",
    ].map((code) => ({ code, value: 61.25 })) as NonNullable<
      CryptoMarketPulseModel["cycleIndicators"]["cbbi"]["latest"]
    >["components"];
    const text = textContent(
      renderToStaticMarkup(
        <CryptoCyclePanel
          locale="vi"
          mode="system"
          data={{
            altcoinSeason: {
              status: "system",
              sourceCode: "blockchaincenter-altcoin-season",
              sourceUrl: "https://www.blockchaincenter.net/altcoin-season-index/",
              observedAt,
              latest: {
                effectiveAt: observedAt,
                season90d: 62.5,
                month: 62.5,
                year: 62.5,
                classification: "neutral",
              },
              series: [],
            },
            cbbi: {
              status: "system",
              sourceCode: "cbbi-public",
              sourceUrl: "https://colintalkscrypto.com/cbbi/",
              observedAt,
              latest: { effectiveAt: observedAt, confidence: 61.25, components },
              series: [],
            },
          }}
        />,
      ),
    );

    expect(text).toContain("62.5 điểm");
    expect(text).toContain("61.25%");
    expect(text).not.toContain("61.3%");
  });

  it("formats the production Macro metric panel from real unit spelling", () => {
    const text = textContent(
      renderToStaticMarkup(
        <I18nProvider>
          <MacroPanel
            metrics={[
              metric(
                "macro-flow",
                "macro",
                "macro.fed_balance_sheet_change_4w",
                "120.500000",
                "USD million",
              ),
            ]}
          />
        </I18nProvider>,
      ),
    );

    expect(text).toContain("120.5 triệu USD");
    expect(text).not.toContain("120.500000");
  });

  it("formats the production Gold metric panel return as a percentage", () => {
    const text = textContent(
      renderToStaticMarkup(
        <I18nProvider>
          <GoldPanel
            metrics={[metric("gold-return", "gold", "gold.xau_return_1d", "-0.0425", "return")]}
          />
        </I18nProvider>,
      ),
    );

    expect(text).toContain("−4.25%");
    expect(text).not.toContain("-0.0425return");
  });

  it("limits a live Gold ratio metric to four decimals", () => {
    const text = textContent(
      renderToStaticMarkup(
        <I18nProvider>
          <GoldPanel
            metrics={[
              metric(
                "gold-net-oi",
                "gold",
                "gold.cftc.managed_money_net_oi",
                "0.12345678",
                "ratio",
              ),
            ]}
          />
        </I18nProvider>,
      ),
    );

    expect(text).toContain("0.1235");
    expect(text).not.toContain("0.12345678 ratio");
  });

  it("limits a live Macro z-score metric to four decimals", () => {
    const text = textContent(
      renderToStaticMarkup(
        <I18nProvider>
          <MacroPanel
            metrics={[
              metric(
                "macro-growth-surprise",
                "macro",
                "macro.growth_surprise",
                "-1.23456789",
                "z_score",
              ),
            ]}
          />
        </I18nProvider>,
      ),
    );

    expect(text).toContain("−1.2346");
    expect(text).not.toContain("−1.23456789 z_score");
  });

  it("limits a live Macro score metric to two decimals", () => {
    const text = textContent(
      renderToStaticMarkup(
        <I18nProvider>
          <MacroPanel
            metrics={[
              metric("macro-regime-score", "macro", "macro.regime.score", "38.125000", "score"),
            ]}
          />
        </I18nProvider>,
      ),
    );

    expect(text).toContain("38.13");
    expect(text).not.toContain("38.125 score");
  });

  it("formats the active legacy Macro pulse route", () => {
    const text = textContent(
      renderToStaticMarkup(
        <I18nProvider>
          <LegacyMarketPulse
            market="macro"
            metrics={[
              metric(
                "legacy-macro-flow",
                "macro",
                "macro.fed_balance_sheet_change_4w",
                "120.500000",
                "USD million",
              ),
            ]}
            regimes={[]}
            macroEventRisk={null}
            energyPulse={null}
            macroPulseState="loaded"
            onMarketChange={() => undefined}
          />
        </I18nProvider>,
      ),
    );

    expect(text).toContain("120.5 triệu USD");
    expect(text).not.toContain("120.500000");
  });

  it("formats the active legacy Gold pulse route", () => {
    const text = textContent(
      renderToStaticMarkup(
        <I18nProvider>
          <LegacyMarketPulse
            market="gold"
            metrics={[
              metric("legacy-gold-return", "gold", "gold.xau_return_1d", "-0.0425", "return"),
            ]}
            regimes={[]}
            macroEventRisk={null}
            energyPulse={null}
            macroPulseState="loaded"
            onMarketChange={() => undefined}
          />
        </I18nProvider>,
      ),
    );

    expect(text).toContain("−4.25%");
    expect(text).not.toContain("-0.0425return");
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
          locale="vi"
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

    expect(text).toContain("Thực tế 123K · Dự báo 120K · Trước đó 98K revised");
  });

  it("labels Market Pulse and the calendar as current data", () => {
    const pulse = renderToStaticMarkup(
      <I18nProvider>
        <LegacyMarketPulse
          market="macro"
          metrics={[]}
          regimes={[]}
          macroEventRisk={null}
          energyPulse={null}
          macroPulseState="idle"
          onMarketChange={() => undefined}
        />
      </I18nProvider>,
    );
    const calendar = renderToStaticMarkup(
      <EconomicCalendar locale="en" events={[]} impact="all" onImpactChange={() => undefined} />,
    );

    expect(pulse).toContain("Dữ liệu hiện tại");
    expect(calendar).toContain("Current data");
  });
});
