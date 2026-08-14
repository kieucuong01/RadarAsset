import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: {
    metricObservation: { findMany: vi.fn() },
    signalSnapshot: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => prisma }));

import { loadCryptoMarketPulse } from "./crypto-market-pulse";

function observation(input: {
  naturalKey: string;
  effectiveAt: string;
  value: number;
  revision?: number;
  dimensions?: Record<string, string>;
  provider?: string;
  sourceUrl?: string;
  metricCode?: string;
  observedAt?: string;
}) {
  return {
    naturalKey: input.naturalKey,
    effectiveAt: new Date(input.effectiveAt),
    value: { toString: () => String(input.value) },
    revision: input.revision ?? 1,
    observedAt: input.observedAt ? new Date(input.observedAt) : undefined,
    dimensions: input.dimensions ?? {},
    provider: input.provider ? { code: input.provider } : undefined,
    rawSnapshot: { sourceUrl: input.sourceUrl ?? "https://source.test" },
    metricDefinition: input.metricCode ? { code: input.metricCode } : undefined,
  };
}

describe("Crypto Market Pulse read model", () => {
  beforeEach(() => {
    prisma.metricObservation.findMany.mockReset();
    prisma.signalSnapshot.findFirst.mockReset();
    prisma.metricObservation.findMany.mockResolvedValue([]);
    prisma.signalSnapshot.findFirst.mockResolvedValue(null);
  });

  it("deduplicates revisions and classifies the latest Fear & Greed value", async () => {
    prisma.metricObservation.findMany
      .mockResolvedValueOnce([
        observation({
          naturalKey: "fear:2026-08-12",
          effectiveAt: "2026-08-12T00:00:00.000Z",
          value: 24,
          revision: 2,
          sourceUrl: "https://alternative.me/crypto/fear-and-greed-index/",
        }),
        observation({
          naturalKey: "fear:2026-08-12",
          effectiveAt: "2026-08-12T00:00:00.000Z",
          value: 20,
          revision: 1,
        }),
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await loadCryptoMarketPulse(new Date("2026-08-14T12:00:00.000Z"));

    expect(result.fearGreed.status).toBe("system");
    expect(result.fearGreed.series).toEqual([
      {
        effectiveAt: "2026-08-12T00:00:00.000Z",
        value: 24,
        classification: "Extreme Fear",
      },
    ]);
    expect(result.fearGreed.latest).toEqual(result.fearGreed.series[0]);
  });

  it("keeps only Farside TOTAL rows, preserves missing assets, and sums five reported dates", async () => {
    const btcRows = [10, 20, 30, 40, 50, 60].map((value, index) =>
      observation({
        naturalKey: `btc:${index}`,
        effectiveAt: `2026-08-${String(7 + index).padStart(2, "0")}T00:00:00.000Z`,
        value,
        dimensions: { asset: "BTC", fund: "TOTAL" },
        provider: "farside-btc-etf",
      }),
    );
    prisma.metricObservation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        ...btcRows,
        observation({
          naturalKey: "btc:fund",
          effectiveAt: "2026-08-12T00:00:00.000Z",
          value: 999,
          dimensions: { asset: "BTC", fund: "IBIT" },
          provider: "farside-btc-etf",
        }),
        observation({
          naturalKey: "sol:2026-08-12",
          effectiveAt: "2026-08-12T00:00:00.000Z",
          value: -25,
          dimensions: { asset: "SOL", fund: "TOTAL" },
          provider: "farside-sol-etf",
        }),
      ])
      .mockResolvedValueOnce([]);

    const result = await loadCryptoMarketPulse(new Date("2026-08-14T12:00:00.000Z"));
    const latest = result.etfFlows.series.at(-1);
    const btc = result.etfFlows.summaries.find((row) => row.asset === "BTC");

    expect(result.etfFlows.status).toBe("partial");
    expect(latest).toEqual({
      effectiveAt: "2026-08-12T00:00:00.000Z",
      btc: 60,
      eth: null,
      sol: -25,
      total: 35,
    });
    expect(btc?.fiveDay).toBe(200);
    expect(btc?.thirtyDay).toBe(210);
    expect(result.etfFlows.sourceCodes).toEqual(["farside-btc-etf", "farside-sol-etf"]);
  });

  it("uses CoinShares asset dimensions and provider Total for the latest 12 reported weeks", async () => {
    const coinSharesRows = Array.from({ length: 13 }, (_, index) => {
      const day = String(index + 1).padStart(2, "0");
      return [
        observation({
          naturalKey: `coin:total:${day}`,
          effectiveAt: `2026-05-${day}T00:00:00.000Z`,
          value: index === 12 ? 12_000_000 : index,
          dimensions: { asset: "Total" },
        }),
        observation({
          naturalKey: `coin:btc:${day}`,
          effectiveAt: `2026-05-${day}T00:00:00.000Z`,
          value: index === 12 ? 10_000_000 : index,
          dimensions: { asset: "Bitcoin" },
        }),
      ];
    }).flat();
    coinSharesRows.push(
      observation({
        naturalKey: "coin:country",
        effectiveAt: "2026-05-13T00:00:00.000Z",
        value: 999_000_000,
        dimensions: { country: "United States" },
      }),
    );

    prisma.metricObservation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(coinSharesRows.reverse());

    const result = await loadCryptoMarketPulse(new Date("2026-08-14T12:00:00.000Z"));

    expect(result.fundFlows.status).toBe("system");
    expect(result.fundFlows.series).toHaveLength(12);
    expect(result.fundFlows.series.at(-1)?.total).toBe(12_000_000);
    expect(result.fundFlows.latestBreakdown).toEqual([{ label: "Bitcoin", value: 10_000_000 }]);
  });

  it("returns unavailable source states when no accepted observations exist", async () => {
    prisma.metricObservation.findMany.mockResolvedValue([]);

    const result = await loadCryptoMarketPulse(new Date("2026-08-14T12:00:00.000Z"));

    expect(result.fearGreed.status).toBe("unavailable");
    expect(result.etfFlows.status).toBe("unavailable");
    expect(result.fundFlows.status).toBe("unavailable");
    expect(result.largeAddressActivity.status).toBe("unavailable");
    expect(result.marginBorrow.status).toBe("unavailable");
    expect(result.liquidationMaxPain.status).toBe("unavailable");
    expect(result.cycleIndicators.altcoinSeason.status).toBe("unavailable");
    expect(result.cycleIndicators.cbbi.status).toBe("unavailable");
  });

  it("groups CoinGlass pressure and cycle observations without mixing units", async () => {
    const at = "2026-08-14T22:00:00.000Z";
    const pressureRows = [
      ["crypto.derivatives.margin_borrow.annualized_rate", 4.05],
      ["crypto.derivatives.margin_borrow.daily_rate", 0.0113],
      ["crypto.derivatives.margin_borrow.hourly_rate", 0.000469],
      ["crypto.derivatives.liquidation.current_price_usd", 62609.4],
      ["crypto.derivatives.liquidation.long_max_pain_price_usd", 60000],
      ["crypto.derivatives.liquidation.long_max_pain_level_usd", 98500000],
      ["crypto.derivatives.liquidation.long_distance_ratio", -0.0417],
      ["crypto.derivatives.liquidation.short_max_pain_price_usd", 65000],
      ["crypto.derivatives.liquidation.short_max_pain_level_usd", 120000000],
      ["crypto.derivatives.liquidation.short_distance_ratio", 0.0382],
    ].map(([metricCode, value], index) =>
      observation({
        naturalKey: `pressure:${index}`,
        effectiveAt: at,
        value: Number(value),
        metricCode: String(metricCode),
        provider: String(metricCode).includes("margin_borrow")
          ? "coinglass-margin-borrow"
          : "coinglass-liquidation-maxpain",
        dimensions: String(metricCode).includes("liquidation")
          ? { asset: "BTC", range: "24h" }
          : { exchange: "Binance" },
        observedAt: "2026-08-14T22:05:00.000Z",
      }),
    );
    pressureRows.push(
      observation({
        naturalKey: "pressure:0",
        effectiveAt: at,
        value: 9.99,
        revision: 1,
        metricCode: "crypto.derivatives.margin_borrow.annualized_rate",
        provider: "coinglass-margin-borrow",
      }),
    );
    pressureRows[0]!.revision = 2;

    const cbbiComponents = [
      "pi_cycle",
      "rupl_nupl",
      "rhodl",
      "puell",
      "two_year_ma",
      "trolololo",
      "mvrv",
      "reserve_risk",
      "woobull",
    ];
    const cycleRows = [
      ...[
        ["season_90d", 61],
        ["month", 43],
        ["year", 37],
      ].map(([horizon, value], index) =>
        observation({
          naturalKey: `alt:${index}`,
          effectiveAt: "2026-08-14T00:00:00.000Z",
          value: Number(value),
          metricCode: "crypto.cycle.altcoin_season.index",
          provider: "blockchaincenter-altcoin-season",
          dimensions: { horizon: String(horizon) },
        }),
      ),
      observation({
        naturalKey: "cbbi:confidence",
        effectiveAt: "2026-08-14T00:00:00.000Z",
        value: 31.34,
        metricCode: "crypto.cycle.cbbi.confidence",
        provider: "cbbi-public",
      }),
      ...cbbiComponents.map((code, index) =>
        observation({
          naturalKey: `cbbi:${code}`,
          effectiveAt: "2026-08-14T00:00:00.000Z",
          value: 20 + index,
          metricCode: `crypto.cycle.cbbi.component.${code}`,
          provider: "cbbi-public",
        }),
      ),
    ];
    prisma.metricObservation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(pressureRows)
      .mockResolvedValueOnce(cycleRows);

    const result = await loadCryptoMarketPulse(new Date("2026-08-14T23:00:00.000Z"));

    expect(result.marginBorrow.series[0]).toEqual({
      effectiveAt: at,
      annualizedRate: 4.05,
      dailyRate: 0.0113,
      hourlyRate: 0.000469,
    });
    expect(result.marginBorrow.status).toBe("system");
    expect(result.liquidationMaxPain.rows[0]).toMatchObject({
      asset: "BTC",
      range: "24h",
      currentPriceUsd: 62609.4,
      long: { priceUsd: 60000, levelUsd: 98500000, distanceRatio: -0.0417 },
      short: { priceUsd: 65000, levelUsd: 120000000, distanceRatio: 0.0382 },
    });
    expect(result.cycleIndicators.altcoinSeason.latest).toMatchObject({
      season90d: 61,
      month: 43,
      year: 37,
      classification: "neutral",
    });
    expect(result.cycleIndicators.cbbi.latest?.components).toHaveLength(9);
  });

  it("builds common-cohort large-address activity from accepted observations", async () => {
    const balances = [
      ["2026-08-10T00:00:00.000Z", "a", 1_000],
      ["2026-08-10T00:00:00.000Z", "b", 2_000],
      ["2026-08-11T00:00:00.000Z", "a", 1_020],
      ["2026-08-11T00:00:00.000Z", "b", 2_000],
      ["2026-08-12T00:00:00.000Z", "a", 1_040],
      ["2026-08-12T00:00:00.000Z", "b", 1_980],
    ].map(([effectiveAt, address, value], index) =>
      observation({
        naturalKey: `balance:${index}`,
        effectiveAt: String(effectiveAt),
        value: Number(value),
        dimensions: { address: String(address), rank: address === "a" ? "1" : "2" },
        provider: "mempool-btc-large-addresses",
      }),
    );
    const largeRows = [
      ...balances.map((row) => ({
        ...row,
        metricDefinition: { code: "crypto.large_address.confirmed_balance_btc" },
      })),
      {
        ...observation({
          naturalKey: "flow:to",
          effectiveAt: "2026-08-12T00:00:00.000Z",
          value: 25,
          provider: "mempool-btc-large-addresses",
        }),
        metricDefinition: { code: "crypto.large_address.to_exchange_btc" },
      },
      {
        ...observation({
          naturalKey: "flow:from",
          effectiveAt: "2026-08-12T00:00:00.000Z",
          value: 10,
          provider: "mempool-btc-large-addresses",
        }),
        metricDefinition: { code: "crypto.large_address.from_exchange_btc" },
      },
      {
        ...observation({
          naturalKey: "activity:out",
          effectiveAt: "2026-08-12T03:00:00.000Z",
          value: 5,
          dimensions: {
            address: "a",
            counterparty: "unknown",
            direction: "outgoing",
            txid: "a".repeat(64),
          },
          provider: "mempool-btc-large-addresses",
          sourceUrl: "https://mempool.space/api/address/a/txs",
        }),
        metricDefinition: { code: "crypto.large_address.confirmed_outgoing_btc" },
      },
      {
        ...observation({
          naturalKey: "universe:a",
          effectiveAt: "2026-08-12T00:00:00.000Z",
          value: 1_040,
          dimensions: { address: "a", cohort_version: "cohort-v1" },
          provider: "bitinfocharts-top-addresses",
          sourceUrl: "https://bitinfocharts.com/top-100-richest-bitcoin-addresses.html",
        }),
        metricDefinition: { code: "crypto.large_address.address_balance_btc" },
      },
    ];
    prisma.metricObservation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(largeRows);
    prisma.signalSnapshot.findFirst.mockResolvedValue({
      score: { toString: () => "42.5" },
      label: "accumulation",
      dataConfidence: { toString: () => "88.5" },
      status: "active",
      effectiveAt: new Date("2026-08-12T00:00:00.000Z"),
      methodologyVersion: "btc-large-address-action-v1",
    });

    const result = await loadCryptoMarketPulse(new Date("2026-08-14T12:00:00.000Z"));

    expect(result.largeAddressActivity.status).toBe("system");
    expect(result.largeAddressActivity.score).toBe(42.5);
    expect(result.largeAddressActivity.state).toBe("accumulation");
    expect(result.largeAddressActivity.confidence).toBe(88.5);
    expect(result.largeAddressActivity.horizons.oneDay).toMatchObject({
      netAccumulationBtc: 0,
      accumulationBreadth: 0.5,
      distributionBreadth: 0.5,
    });
    expect(result.largeAddressActivity.horizons.sevenDay.netAccumulationBtc).toBeNull();
    expect(result.largeAddressActivity.exchangeFlows.at(-1)).toMatchObject({
      toExchangeBtc: 25,
      fromExchangeBtc: 10,
      pressureBtc: 15,
    });
    expect(result.largeAddressActivity.notableActivity[0]).toMatchObject({
      address: "a",
      counterparty: "unknown",
      direction: "outgoing",
      valueBtc: 5,
    });
  });
});
