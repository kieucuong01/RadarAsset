import { describe, expect, it, vi } from "vitest";

import { getMarketDataHealth, marketDataStatusMeta } from "./client";

const validHealthItem = {
  symbol: "BTC",
  market: "crypto_spot",
  timeframe: "1d",
  providerCode: "binance-public",
  providerName: "Binance Public Spot",
  upstreamProvider: "binance",
  datasetVersionId: "version-btc-3",
  version: 3,
  rowCount: 1200,
  coverageStart: "2026-06-01T00:00:00.000Z",
  coverageEnd: "2026-08-10T11:00:00.000Z",
  publishedAt: "2026-08-10T11:10:00.000Z",
  lastIngestionStatus: "succeeded",
  lastErrorCode: null,
  freshness: "fresh",
} as const;

describe("market data health client", () => {
  it("maps freshness to explicit non-simulated status copy", () => {
    expect(marketDataStatusMeta("fresh")).toEqual({ label: "LIVE DATA", variant: "default" });
    expect(marketDataStatusMeta("stale")).toEqual({ label: "STALE", variant: "secondary" });
    expect(marketDataStatusMeta("unavailable")).toEqual({
      label: "UNAVAILABLE",
      variant: "outline",
    });
    expect(marketDataStatusMeta("fixture")).toEqual({
      label: "FIXTURE",
      variant: "secondary",
    });
  });

  it("accepts the bounded data-health response", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [validHealthItem] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(getMarketDataHealth(fetcher)).resolves.toEqual([validHealthItem]);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/market/data-health",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("accepts the complete configured health universe instead of three demo symbols", async () => {
    const data = Array.from({ length: 9 }, (_, index) => ({
      ...validHealthItem,
      symbol: index === 0 ? "VCB" : `ASSET${index}`,
      timeframe: "1d",
    }));
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data }), { status: 200 }));

    await expect(getMarketDataHealth(fetcher)).resolves.toHaveLength(9);
  });

  it("rejects provider metadata outside the freshness contract", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ ...validHealthItem, freshness: "pretend-live" }] }),
          { status: 200 },
        ),
      );

    await expect(getMarketDataHealth(fetcher)).rejects.toThrow(
      "Invalid market data health response.",
    );
  });

  it("does not expose the API response body when the request fails", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "database password=secret" }), { status: 503 }),
      );

    await expect(getMarketDataHealth(fetcher)).rejects.toThrow(
      "Unable to load market data health.",
    );
  });
});
