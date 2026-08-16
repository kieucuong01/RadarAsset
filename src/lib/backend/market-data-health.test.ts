import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: {
    asset: { findMany: vi.fn() },
    marketIngestionRun: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => prisma }));

import { loadMarketDataHealth } from "./market-repository";

describe("market data health read model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.asset.findMany.mockResolvedValue([]);
    prisma.marketIngestionRun.findMany.mockResolvedValue([]);
  });

  it("returns all configured feeds and exposes only the latest stable error code", async () => {
    prisma.asset.findMany.mockResolvedValue([
      {
        symbol: "BTC",
        market: "crypto_spot",
        datasets: [
          {
            timeframe: "1h",
            versions: [
              {
                id: "btc-version-3",
                version: 3,
                rowCount: 1200,
                coverageStart: new Date("2026-06-01T00:00:00Z"),
                coverageEnd: new Date("2026-08-10T11:00:00Z"),
                publishedAt: new Date("2026-08-10T11:10:00Z"),
                sourceMetadata: {
                  mode: "live",
                  upstreamProvider: "binance",
                  privateDiagnostic: "must-not-leak",
                },
                provider: { code: "binance-public", name: "Binance Public Spot" },
                bars: [{ source: "binance-public-spot" }],
              },
            ],
          },
        ],
      },
    ]);
    prisma.marketIngestionRun.findMany.mockResolvedValue([
      {
        assetSymbol: "BTC",
        timeframe: "1h",
        status: "failed",
        errorCode: "rate_limited",
        errorMessage: "must-not-be-selected",
      },
    ]);

    const response = await loadMarketDataHealth(new Date("2026-08-10T12:10:00Z"));
    const btcHourly = response.find((item) => item.symbol === "BTC" && item.timeframe === "1h");

    expect(response).toHaveLength(18);
    expect(btcHourly).toEqual({
      symbol: "BTC",
      market: "crypto_spot",
      timeframe: "1h",
      providerCode: "binance-public",
      providerName: "Binance Public Spot",
      upstreamProvider: "binance",
      datasetVersionId: "btc-version-3",
      version: 3,
      rowCount: 1200,
      coverageStart: "2026-06-01T00:00:00.000Z",
      coverageEnd: "2026-08-10T11:00:00.000Z",
      publishedAt: "2026-08-10T11:10:00.000Z",
      lastIngestionStatus: "failed",
      lastErrorCode: "rate_limited",
      freshness: "fresh",
    });
    expect(JSON.stringify(response)).not.toContain("must-not-leak");
    expect(JSON.stringify(response)).not.toContain("must-not-be-selected");
  });

  it("drops an ingestion error code outside the public allowlist", async () => {
    prisma.marketIngestionRun.findMany.mockResolvedValue([
      {
        assetSymbol: "XAU",
        timeframe: "1d",
        status: "failed",
        errorCode: "postgresql://user:secret@internal/database",
      },
    ]);

    const response = await loadMarketDataHealth(new Date("2026-08-10T12:10:00Z"));
    const xauDaily = response.find((item) => item.symbol === "XAU" && item.timeframe === "1d");

    expect(xauDaily?.lastErrorCode).toBeNull();
    expect(JSON.stringify(response)).not.toContain("secret");
  });

  it("exposes the stable unsupported timeframe state without an active dataset", async () => {
    prisma.marketIngestionRun.findMany.mockResolvedValue([
      {
        assetSymbol: "XAU",
        timeframe: "1h",
        status: "unavailable",
        errorCode: "unsupported_timeframe",
      },
    ]);

    const response = await loadMarketDataHealth(new Date("2026-08-10T12:10:00Z"));
    const xauHourly = response.find((item) => item.symbol === "XAU" && item.timeframe === "1h");

    expect(xauHourly?.lastErrorCode).toBe("unsupported_timeframe");
    expect(xauHourly?.datasetVersionId).toBeNull();
    expect(xauHourly?.freshness).toBe("unavailable");
  });
});
