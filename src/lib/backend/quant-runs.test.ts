import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDefaultPortfolioAssumptions,
  type PortfolioBacktestSubmission,
} from "@/lib/backtest/contracts";

const { prisma } = vi.hoisted(() => {
  const client = {
    strategyVersion: { findMany: vi.fn() },
    asset: { findMany: vi.fn() },
    quantRun: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    quantRunLeg: { createMany: vi.fn(), updateMany: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return { prisma: client };
});

vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => prisma }));

import {
  PortfolioRunEligibilityError,
  cancelPortfolioQuantRun,
  createPortfolioQuantRun,
  listPortfolioQuantRuns,
  loadPortfolioQuantRun,
} from "./quant-runs";

const context = {
  organizationId: "organization-a",
  userId: "user-a",
  role: "editor" as const,
};

const submission: PortfolioBacktestSubmission = {
  timeframe: "1d",
  from: "2025-01-01",
  to: "2025-12-31",
  totalCapital: 100_000,
  allocationMode: "custom",
  feeBps: 10,
  slippageBps: 5,
  assumptions: {
    ...createDefaultPortfolioAssumptions(10, 5),
    cashAllocationBps: 1_000,
  },
  legs: [
    {
      symbol: "BTC",
      allocationBps: 6_000,
      leverage: 1,
      strategyCode: "turtle_breakout",
      strategyVersion: "1.0.0",
      strategyParameters: { entryPeriod: 20, exitPeriod: 10 },
    },
    {
      symbol: "VNM",
      allocationBps: 3_000,
      leverage: 2,
      strategyCode: "ma_crossover",
      strategyVersion: "1.0.0",
      strategyParameters: { fastPeriod: 5, slowPeriod: 20 },
    },
  ],
};

const strategies = [
  {
    id: "strategy-turtle",
    code: "turtle_breakout",
    version: "1.0.0",
    name: "Turtle Breakout",
    status: "active",
    implementationHash: "a".repeat(64),
    supportedMarkets: ["crypto_spot", "vn_equity"],
    supportedTimeframes: ["1d", "1h"],
  },
  {
    id: "strategy-ma",
    code: "ma_crossover",
    version: "1.0.0",
    name: "MA Crossover",
    status: "active",
    implementationHash: "b".repeat(64),
    supportedMarkets: ["vn_equity", "crypto_spot", "metal_spot"],
    supportedTimeframes: ["1d", "1h"],
  },
];

function dataset(id: string, checksum: string) {
  return {
    id,
    checksum,
    coverageStart: new Date("2024-01-01T00:00:00.000Z"),
    coverageEnd: new Date("2026-01-31T00:00:00.000Z"),
    rowCount: 500,
  };
}

const assets = [
  {
    id: "asset-btc",
    symbol: "BTC",
    market: "crypto_spot",
    currency: "USDT",
    maxLeverage: 1,
    datasets: [{ versions: [dataset("dataset-btc", "c".repeat(64))] }],
  },
  {
    id: "asset-vnm",
    symbol: "VNM",
    market: "vn_equity",
    currency: "VND",
    maxLeverage: 2,
    datasets: [{ versions: [dataset("dataset-vnm", "d".repeat(64))] }],
  },
];

function runRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    strategyName: "Portfolio Backtest",
    strategyVersion: null,
    status: "queued",
    timeframe: "1d",
    progress: 0,
    strategyHash: "e".repeat(64),
    datasetVersionIds: ["dataset-btc", "dataset-vnm"],
    engineVersion: "portfolio-v1",
    parameters: submission,
    metrics: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date("2026-08-11T00:00:00.000Z"),
    artifacts: [],
    legs: [
      {
        id: "leg-btc",
        symbolSnapshot: "BTC",
        marketSnapshot: "crypto_spot",
        currencySnapshot: "USDT",
        allocationBps: 6_000,
        initialNotional: 60_000,
        leverage: 1,
        parameters: { entryPeriod: 20, exitPeriod: 10 },
        implementationHash: "a".repeat(64),
        datasetVersionId: "dataset-btc",
        status: "queued",
        progress: 0,
        metrics: null,
        errorCode: null,
        strategyVersion: {
          code: "turtle_breakout",
          version: "1.0.0",
          name: "Turtle Breakout",
        },
      },
      {
        id: "leg-vnm",
        symbolSnapshot: "VNM",
        marketSnapshot: "vn_equity",
        currencySnapshot: "VND",
        allocationBps: 3_000,
        initialNotional: 30_000,
        leverage: 2,
        parameters: { fastPeriod: 5, slowPeriod: 20 },
        implementationHash: "b".repeat(64),
        datasetVersionId: "dataset-vnm",
        status: "queued",
        progress: 0,
        metrics: null,
        errorCode: null,
        strategyVersion: { code: "ma_crossover", version: "1.0.0", name: "MA Crossover" },
      },
    ],
    ...overrides,
  };
}

describe("portfolio quant run persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
      callback(prisma),
    );
    prisma.strategyVersion.findMany.mockResolvedValue(strategies);
    prisma.asset.findMany.mockResolvedValue(assets);
    prisma.quantRun.create.mockResolvedValue({ id: "run-1" });
    prisma.quantRunLeg.createMany.mockResolvedValue({ count: 2 });
    prisma.quantRun.findFirst.mockImplementation(
      ({ where }: { where?: { id?: string; status?: string | { in: string[] } } }) =>
        Promise.resolve(where?.id ? runRecord() : null),
    );
    prisma.quantRun.findMany.mockResolvedValue([runRecord()]);
    prisma.quantRun.updateMany.mockResolvedValue({ count: 1 });
    prisma.quantRunLeg.updateMany.mockResolvedValue({ count: 2 });
    prisma.$executeRaw.mockResolvedValue(1);
  });

  it("creates one aggregate run and every independently resolved leg in one transaction", async () => {
    const result = await createPortfolioQuantRun(context, submission);

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.$executeRaw).toHaveBeenCalledOnce();
    expect(prisma.quantRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "organization-a",
          userId: "user-a",
          strategyVersionId: null,
          strategyName: "Portfolio Backtest",
          datasetVersionIds: ["dataset-btc", "dataset-vnm"],
          parameters: submission,
        }),
      }),
    );
    expect(prisma.quantRunLeg.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          quantRunId: "run-1",
          assetId: "asset-btc",
          datasetVersionId: "dataset-btc",
          strategyVersionId: "strategy-turtle",
          symbolSnapshot: "BTC",
          allocationBps: 6_000,
          initialNotional: 60_000,
        }),
        expect.objectContaining({
          quantRunId: "run-1",
          assetId: "asset-vnm",
          datasetVersionId: "dataset-vnm",
          strategyVersionId: "strategy-ma",
          symbolSnapshot: "VNM",
          allocationBps: 3_000,
          initialNotional: 30_000,
        }),
      ],
    });
    expect(result.legs.map((leg) => leg.symbol)).toEqual(["BTC", "VNM"]);
    expect(result).toMatchObject({ cacheHit: false, sourceRunId: null });
  });

  it("reuses only a succeeded fingerprint from the active organization", async () => {
    prisma.quantRun.findFirst.mockResolvedValueOnce(
      runRecord({ status: "succeeded", progress: 100, finishedAt: new Date() }),
    );

    const result = await createPortfolioQuantRun(context, submission);

    expect(prisma.quantRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "organization-a",
          status: { in: ["queued", "running", "succeeded"] },
          engineVersion: "portfolio-v1",
          strategyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(prisma.quantRun.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: "run-1", cacheHit: true, sourceRunId: "run-1" });
  });

  it("serializes cache lookup and creation by tenant fingerprint", async () => {
    await createPortfolioQuantRun(context, submission);

    expect(prisma.$executeRaw).toHaveBeenCalledOnce();
    expect(prisma.quantRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "organization-a",
          strategyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.quantRun.findFirst.mock.invocationCallOrder[0],
    );
  });

  it("cancels a queued run immediately inside the active organization", async () => {
    prisma.quantRun.findFirst
      .mockResolvedValueOnce(runRecord({ status: "queued" }))
      .mockResolvedValueOnce(
        runRecord({ status: "cancelled", progress: 100, finishedAt: new Date() }),
      );

    const result = await cancelPortfolioQuantRun(context, "run-1");

    expect(prisma.quantRun.updateMany).toHaveBeenCalledWith({
      where: { id: "run-1", organizationId: "organization-a", status: "queued" },
      data: expect.objectContaining({ status: "cancelled", progress: 100 }),
    });
    expect(prisma.quantRunLeg.updateMany).toHaveBeenCalledWith({
      where: { quantRunId: "run-1", status: "queued" },
      data: expect.objectContaining({ status: "cancelled", progress: 100 }),
    });
    expect(result.status).toBe("cancelled");
  });

  it("requests cooperative cancellation for an owned running run", async () => {
    prisma.quantRun.findFirst
      .mockResolvedValueOnce(runRecord({ status: "running" }))
      .mockResolvedValueOnce(runRecord({ status: "cancel_requested" }));

    const result = await cancelPortfolioQuantRun(context, "run-1");

    expect(prisma.quantRun.updateMany).toHaveBeenCalledWith({
      where: { id: "run-1", organizationId: "organization-a", status: "running" },
      data: expect.objectContaining({ status: "cancel_requested" }),
    });
    expect(result.status).toBe("cancel_requested");
  });

  it("does not lose cancellation when a queued run is claimed concurrently", async () => {
    prisma.quantRun.findFirst
      .mockResolvedValueOnce(runRecord({ status: "queued" }))
      .mockResolvedValueOnce(runRecord({ status: "cancel_requested" }));
    prisma.quantRun.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    const result = await cancelPortfolioQuantRun(context, "run-1");

    expect(prisma.quantRun.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "run-1", organizationId: "organization-a", status: "running" },
      data: expect.objectContaining({ status: "cancel_requested" }),
    });
    expect(prisma.quantRunLeg.updateMany).not.toHaveBeenCalled();
    expect(result.status).toBe("cancel_requested");
  });

  it("rejects unavailable adjusted-price datasets before opening a transaction", async () => {
    prisma.asset.findMany.mockResolvedValue(assets.map((asset) => ({ ...asset, datasets: [] })));
    const adjusted = {
      ...submission,
      assumptions: { ...submission.assumptions, dividendMode: "adjusted_prices" as const },
    };

    await expect(createPortfolioQuantRun(context, adjusted)).rejects.toMatchObject({
      code: "DATASET_UNAVAILABLE",
    });
    expect(prisma.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          datasets: expect.objectContaining({
            where: expect.objectContaining({ adjustmentPolicy: "total_return" }),
            select: expect.objectContaining({
              versions: expect.objectContaining({
                where: { isActive: true, qualityStatus: { in: ["passed", "warning"] } },
              }),
            }),
          }),
        }),
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.quantRun.create).not.toHaveBeenCalled();
  });

  it("enforces the resolved market leverage cap before writes", async () => {
    const overleveraged = {
      ...submission,
      legs: submission.legs.map((leg) => (leg.symbol === "BTC" ? { ...leg, leverage: 1.5 } : leg)),
    };

    await expect(createPortfolioQuantRun(context, overleveraged)).rejects.toEqual(
      expect.objectContaining<Partial<PortfolioRunEligibilityError>>({
        code: "LEVERAGE_LIMIT_EXCEEDED",
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("resolves an owned custom strategy as an immutable rule rather than caller parameters", async () => {
    const rule = {
      schemaVersion: 1,
      kind: "price_threshold" as const,
      operator: "crosses_above" as const,
      threshold: 50_000,
      currency: "USD" as const,
      action: "buy" as const,
      sizePct: 25,
    };
    const customCode = "custom:3b3e1f9d-84bc-4ce7-8f0a-f3594930b6b8";
    prisma.strategyVersion.findMany.mockResolvedValueOnce([
      {
        id: "custom-execution-a",
        code: customCode,
        version: "1.0.0",
        name: "BTC entry",
        status: "active",
        organizationId: "organization-a",
        implementationHash: "c".repeat(64),
        supportedMarkets: ["crypto_spot"],
        supportedTimeframes: ["1d"],
        customStrategyVersion: {
          status: "active",
          ruleDefinition: rule,
          customStrategy: { status: "active" },
        },
      },
    ]);
    prisma.asset.findMany.mockResolvedValueOnce([assets[0]]);
    const customSubmission: PortfolioBacktestSubmission = {
      ...submission,
      assumptions: { ...submission.assumptions, cashAllocationBps: 0 },
      legs: [
        {
          ...submission.legs[0],
          allocationBps: 10_000,
          strategyCode: customCode,
          strategyVersion: "1.0.0",
          strategyParameters: {},
        },
      ],
    };

    await createPortfolioQuantRun(context, customSubmission);

    expect(prisma.strategyVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [{ OR: [{ organizationId: null }, { organizationId: "organization-a" }] }],
        }),
      }),
    );
    expect(prisma.quantRunLeg.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ strategyVersionId: "custom-execution-a", parameters: rule }),
      ],
    });
  });

  it("scopes list and detail reads including artifacts to the active organization", async () => {
    await listPortfolioQuantRuns({ ...context, role: "viewer" });
    await loadPortfolioQuantRun({ ...context, role: "viewer" }, "run-1");

    expect(prisma.quantRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "organization-a" } }),
    );
    expect(prisma.quantRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-1", organizationId: "organization-a" },
        include: expect.objectContaining({
          artifacts: expect.objectContaining({ where: { organizationId: "organization-a" } }),
        }),
      }),
    );
  });

  it("returns QuantStats artifacts published by a completed worker run", async () => {
    prisma.quantRun.findFirst.mockResolvedValueOnce(
      runRecord({
        status: "succeeded",
        progress: 100,
        artifacts: [
          {
            id: "artifact-analytics",
            quantRunLegId: null,
            scopeKey: "aggregate",
            kind: "analytics",
            checksum: "a".repeat(64),
            payload: { sharpe: 1.2 },
            rowCount: 1,
            schemaVersion: 1,
          },
          {
            id: "artifact-report",
            quantRunLegId: null,
            scopeKey: "aggregate",
            kind: "report_html",
            checksum: "b".repeat(64),
            payload: "<html></html>",
            rowCount: 1,
            schemaVersion: 1,
          },
        ],
      }),
    );

    const result = await loadPortfolioQuantRun(context, "run-1");

    expect(result.artifacts.map((artifact) => artifact.kind)).toEqual(["analytics", "report_html"]);
  });
});
