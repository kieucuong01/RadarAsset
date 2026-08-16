import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => {
  const client = {
    appUser: { findUnique: vi.fn() },
    organization: { findUnique: vi.fn() },
    portfolio: { findFirst: vi.fn() },
    portfolioTransaction: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    portfolioPosition: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    asset: { findUnique: vi.fn(), findMany: vi.fn() },
    dataset: { findMany: vi.fn() },
    marketBar: { findMany: vi.fn(), findFirst: vi.fn() },
    watchlistItem: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    marketIngestionRequest: { findMany: vi.fn() },
    aiInsight: { findMany: vi.fn(), create: vi.fn() },
    evidenceItem: { findMany: vi.fn(), create: vi.fn() },
    investmentThesis: { findFirst: vi.fn(), create: vi.fn() },
    forecastPoint: { findMany: vi.fn(), create: vi.fn() },
    providerRun: { create: vi.fn() },
    researchRun: {
      findMany: vi.fn(),
      create: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    quantRun: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    strategyVersion: { findUnique: vi.fn() },
    strategyAssignment: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    strategySignal: { createMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };

  return { prisma: client };
});

vi.mock("@/lib/db/prisma", () => ({
  getPrisma: () => prisma,
}));

import { createDefaultPortfolioAssumptions } from "@/lib/backtest/contracts";
import {
  createQuantRun,
  getQuantRun,
  loadAssets,
  loadMarketBars,
  listQuantRuns,
  loadTickerResponse,
  upsertStrategyAssignment,
} from "./db";
import {
  createPortfolioTransaction,
  loadPortfolioResponse,
  validateSourceSignalExecution,
} from "./portfolio-repository";
import {
  importResearchRun,
  loadAssetIntelligence,
  loadInsights,
  loadResearchRuns,
  loadWatchlist,
  removeWatchlistItem,
  upsertWatchlistItem,
} from "./research-repository";
import { getWorkerImportContext } from "./worker-context";

const viewerContext = {
  userId: "user-a",
  organizationId: "org-a",
  role: "viewer" as const,
};
const editorContext = { ...viewerContext, role: "editor" as const };
const defaultAssumptions = createDefaultPortfolioAssumptions(10, 5);

describe("organization-scoped database services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: (client: typeof prisma) => unknown) =>
      callback(prisma),
    );
    prisma.marketBar.findMany.mockResolvedValue([]);
    prisma.dataset.findMany.mockResolvedValue([]);
    prisma.aiInsight.findMany.mockResolvedValue([]);
    prisma.watchlistItem.findMany.mockResolvedValue([]);
    prisma.marketIngestionRequest.findMany.mockResolvedValue([]);
    prisma.researchRun.findMany.mockResolvedValue([]);
    prisma.quantRun.findMany.mockResolvedValue([]);
    prisma.strategyVersion.findUnique.mockResolvedValue({
      id: "strategy-version-1",
      code: "ma_crossover",
      version: "1.0.0",
      name: "MA Crossover",
    });
  });

  it("scopes portfolio selection to the server organization", async () => {
    prisma.portfolio.findFirst.mockResolvedValue(null);

    await expect(loadPortfolioResponse(viewerContext)).rejects.toThrow("Portfolio not found.");

    expect(prisma.portfolio.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-a" },
      }),
    );
  });

  it("scopes transaction portfolio lookup before writing", async () => {
    prisma.portfolio.findFirst.mockResolvedValue(null);

    await expect(
      createPortfolioTransaction(editorContext, {
        symbol: "BTC",
        type: "buy",
        quantity: 1,
        price: 100,
      }),
    ).rejects.toThrow("Portfolio not found.");

    expect(prisma.portfolio.findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org-a" },
      select: { id: true, organizationId: true },
    });
    expect(prisma.portfolioTransaction.create).not.toHaveBeenCalled();
  });

  it("validates a source signal against portfolio, asset, side, and terminal state", () => {
    const signal = {
      status: "suggested",
      signalType: "buy",
      assetId: "asset-btc",
      assignment: { portfolioId: "portfolio-a" },
    };

    expect(() =>
      validateSourceSignalExecution(signal, {
        portfolioId: "portfolio-a",
        assetId: "asset-btc",
        side: "buy",
      }),
    ).not.toThrow();
    expect(() =>
      validateSourceSignalExecution(
        { ...signal, signalType: "sell" },
        {
          portfolioId: "portfolio-a",
          assetId: "asset-btc",
          side: "buy",
        },
      ),
    ).toThrow("SIGNAL_SIDE_MISMATCH");
    expect(() =>
      validateSourceSignalExecution(
        { ...signal, status: "executed" },
        {
          portfolioId: "portfolio-a",
          assetId: "asset-btc",
          side: "buy",
        },
      ),
    ).toThrow("SIGNAL_ALREADY_ACTED");
  });

  it("ranks assets with active datasets first for portfolio buy selection", async () => {
    prisma.asset.findMany.mockResolvedValue([
      {
        id: "asset-aaa",
        symbol: "AAA",
        name: "Catalog Only",
        assetClass: "crypto",
        currency: "USDT",
        provider: "binance-public",
        providerSymbol: "AAAUSDT",
        datasets: [],
      },
      {
        id: "asset-xau",
        symbol: "XAU",
        name: "Gold Spot / US Dollar",
        assetClass: "commodity",
        currency: "USD",
        provider: "msn-via-vnstock",
        providerSymbol: "XAUUSD",
        datasets: [{ versions: [{ id: "dataset-xau" }] }],
      },
    ]);

    await expect(loadAssets()).resolves.toEqual([
      expect.objectContaining({ symbol: "XAU" }),
      expect.objectContaining({ symbol: "AAA" }),
    ]);
    expect(prisma.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
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

  it("uses active dataset bars for public market reads when the compatibility projection is empty", async () => {
    prisma.asset.findUnique.mockResolvedValue({
      id: "asset-btc",
      symbol: "BTC",
      name: "Bitcoin",
      assetClass: "crypto",
    });
    prisma.dataset.findMany.mockResolvedValue([
      {
        assetId: "asset-btc",
        asset: {
          id: "asset-btc",
          symbol: "BTC",
          name: "Bitcoin",
          assetClass: "crypto",
        },
        versions: [
          {
            bars: [
              {
                ts: new Date("2026-08-10T00:00:00.000Z"),
                open: 100,
                high: 110,
                low: 90,
                close: 100,
                volume: 10,
                source: "binance-public-spot",
              },
              {
                ts: new Date("2026-08-11T00:00:00.000Z"),
                open: 100,
                high: 125,
                low: 95,
                close: 120,
                volume: 12,
                source: "binance-public-spot",
              },
            ],
          },
        ],
      },
    ]);

    const [ticker] = await loadTickerResponse(["BTC"]);
    const bars = await loadMarketBars("BTC", "1d");

    expect(ticker).toMatchObject({
      symbol: "BTC",
      price: 120,
      changePercent: 20,
    });
    expect(bars.bars).toEqual([
      expect.objectContaining({ close: 100, source: "binance-public-spot" }),
      expect.objectContaining({ close: 120, source: "binance-public-spot" }),
    ]);
    expect(prisma.marketBar.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ timeframe: "1d" }) }),
    );
    expect(prisma.dataset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          timeframe: "1d",
          adjustmentPolicy: "raw",
        }),
      }),
    );
    expect(prisma.dataset.findMany.mock.calls[0][0].select.versions.select.bars).toEqual(
      expect.objectContaining({
        orderBy: { ts: "desc" },
        take: 2,
      }),
    );
  });

  it("scopes watchlist reads and compound-key writes", async () => {
    prisma.asset.findUnique.mockResolvedValue({ id: "asset-btc" });
    prisma.watchlistItem.upsert.mockResolvedValue({ id: "watch-1" });

    await loadWatchlist(viewerContext);
    await upsertWatchlistItem(editorContext, { symbol: "BTC", alert: 70000 });

    expect(prisma.watchlistItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-a", userId: "user-a" },
        include: expect.objectContaining({
          asset: expect.objectContaining({
            include: expect.objectContaining({
              datasets: expect.objectContaining({
                select: expect.objectContaining({
                  versions: expect.objectContaining({
                    where: { isActive: true, qualityStatus: { in: ["passed", "warning"] } },
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    );
    expect(prisma.aiInsight.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ researchRunId: null }, { researchRun: { organizationId: "org-a" } }],
        },
      }),
    );
    expect(prisma.watchlistItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_userId_assetId: {
            organizationId: "org-a",
            userId: "user-a",
            assetId: "asset-btc",
          },
        },
        create: expect.objectContaining({
          organizationId: "org-a",
          userId: "user-a",
        }),
      }),
    );
  });

  it("keeps polling while another requested timeframe is still active", async () => {
    prisma.watchlistItem.findMany.mockResolvedValue([
      {
        id: "watch-eth",
        alert: null,
        asset: {
          id: "asset-eth",
          symbol: "ETH",
          name: "Ethereum",
          datasets: [
            { timeframe: "1d", versions: [{ id: "eth-1d" }] },
            { timeframe: "1h", versions: [] },
          ],
        },
      },
    ]);
    prisma.marketIngestionRequest.findMany.mockResolvedValue([
      {
        id: "request-eth-1h",
        status: "running",
        createdAt: new Date("2026-08-11T00:00:00Z"),
        providerInstrument: { assetId: "asset-eth" },
      },
    ]);

    await expect(loadWatchlist(viewerContext)).resolves.toEqual([
      expect.objectContaining({
        sym: "ETH",
        datasetState: "loading",
        ingestionRequestId: "request-eth-1h",
        backtestableTimeframes: ["1d"],
      }),
    ]);
  });

  it("removes only the tenant and user owned watchlist row", async () => {
    prisma.watchlistItem.deleteMany.mockResolvedValue({ count: 1 });

    await expect(removeWatchlistItem(editorContext, "favorite-a")).resolves.toBe(true);
    expect(prisma.watchlistItem.deleteMany).toHaveBeenCalledWith({
      where: { id: "favorite-a", organizationId: "org-a", userId: "user-a" },
    });
  });

  it("scopes research listing and worker imports", async () => {
    prisma.researchRun.create.mockResolvedValue({ id: "research-1" });
    prisma.researchRun.findUniqueOrThrow.mockResolvedValue({
      id: "research-1",
      source: "worker",
      kind: "sentiment",
      status: "succeeded",
      summary: null,
      parameters: {},
      startedAt: null,
      finishedAt: null,
      createdAt: new Date("2026-01-01"),
      asset: null,
    });

    await loadResearchRuns(viewerContext);
    await importResearchRun(
      { organizationId: "service-org", userId: null },
      { source: "worker", kind: "sentiment" },
    );

    expect(prisma.researchRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-a" },
      }),
    );
    expect(prisma.researchRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "service-org",
          userId: null,
        }),
      }),
    );
  });

  it("scopes quant create, list, and detail operations", async () => {
    prisma.asset.findMany.mockResolvedValue([
      {
        symbol: "BTC",
        maxLeverage: 1,
        datasets: [{ versions: [{ id: "dataset-btc-1d-v1" }] }],
      },
    ]);
    prisma.quantRun.create.mockResolvedValue({
      id: "run-1",
      strategyName: "MA Crossover Backtest",
      status: "queued",
      timeframe: "1d",
      progress: 0,
      strategyHash: "hash",
      datasetVersionIds: ["dataset-btc-1d-v1"],
      engineVersion: "ma-cross-v1",
      parameters: {
        timeframe: "1d",
        totalCapital: 10000,
        allocationMode: "equal",
        feeBps: 10,
        slippageBps: 5,
        from: "2024-01-01",
        to: "2025-01-01",
        legs: [
          {
            symbol: "BTC",
            allocationBps: 10000,
            leverage: 1,
            strategyCode: "ma_crossover",
            strategyVersion: "1.0.0",
            strategyParameters: { fastPeriod: 5, slowPeriod: 20 },
          },
        ],
      },
      metrics: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      createdAt: new Date("2026-01-01"),
      artifacts: [],
    });
    prisma.quantRun.findFirst.mockResolvedValue(null);

    await createQuantRun(editorContext, {
      timeframe: "1d",
      totalCapital: 10000,
      allocationMode: "equal",
      feeBps: 10,
      slippageBps: 5,
      assumptions: defaultAssumptions,
      from: "2024-01-01",
      to: "2025-01-01",
      legs: [
        {
          symbol: "BTC",
          allocationBps: 10000,
          leverage: 1,
          strategyCode: "ma_crossover",
          strategyVersion: "1.0.0",
          strategyParameters: { fastPeriod: 5, slowPeriod: 20 },
        },
      ],
    });
    await listQuantRuns(viewerContext);
    await expect(getQuantRun(viewerContext, "run-other")).rejects.toThrow("Quant run not found.");

    expect(prisma.quantRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-a",
          userId: "user-a",
          strategyVersionId: "strategy-version-1",
        }),
      }),
    );
    expect(prisma.quantRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a" } }),
    );
    expect(prisma.quantRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-other", organizationId: "org-a" },
        include: expect.objectContaining({
          artifacts: expect.objectContaining({ where: { organizationId: "org-a" } }),
        }),
      }),
    );
  });

  it("fails closed when a requested strategy version is not synchronized", async () => {
    prisma.strategyVersion.findUnique.mockResolvedValue(null);

    await expect(
      createQuantRun(editorContext, {
        timeframe: "1d",
        totalCapital: 10000,
        allocationMode: "equal",
        feeBps: 10,
        slippageBps: 5,
        assumptions: defaultAssumptions,
        from: "2024-01-01",
        to: "2025-01-01",
        legs: [
          {
            symbol: "BTC",
            allocationBps: 10000,
            leverage: 1,
            strategyCode: "ma_crossover",
            strategyVersion: "1.0.0",
            strategyParameters: { fastPeriod: 5, slowPeriod: 20 },
          },
        ],
      }),
    ).rejects.toThrow("not synchronized");
    expect(prisma.asset.findMany).not.toHaveBeenCalled();
    expect(prisma.quantRun.create).not.toHaveBeenCalled();
  });

  it("fails closed before persistence when the legacy runner receives mixed strategies", async () => {
    await expect(
      createQuantRun(editorContext, {
        timeframe: "1d",
        totalCapital: 10000,
        allocationMode: "equal",
        feeBps: 10,
        slippageBps: 5,
        assumptions: defaultAssumptions,
        from: "2024-01-01",
        to: "2025-01-01",
        legs: [
          {
            symbol: "BTC",
            allocationBps: 5000,
            leverage: 1,
            strategyCode: "ma_crossover",
            strategyVersion: "1.0.0",
            strategyParameters: { fastPeriod: 5, slowPeriod: 20 },
          },
          {
            symbol: "FPT",
            allocationBps: 5000,
            leverage: 1,
            strategyCode: "turtle_breakout",
            strategyVersion: "1.0.0",
            strategyParameters: { entryPeriod: 20, exitPeriod: 10 },
          },
        ],
      }),
    ).rejects.toThrow("Mixed per-asset strategies are not available");
    expect(prisma.strategyVersion.findUnique).not.toHaveBeenCalled();
    expect(prisma.quantRun.create).not.toHaveBeenCalled();
  });

  it("upserts one tenant-scoped strategy assignment per portfolio asset", async () => {
    prisma.portfolio.findFirst.mockResolvedValue({ id: "portfolio-a", organizationId: "org-a" });
    prisma.asset.findUnique.mockResolvedValue({ id: "asset-btc", symbol: "BTC" });
    prisma.strategyVersion.findUnique.mockResolvedValue({
      id: "strategy-version-turtle",
      code: "turtle_breakout",
      version: "1.0.0",
      name: "Turtle Breakout",
    });
    prisma.strategyAssignment.findFirst.mockResolvedValue(null);
    prisma.strategyAssignment.create.mockResolvedValue({
      id: "assignment-1",
      portfolioId: "portfolio-a",
      assetId: "asset-btc",
      parameters: { entryPeriod: 20, exitPeriod: 10 },
      status: "active",
      asset: { symbol: "BTC" },
      strategyVersion: {
        code: "turtle_breakout",
        version: "1.0.0",
        name: "Turtle Breakout",
      },
      signals: [],
    });
    prisma.strategyAssignment.findUnique.mockResolvedValue(
      await prisma.strategyAssignment.create(),
    );

    const response = await upsertStrategyAssignment(editorContext, {
      symbol: "BTC",
      strategyCode: "turtle_breakout",
      strategyVersion: "1.0.0",
      strategyParameters: { entryPeriod: 20, exitPeriod: 10 },
    });

    expect(response).toMatchObject({
      id: "assignment-1",
      symbol: "BTC",
      strategyCode: "turtle_breakout",
      status: "active",
    });
    expect(prisma.strategyAssignment.findFirst).toHaveBeenCalledWith({
      where: { portfolioId: "portfolio-a", assetId: "asset-btc", status: "active" },
      select: { id: true },
    });
    expect(prisma.strategyAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: "org-a" }),
      }),
    );
  });

  it("loads signals only from the exact tenant-owned portfolio run leg", async () => {
    const runId = "00000000-0000-4000-8000-000000000001";
    const legId = "00000000-0000-4000-8000-000000000002";
    prisma.portfolio.findFirst.mockResolvedValue({ id: "portfolio-a", organizationId: "org-a" });
    prisma.asset.findUnique.mockResolvedValue({ id: "asset-btc", symbol: "BTC" });
    prisma.strategyVersion.findUnique.mockResolvedValue({
      id: "strategy-version-turtle",
      code: "turtle_breakout",
      version: "1.0.0",
      name: "Turtle Breakout",
    });
    prisma.quantRun.findFirst.mockResolvedValue({
      legs: [
        {
          id: legId,
          symbolSnapshot: "BTC",
          parameters: { entryPeriod: 20, exitPeriod: 10 },
          strategyVersion: { code: "turtle_breakout", version: "1.0.0" },
          artifacts: [{ payload: [] }],
        },
      ],
    });
    prisma.strategyAssignment.findFirst.mockResolvedValue(null);
    prisma.strategyAssignment.create.mockResolvedValue({
      id: "assignment-1",
      portfolioId: "portfolio-a",
      parameters: { entryPeriod: 20, exitPeriod: 10 },
      status: "active",
      asset: { symbol: "BTC" },
      strategyVersion: {
        code: "turtle_breakout",
        version: "1.0.0",
        name: "Turtle Breakout",
      },
      signals: [],
    });
    prisma.strategyAssignment.findUnique.mockResolvedValue(
      await prisma.strategyAssignment.create(),
    );

    await upsertStrategyAssignment(editorContext, {
      symbol: "BTC",
      strategyCode: "turtle_breakout",
      strategyVersion: "1.0.0",
      strategyParameters: { entryPeriod: 20, exitPeriod: 10 },
      backtestRunId: runId,
      backtestRunLegId: legId,
    });

    expect(prisma.quantRun.findFirst).toHaveBeenCalledWith({
      where: {
        id: runId,
        organizationId: "org-a",
        status: "succeeded",
        legs: {
          some: {
            id: legId,
            assetId: "asset-btc",
            strategyVersionId: "strategy-version-turtle",
          },
        },
      },
      select: {
        legs: {
          where: { id: legId },
          select: expect.objectContaining({
            artifacts: {
              where: {
                organizationId: "org-a",
                kind: "trades",
                scopeKey: `leg:${legId}`,
              },
              select: { payload: true },
            },
          }),
        },
      },
    });
  });

  it("resolves the worker organization only from server configuration", async () => {
    vi.stubEnv("QUANT_WORKER_ORGANIZATION_SLUG", "service-workspace");
    prisma.organization.findUnique.mockResolvedValue({ id: "service-org" });

    await expect(getWorkerImportContext()).resolves.toEqual({
      organizationId: "service-org",
      userId: null,
    });
    expect(prisma.organization.findUnique).toHaveBeenCalledWith({
      where: { slug: "service-workspace" },
      select: { id: true },
    });
    vi.unstubAllEnvs();
  });

  it("keeps tenant-owned research out of public intelligence loaders", async () => {
    prisma.asset.findUnique.mockResolvedValue({
      id: "asset-btc",
      symbol: "BTC",
      name: "Bitcoin",
    });
    prisma.marketBar.findFirst.mockResolvedValue(null);
    prisma.evidenceItem.findMany.mockResolvedValue([]);
    prisma.investmentThesis.findFirst.mockResolvedValue(null);
    prisma.forecastPoint.findMany.mockResolvedValue([]);

    await loadInsights();
    await loadAssetIntelligence("BTC");

    expect(prisma.aiInsight.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { researchRunId: null } }),
    );
    expect(prisma.aiInsight.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { assetId: "asset-btc", researchRunId: null },
      }),
    );
    expect(prisma.evidenceItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assetId: "asset-btc", researchRunId: null },
      }),
    );
    expect(prisma.investmentThesis.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assetId: "asset-btc", researchRunId: null },
      }),
    );
    expect(prisma.forecastPoint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assetId: "asset-btc", researchRunId: null },
      }),
    );
  });
});
