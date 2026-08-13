import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => {
  const tx = {
    portfolio: { findFirst: vi.fn() },
    quantRun: { findFirst: vi.fn() },
    portfolioPosition: { findUnique: vi.fn() },
    strategyAssignment: {
      updateMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    strategySignal: { create: vi.fn() },
    strategyForwardSnapshot: { create: vi.fn() },
    notification: { count: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
  };
  return { prisma: { ...tx, $transaction: vi.fn() } };
});

vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => prisma }));

import {
  applyStrategyAssignment,
  loadNotifications,
  loadStrategyForwardTests,
  markNotificationRead,
} from "./strategy-forward-tests";

const context = { organizationId: "org-a", userId: "user-a", role: "editor" as const };
const input = {
  symbol: "BTC",
  strategyCode: "custom:11111111-1111-4111-8111-111111111111",
  strategyVersion: "1.0.0",
  strategyParameters: {
    schemaVersion: 1,
    kind: "price_threshold",
    operator: "crosses_above",
    threshold: 50000,
    currency: "USD",
    action: "buy",
    sizePct: 25,
  },
  backtestRunId: "00000000-0000-4000-8000-000000000001",
  backtestRunLegId: "00000000-0000-4000-8000-000000000002",
};

describe("strategy forward activation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
      callback(prisma),
    );
    prisma.portfolio.findFirst.mockResolvedValue({ id: "portfolio-a", userId: "user-a" });
    prisma.quantRun.findFirst.mockResolvedValue({
      id: input.backtestRunId,
      status: "succeeded",
      timeframe: "1d",
      legs: [
        {
          id: input.backtestRunLegId,
          assetId: "asset-btc",
          symbolSnapshot: "BTC",
          currencySnapshot: "USD",
          parameters: input.strategyParameters,
          implementationHash: "a".repeat(64),
          initialNotional: 1000,
          metrics: { totalReturnPct: 18.5 },
          datasetVersionId: "dataset-v1",
          datasetVersion: {
            isActive: true,
            qualityStatus: "passed",
            bars: [{ ts: new Date("2026-08-12T00:00:00.000Z"), close: 50000 }],
          },
          strategyVersion: {
            id: "strategy-v1",
            code: input.strategyCode,
            version: input.strategyVersion,
            implementationHash: "a".repeat(64),
            status: "active",
            customStrategyVersion: { status: "active", customStrategy: { status: "active" } },
          },
        },
      ],
    });
    prisma.portfolioPosition.findUnique.mockResolvedValue({ quantity: 0, averageCost: 0 });
    prisma.strategyAssignment.updateMany.mockResolvedValue({ count: 0 });
    prisma.strategyAssignment.create.mockResolvedValue({ id: "assignment-a" });
    prisma.strategySignal.create.mockResolvedValue({ id: "initial-signal" });
    prisma.strategyForwardSnapshot.create.mockResolvedValue({ id: "snapshot-a" });
    prisma.strategyAssignment.findUnique.mockResolvedValue({
      id: "assignment-a",
      portfolioId: "portfolio-a",
      parameters: input.strategyParameters,
      status: "active",
      state: { backtestTotalReturnPct: 18.5, sourceQuantRunId: input.backtestRunId, sourceQuantRunLegId: input.backtestRunLegId },
      asset: { symbol: "BTC" },
      strategyVersion: { code: input.strategyCode, version: "1.0.0", name: "BTC entry" },
      signals: [],
    });
    prisma.notification.count.mockResolvedValue(0);
  });

  it("creates an initial snapshot without importing historical trades or notifying", async () => {
    await applyStrategyAssignment(context, input);

    expect(prisma.strategySignal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "INITIAL_SNAPSHOT",
        signalType: "buy",
        status: "reviewed",
        datasetVersionId: "dataset-v1",
      }),
    });
    expect(prisma.strategyForwardSnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assignmentId: "assignment-a",
        equity: 1000,
        cumulativeContributions: 0,
      }),
    });
    expect(prisma.strategyAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: expect.objectContaining({ backtestTotalReturnPct: 18.5 }),
        }),
      }),
    );
    expect(prisma.notification.count).not.toHaveBeenCalled();
  });

  it("fails closed when the source run is not a succeeded tenant run", async () => {
    prisma.quantRun.findFirst.mockResolvedValueOnce(null);

    await expect(applyStrategyAssignment(context, input)).rejects.toThrow("SOURCE_RUN_MISMATCH");
    expect(prisma.strategyAssignment.create).not.toHaveBeenCalled();
  });

  it("loads bounded tenant forward snapshots newest first", async () => {
    prisma.strategyAssignment.findMany = vi.fn().mockResolvedValue([
      {
        id: "assignment-a",
        portfolioId: "portfolio-a",
        status: "active",
        state: {
          backtestTotalReturnPct: 18.5,
          sourceQuantRunId: input.backtestRunId,
          sourceQuantRunLegId: input.backtestRunLegId,
        },
        activatedAt: new Date("2026-08-01T00:00:00Z"),
        lastEvaluatedAt: new Date("2026-08-12T00:00:00Z"),
        lastEvaluatedBarAt: new Date("2026-08-11T00:00:00Z"),
        asset: { symbol: "BTC" },
        strategyVersion: {
          code: input.strategyCode,
          version: "1.0.0",
          name: "BTC entry",
          category: "custom_rule",
        },
        signals: [],
        forwardSnapshots: [
          {
            barAt: new Date("2026-08-11T00:00:00Z"),
            equity: 1020,
            benchmarkEquity: 1010,
            pnlExcludingContributions: 20,
            cumulativeContributions: 0,
            cumulativeFees: 1,
          },
        ],
      },
    ]);

    const result = await loadStrategyForwardTests(context);

    expect(prisma.strategyAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-a",
          status: { in: ["active", "paused", "evaluation_failed"] },
        },
      }),
    );
    expect(result[0]).toMatchObject({
      assignmentId: "assignment-a",
      symbol: "BTC",
      status: "active",
      backtestBaseline: {
        runId: input.backtestRunId,
        legId: input.backtestRunLegId,
        totalReturnPct: 18.5,
      },
    });
    expect(result[0].snapshots[0].equity).toBe(1020);
  });

  it("loads and marks only the current user's tenant notifications", async () => {
    prisma.notification.count.mockResolvedValue(1);
    prisma.notification.findMany.mockResolvedValue([
      {
        id: "notice-a",
        type: "strategy_buy",
        title: "BUY BTC",
        body: "price_crosses_above",
        readAt: null,
        createdAt: new Date("2026-08-12T00:00:00Z"),
        signalId: "signal-a",
        assignmentId: "assignment-a",
      },
    ]);
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });

    const page = await loadNotifications(context);
    await markNotificationRead(context, "notice-a");

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a", userId: "user-a" }, take: 26 }),
    );
    expect(page).toMatchObject({ unreadCount: 1, nextCursor: null });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: "notice-a", organizationId: "org-a", userId: "user-a" },
      data: { readAt: expect.any(Date) },
    });
  });
});
