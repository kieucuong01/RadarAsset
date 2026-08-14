import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: { metricObservation: { findMany: vi.fn() } },
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
}) {
  return {
    naturalKey: input.naturalKey,
    effectiveAt: new Date(input.effectiveAt),
    value: { toString: () => String(input.value) },
    revision: input.revision ?? 1,
    dimensions: input.dimensions ?? {},
    provider: input.provider ? { code: input.provider } : undefined,
    rawSnapshot: { sourceUrl: input.sourceUrl ?? "https://source.test" },
  };
}

describe("Crypto Market Pulse read model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });
});
