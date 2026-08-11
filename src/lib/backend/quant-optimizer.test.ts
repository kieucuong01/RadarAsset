import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma, engine } = vi.hoisted(() => ({
  prisma: { asset: { findMany: vi.fn() } },
  engine: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => prisma }));
vi.mock("./quant-engine-client", () => ({ requestQuantEngineOptimization: engine }));

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
    market: "crypto_spot",
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
    market: "vn_equity",
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
    engine.mockResolvedValue({
      method: "risk_parity",
      source: {
        library: "skfolio",
        version: "0.20.1",
        repository: "https://github.com/skfolio/skfolio",
        directory: "awesome-quant: Portfolio Optimization & Risk Analysis",
        license: "BSD-3-Clause",
      },
      weightsBps: { BTC: 4000, VNM: 4000 },
      expectedReturnPct: 8,
      volatilityPct: 10,
      sharpe: 0.8,
      observationCount: 40,
      assetMetrics: [
        { symbol: "BTC", expectedReturnPct: 10, volatilityPct: 20 },
        { symbol: "VNM", expectedReturnPct: 6, volatilityPct: 8 },
      ],
      correlationMatrix: [
        { symbol: "BTC", correlations: { BTC: 1, VNM: 0.2 } },
        { symbol: "VNM", correlations: { BTC: 0.2, VNM: 1 } },
      ],
      validation: {
        split: "chronological_70_30",
        trainObservationCount: 30,
        testObservationCount: 10,
        inSample: { expectedReturnPct: 8, volatilityPct: 10, sharpe: 0.8, maxDrawdownPct: -4 },
        outOfSample: { expectedReturnPct: 6, volatilityPct: 11, sharpe: 0.5, maxDrawdownPct: -5 },
      },
      warnings: [],
    });
  });

  it("loads immutable aligned closes and returns dataset-bound weights", async () => {
    const result = await optimizeQuantAllocation(context, request);

    expect(result.datasetVersionIds).toEqual({ BTC: "dataset-btc", VNM: "dataset-vnm" });
    expect(result.method).toBe("risk_parity");
    expect(result.source).toEqual(
      expect.objectContaining({ library: "skfolio", license: "BSD-3-Clause" }),
    );
    expect(result.totalWeightBps).toBe(8_000);
    expect(Object.values(result.weightsBps).reduce((sum, value) => sum + value, 0)).toBe(8_000);
    expect(result.observationCount).toBe(40);
    expect(engine).toHaveBeenCalledWith(
      expect.objectContaining({
        marketBySymbol: { BTC: "crypto_spot", VNM: "vn_equity" },
        timeframe: "1d",
      }),
    );
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
