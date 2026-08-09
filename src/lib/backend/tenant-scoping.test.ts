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
    asset: { findUnique: vi.fn() },
    marketBar: { findMany: vi.fn(), findFirst: vi.fn() },
    watchlistItem: { findMany: vi.fn(), upsert: vi.fn() },
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
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };

  return { prisma: client };
});

vi.mock("@/lib/db/prisma", () => ({
  getPrisma: () => prisma,
}));

import {
  createPortfolioTransaction,
  createQuantRun,
  getQuantRun,
  importResearchRun,
  listQuantRuns,
  loadAssetIntelligence,
  loadInsights,
  loadPortfolioResponse,
  loadResearchRuns,
  loadWatchlist,
  upsertWatchlistItem,
} from "./db";
import { getWorkerImportContext } from "./worker-context";

const viewerContext = {
  userId: "user-a",
  organizationId: "org-a",
  role: "viewer" as const,
};
const editorContext = { ...viewerContext, role: "editor" as const };

describe("organization-scoped database services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: (client: typeof prisma) => unknown) =>
      callback(prisma),
    );
    prisma.marketBar.findMany.mockResolvedValue([]);
    prisma.aiInsight.findMany.mockResolvedValue([]);
    prisma.watchlistItem.findMany.mockResolvedValue([]);
    prisma.researchRun.findMany.mockResolvedValue([]);
    prisma.quantRun.findMany.mockResolvedValue([]);
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

  it("scopes watchlist reads and compound-key writes", async () => {
    prisma.asset.findUnique.mockResolvedValue({ id: "asset-btc" });
    prisma.watchlistItem.upsert.mockResolvedValue({ id: "watch-1" });

    await loadWatchlist(viewerContext);
    await upsertWatchlistItem(editorContext, { symbol: "BTC", alert: 70000 });

    expect(prisma.watchlistItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-a", userId: "user-a" },
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
    prisma.quantRun.create.mockResolvedValue({
      id: "run-1",
      strategyName: "Momentum",
      status: "queued",
      parameters: {},
      metrics: null,
      errorMessage: null,
    });
    prisma.quantRun.findFirst.mockResolvedValue(null);

    await createQuantRun(editorContext, { strategyName: "Momentum" });
    await listQuantRuns(viewerContext);
    await expect(getQuantRun(viewerContext, "run-other")).rejects.toThrow("Quant run not found.");

    expect(prisma.quantRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-a",
          userId: "user-a",
        }),
      }),
    );
    expect(prisma.quantRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a" } }),
    );
    expect(prisma.quantRun.findFirst).toHaveBeenCalledWith({
      where: { id: "run-other", organizationId: "org-a" },
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
