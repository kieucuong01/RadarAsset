import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => ({ prisma: { asset: { findMany: vi.fn() } } }));

vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => prisma }));

import {
  QuantOptimizerEligibilityError,
  optimizeQuantAllocation,
  quantOptimizerRequestSchema,
} from "./quant-optimizer";

const context = { organizationId: "organization-a", userId: "user-a", role: "editor" as const };

function bars(multiplier: number) {
  return Array.from({ length: 41 }, (_, index) => ({
    ts: new Date(Date.UTC(2025, 0, index + 1)),
    close: 100 + index * multiplier + (index % 2 === 0 ? 1 : -1),
  }));
}

const assets = [
  {
    symbol: "BTC",
    datasets: [
      {
        versions: [
          {
            id: "dataset-btc",
            coverageStart: new Date("2025-01-01T00:00:00.000Z"),
            coverageEnd: new Date("2025-02-10T00:00:00.000Z"),
            bars: bars(2),
          },
        ],
      },
    ],
  },
  {
    symbol: "VNM",
    datasets: [
      {
        versions: [
          {
            id: "dataset-vnm",
            coverageStart: new Date("2025-01-01T00:00:00.000Z"),
            coverageEnd: new Date("2025-02-10T00:00:00.000Z"),
            bars: bars(1),
          },
        ],
      },
    ],
  },
];

const request = {
  symbols: ["VNM", "BTC"],
  method: "risk_parity" as const,
  timeframe: "1d" as const,
  from: "2025-01-01",
  to: "2025-02-10",
  maxWeightBps: 7_000,
  totalWeightBps: 8_000,
  dividendMode: "exclude" as const,
};

describe("quant allocation optimizer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.asset.findMany.mockResolvedValue(assets);
  });

  it("loads immutable aligned closes and returns dataset-bound weights", async () => {
    const result = await optimizeQuantAllocation(context, request);

    expect(result.datasetVersionIds).toEqual({ BTC: "dataset-btc", VNM: "dataset-vnm" });
    expect(result.method).toBe("risk_parity");
    expect(result.source).toEqual(
      expect.objectContaining({ library: "portfolio-allocation", license: "MIT" }),
    );
    expect(result.totalWeightBps).toBe(8_000);
    expect(Object.values(result.weightsBps).reduce((sum, value) => sum + value, 0)).toBe(8_000);
    expect(result.observationCount).toBe(40);
    expect(prisma.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { symbol: { in: ["BTC", "VNM"] } },
        select: expect.objectContaining({
          datasets: expect.objectContaining({
            where: { timeframe: "1d", adjustmentPolicy: "raw" },
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

  it("uses total-return datasets only when adjusted prices are requested", async () => {
    await optimizeQuantAllocation(context, { ...request, dividendMode: "adjusted_prices" });

    expect(prisma.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          datasets: expect.objectContaining({
            where: { timeframe: "1d", adjustmentPolicy: "total_return" },
          }),
        }),
      }),
    );
  });

  it("requires target inputs for Markowitz target methods", () => {
    expect(() =>
      quantOptimizerRequestSchema.parse({ ...request, method: "target_return" }),
    ).toThrow("Target return is required.");
    expect(() =>
      quantOptimizerRequestSchema.parse({
        ...request,
        method: "target_volatility",
        targetVolatilityPct: 15,
      }),
    ).not.toThrow();
  });

  it("fails closed when any requested asset lacks an eligible dataset", async () => {
    prisma.asset.findMany.mockResolvedValue([assets[0]]);

    await expect(optimizeQuantAllocation(context, request)).rejects.toEqual(
      expect.objectContaining<Partial<QuantOptimizerEligibilityError>>({
        code: "DATASET_UNAVAILABLE",
      }),
    );
  });
});
