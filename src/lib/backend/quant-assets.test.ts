import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: {
    asset: { findMany: vi.fn(), groupBy: vi.fn() },
    dataset: { findMany: vi.fn() },
    providerInstrument: { count: vi.fn() },
    marketIngestionRequest: { groupBy: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    $queryRaw: vi.fn(),
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
  listingStatus: "active",
  datasets: [
    {
      adjustmentPolicy: "raw",
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
  listingStatus: "inactive",
  datasets: [],
};

describe("supported Quant asset catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.asset.findMany.mockResolvedValue([]);
    prisma.asset.groupBy.mockResolvedValue([]);
    prisma.dataset.findMany.mockResolvedValue([]);
    prisma.providerInstrument.count.mockResolvedValue(0);
    prisma.marketIngestionRequest.groupBy.mockResolvedValue([]);
    prisma.marketIngestionRequest.findFirst.mockResolvedValue(null);
    prisma.marketIngestionRequest.findMany.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([]);
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
        listingStatus: "active",
        availableAdjustments: ["raw"],
      }),
      expect.objectContaining({
        symbol: "VN30",
        datasetVersionId: null,
        backtestable: false,
        reasonCode: "DATASET_UNAVAILABLE",
        listingStatus: "inactive",
        availableAdjustments: [],
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

  it("preserves inactive instruments in the catalog and exposes raw versus adjusted availability", async () => {
    prisma.asset.findMany.mockResolvedValue([
      {
        ...vnmAsset,
        listingStatus: "inactive",
        datasets: [
          vnmAsset.datasets[0],
          {
            adjustmentPolicy: "total_return",
            versions: [
              {
                ...vnmAsset.datasets[0].versions[0],
                id: "22222222-2222-4222-8222-222222222222",
              },
            ],
          },
        ],
      },
    ]);

    const result = await loadQuantAssetCatalog(
      { q: "VNM", timeframe: "1d", from: "2025-01-01", to: "2026-01-01" },
      new Date("2026-01-02T12:00:00.000Z"),
    );

    expect(result.items[0]).toMatchObject({
      listingStatus: "inactive",
      availableAdjustments: ["raw", "total_return"],
    });
  });

  it("distinguishes an insufficient immutable range from a missing dataset", async () => {
    prisma.asset.findMany.mockResolvedValue([
      {
        ...vnmAsset,
        datasets: [
          {
            adjustmentPolicy: "raw",
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
      {
        timeframe: "1d",
        asset: { market: "vn_equity" },
        versions: [
          {
            coverageEnd: new Date("2026-08-13T17:00:00Z"),
            missingBarCount: 2,
            sourceMetadata: { mode: "live" },
          },
        ],
      },
      {
        timeframe: "1d",
        asset: { market: "vn_equity" },
        versions: [
          {
            coverageEnd: new Date("2026-08-13T17:00:00Z"),
            missingBarCount: 0,
            sourceMetadata: { mode: "live" },
          },
        ],
      },
      {
        timeframe: "1h",
        asset: { market: "crypto_spot" },
        versions: [
          {
            coverageEnd: new Date("2026-08-14T11:00:00Z"),
            missingBarCount: 1,
            sourceMetadata: { mode: "live" },
          },
        ],
      },
    ]);
    prisma.providerInstrument.count.mockResolvedValue(418);
    prisma.marketIngestionRequest.groupBy.mockResolvedValue([
      { status: "queued", timeframe: "1d", _count: { _all: 398 } },
      { status: "running", timeframe: "1h", _count: { _all: 2 } },
      { status: "succeeded", timeframe: "1h", _count: { _all: 13 } },
    ]);
    prisma.marketIngestionRequest.findFirst.mockResolvedValue({
      createdAt: new Date("2026-08-14T09:00:00Z"),
    });
    prisma.marketIngestionRequest.findMany.mockResolvedValue([
      { errorCode: null, providerInstrument: { provider: { code: "vnstock-vci-free" } } },
      { errorCode: null, providerInstrument: { provider: { code: "vnstock-vci-free" } } },
      { errorCode: null, providerInstrument: { provider: { code: "binance-public" } } },
    ]);
    prisma.$queryRaw.mockResolvedValue([
      {
        command: "hourly",
        status: "succeeded",
        started_at: new Date("2026-08-14T10:00:00Z"),
        finished_at: new Date("2026-08-14T10:30:00Z"),
        error_code: null,
      },
    ]);

    const result = await loadQuantDataReadiness(
      { userId: "user-a", organizationId: "org-a", role: "viewer" },
      new Date("2026-08-14T12:00:00Z"),
    );

    expect(result.readyForBacktest).toBe(false);
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
    expect(result).toMatchObject({
      expectedDatasetCount: 836,
      missingDatasetCount: 833,
      staleDatasetCount: 0,
      missingBarCount: 3,
      oldestBacklogAt: "2026-08-14T09:00:00.000Z",
      lastSchedulerSuccessAt: "2026-08-14T10:30:00.000Z",
      latestSchedulerRun: {
        command: "hourly",
        status: "succeeded",
        startedAt: "2026-08-14T10:00:00.000Z",
        finishedAt: "2026-08-14T10:30:00.000Z",
        errorCode: null,
      },
      recentProviderFailures: [
        { providerCode: "binance-public", errorCode: "unknown", count: 1 },
        { providerCode: "vnstock-vci-free", errorCode: "unknown", count: 2 },
      ],
    });
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
