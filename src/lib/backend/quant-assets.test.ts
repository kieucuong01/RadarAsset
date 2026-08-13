import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: {
    asset: { findMany: vi.fn(), groupBy: vi.fn() },
    dataset: { findMany: vi.fn() },
    marketIngestionRequest: { groupBy: vi.fn() },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => prisma }));

import { loadQuantAssetCatalog, loadQuantDataReadiness } from "./quant-assets";

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
    prisma.asset.groupBy.mockResolvedValue([]);
    prisma.dataset.findMany.mockResolvedValue([]);
    prisma.marketIngestionRequest.groupBy.mockResolvedValue([]);
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
        take: 500,
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

  it("summarizes global dataset coverage and tenant-scoped ingestion backlog", async () => {
    prisma.asset.groupBy.mockResolvedValue([
      { market: "vn_equity", _count: { _all: 404 } },
      { market: "crypto_spot", _count: { _all: 13 } },
      { market: "metal_spot", _count: { _all: 1 } },
    ]);
    prisma.dataset.findMany.mockResolvedValue([
      { timeframe: "1d", asset: { market: "vn_equity" } },
      { timeframe: "1d", asset: { market: "vn_equity" } },
      { timeframe: "1h", asset: { market: "crypto_spot" } },
    ]);
    prisma.marketIngestionRequest.groupBy.mockResolvedValue([
      { status: "queued", timeframe: "1d", _count: { _all: 398 } },
      { status: "running", timeframe: "1h", _count: { _all: 2 } },
      { status: "succeeded", timeframe: "1h", _count: { _all: 13 } },
    ]);

    const result = await loadQuantDataReadiness({
      userId: "user-a",
      organizationId: "org-a",
      role: "viewer",
    });

    expect(result.readyForBacktest).toBe(true);
    expect(result.instrumentsByMarket).toEqual({
      vn_equity: 404,
      crypto_spot: 13,
      metal_spot: 1,
    });
    expect(result.activeDatasetsByMarketTimeframe).toContainEqual({
      market: "vn_equity",
      timeframe: "1d",
      count: 2,
    });
    expect(result.ingestionRequestsByStatusTimeframe).toContainEqual({
      status: "queued",
      timeframe: "1d",
      count: 398,
    });
    expect(result.backlogCount).toBe(400);
    expect(prisma.marketIngestionRequest.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-a" },
      }),
    );
  });

  it("accepts active warning datasets and ranks eligible assets before unavailable catalog rows", async () => {
    prisma.asset.findMany.mockResolvedValue([vn30Asset, vnmAsset]);

    const result = await loadQuantAssetCatalog(
      { q: "", timeframe: "1d", from: "2025-01-01", to: "2026-01-01" },
      new Date("2026-01-02T12:00:00.000Z"),
    );

    expect(result.items[0]).toMatchObject({
      symbol: "VNM",
      backtestable: true,
      reasonCode: null,
    });
    expect(prisma.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 500,
        select: expect.objectContaining({
          datasets: expect.objectContaining({
            select: expect.objectContaining({
              versions: expect.objectContaining({
                where: { isActive: true, qualityStatus: { in: ["passed", "warning"] } },
              }),
            }),
          }),
        }),
      }),
    );
  });
});
