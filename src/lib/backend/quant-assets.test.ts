import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: { asset: { findMany: vi.fn() } },
}));

vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => prisma }));

import { loadQuantAssetCatalog } from "./quant-assets";

const vnmAsset = {
  symbol: "VNM",
  name: "Vinamilk",
  market: "vn_equity",
  venue: "HOSE",
  currency: "VND",
  maxLeverage: 2,
  datasets: [
    {
      versions: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          coverageStart: new Date("2024-01-01T00:00:00.000Z"),
          coverageEnd: new Date("2026-01-01T00:00:00.000Z"),
          rowCount: 500,
          publishedAt: new Date("2026-01-01T09:00:00.000Z"),
          bars: [{ source: "vnstock" }],
        },
      ],
    },
  ],
};

const vn30Asset = {
  symbol: "VN30",
  name: "VN30 Index",
  market: "vn_equity",
  venue: "HOSE",
  currency: "VND",
  maxLeverage: 1,
  datasets: [],
};

describe("supported Quant asset catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.asset.findMany.mockResolvedValue([]);
  });

  it("returns every matching system asset with timeframe-specific readiness", async () => {
    prisma.asset.findMany.mockResolvedValue([vnmAsset, vn30Asset]);

    const result = await loadQuantAssetCatalog(
      { q: "VN", timeframe: "1d", from: "2025-01-01", to: "2026-01-01" },
      new Date("2026-01-02T12:00:00.000Z"),
    );

    expect(result.items).toEqual([
      expect.objectContaining({
        symbol: "VNM",
        datasetVersionId: "11111111-1111-4111-8111-111111111111",
        backtestable: true,
        reasonCode: null,
      }),
      expect.objectContaining({
        symbol: "VN30",
        datasetVersionId: null,
        backtestable: false,
        reasonCode: "DATASET_UNAVAILABLE",
      }),
    ]);
    expect(prisma.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 50,
        where: expect.objectContaining({
          market: { in: ["vn_equity", "crypto_spot", "metal_spot"] },
          OR: [
            { symbol: { contains: "VN", mode: "insensitive" } },
            { name: { startsWith: "VN", mode: "insensitive" } },
          ],
        }),
      }),
    );
  });

  it("distinguishes an insufficient immutable range from a missing dataset", async () => {
    prisma.asset.findMany.mockResolvedValue([
      {
        ...vnmAsset,
        datasets: [
          {
            versions: [
              {
                ...vnmAsset.datasets[0].versions[0],
                coverageStart: new Date("2025-06-01T00:00:00.000Z"),
              },
            ],
          },
        ],
      },
    ]);

    const result = await loadQuantAssetCatalog(
      { q: "", timeframe: "1d", from: "2025-01-01", to: "2026-01-01" },
      new Date("2026-01-02T12:00:00.000Z"),
    );

    expect(result.items[0]).toMatchObject({
      backtestable: false,
      reasonCode: "DATASET_RANGE_INSUFFICIENT",
    });
  });
});
