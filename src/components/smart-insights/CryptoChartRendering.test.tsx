import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/DataStatusBadge", () => ({
  DataStatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock("recharts", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const Primitive = () => null;
  const Line = ({
    dataKey,
    stroke,
    dot,
    isAnimationActive,
  }: {
    dataKey: string;
    stroke?: string;
    dot?: boolean | Record<string, unknown>;
    isAnimationActive?: boolean;
  }) => (
    <span
      data-testid={`line-${dataKey}`}
      data-stroke={stroke}
      data-dot-visible={typeof dot === "object" ? "true" : String(Boolean(dot))}
      data-animation={String(isAnimationActive)}
    />
  );
  return {
    Bar: Container,
    BarChart: Container,
    CartesianGrid: Primitive,
    Cell: Primitive,
    ComposedChart: Container,
    Line,
    LineChart: Container,
    ReferenceArea: Primitive,
    ReferenceLine: Primitive,
    ResponsiveContainer: Container,
    Tooltip: Primitive,
    XAxis: Primitive,
    YAxis: Primitive,
  };
});

import type { CryptoMarketPulseModel } from "@/lib/crypto-market-pulse-client";

import { CryptoCyclePanel } from "./CryptoCyclePanel";
import { CryptoDerivativesPressurePanel } from "./CryptoDerivativesPressurePanel";
import { CryptoFearGreedPanel } from "./CryptoFearGreedPanel";
import { CryptoLargeAddressPanel } from "./CryptoLargeAddressPanel";

const observedAt = "2026-08-16T00:00:00Z";

function expectVisibleLine(html: string, dataKey: string) {
  const line = html.match(new RegExp(`<span[^>]+data-testid="line-${dataKey}"[^>]*>`))?.[0];
  expect(line).toBeDefined();
  expect(line).toContain('data-stroke="var(--chart-1)"');
  expect(line).toContain('data-animation="false"');
  return line ?? "";
}

describe("Smart Insights Crypto chart rendering", () => {
  it("keeps a one-observation Fear and Greed trend visible", () => {
    const html = renderToStaticMarkup(
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
    );

    expect(expectVisibleLine(html, "value")).toContain('data-dot-visible="true"');
  });

  it("keeps a one-observation CBBI trend visible", () => {
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
    const html = renderToStaticMarkup(
      <CryptoCyclePanel
        locale="vi"
        mode="system"
        data={{
          altcoinSeason: {
            status: "unavailable",
            sourceCode: "blockchaincenter-altcoin-season",
            sourceUrl: "https://www.blockchaincenter.net/altcoin-season-index/",
            observedAt: null,
            latest: null,
            series: [],
          },
          cbbi: {
            status: "system",
            sourceCode: "cbbi-public",
            sourceUrl: "https://colintalkscrypto.com/cbbi/",
            observedAt,
            latest: { effectiveAt: observedAt, confidence: 61.25, components },
            series: [{ effectiveAt: observedAt, confidence: 61.25, components }],
          },
        }}
      />,
    );

    expect(expectVisibleLine(html, "confidence")).toContain('data-dot-visible="true"');
  });

  it("passes complete theme colors to derivative and whale pressure lines", () => {
    const derivatives = renderToStaticMarkup(
      <CryptoDerivativesPressurePanel
        locale="vi"
        mode="system"
        data={{
          marginBorrow: {
            status: "system",
            sourceCode: "coinglass-margin-borrow",
            sourceUrl: "https://www.coinglass.com/pro/i/MarginFeeChart",
            observedAt,
            series: [
              {
                effectiveAt: "2026-08-15T00:00:00Z",
                annualizedRate: 3,
                dailyRate: 0.1,
                hourlyRate: 0.01,
              },
              { effectiveAt: observedAt, annualizedRate: 4, dailyRate: 0.2, hourlyRate: 0.02 },
            ],
          },
          liquidationMaxPain: {
            status: "unavailable",
            sourceCode: "coinglass-liquidation-maxpain",
            sourceUrl: "https://www.coinglass.com/liquidation-maxpain",
            observedAt: null,
            rows: [],
          },
        }}
      />,
    );
    expectVisibleLine(derivatives, "annualizedRate");

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
          netAccumulationBtc: 20,
          accumulationBreadth: 0.4,
          distributionBreadth: 0.2,
          accumulatingCount: 20,
          distributingCount: 10,
          unchangedCount: 20,
        },
        sevenDay: {
          netAccumulationBtc: 30,
          accumulationBreadth: 0.4,
          distributionBreadth: 0.2,
          accumulatingCount: 20,
          distributingCount: 10,
          unchangedCount: 20,
        },
        thirtyDay: {
          netAccumulationBtc: 40,
          accumulationBreadth: 0.4,
          distributionBreadth: 0.2,
          accumulatingCount: 20,
          distributingCount: 10,
          unchangedCount: 20,
        },
      },
      exchangeFlows: [
        {
          effectiveAt: "2026-08-15T00:00:00Z",
          toExchangeBtc: 100,
          fromExchangeBtc: 80,
          pressureBtc: 20,
        },
        { effectiveAt: observedAt, toExchangeBtc: 90, fromExchangeBtc: 100, pressureBtc: -10 },
      ],
      concentrationSeries: [{ effectiveAt: observedAt, top10Ratio: 0.61 }],
      breadthSeries: [
        {
          effectiveAt: observedAt,
          netAccumulationBtc: 20,
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
    const whale = renderToStaticMarkup(
      <CryptoLargeAddressPanel data={largeAddressActivity} mode="system" locale="vi" />,
    );
    expectVisibleLine(whale, "pressureBtc");
  });
});
