import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => {
  const tx = {
    portfolio: { findFirst: vi.fn() },
    quantRun: { findFirst: vi.fn() },
    portfolioPosition: { findUnique: vi.fn() },
    strategyAssignment: { updateMany: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
    strategySignal: { create: vi.fn() },
    strategyForwardSnapshot: { create: vi.fn() },
    notification: { count: vi.fn() },
  };
  return { prisma: { ...tx, $transaction: vi.fn() } };
});

vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => prisma }));

import { applyStrategyAssignment } from "./strategy-forward-tests";

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
    expect(prisma.notification.count).not.toHaveBeenCalled();
  });

  it("fails closed when the source run is not a succeeded tenant run", async () => {
    prisma.quantRun.findFirst.mockResolvedValueOnce(null);

    await expect(applyStrategyAssignment(context, input)).rejects.toThrow("SOURCE_RUN_MISMATCH");
    expect(prisma.strategyAssignment.create).not.toHaveBeenCalled();
  });
});
