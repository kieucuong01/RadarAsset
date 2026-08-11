import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma, engine } = vi.hoisted(() => ({
  prisma: { asset: { findMany: vi.fn() } },
  engine: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => prisma }));
vi.mock("./quant-engine-client", () => ({ requestQuantEngineVietnamFactors: engine }));

import { loadVietnamFactorLab } from "./factor-lab";

const context = { organizationId: "org", userId: "user", role: "editor" as const };

function asset(symbol: string, count = 252) {
  return {
    symbol,
    datasets: [
      {
        versions: [
          {
            id: `dataset-${symbol}`,
            bars: Array.from({ length: count }, (_, index) => ({
              ts: new Date(Date.UTC(2025, 0, index + 1)),
              close: 100 + index,
              volume: 1000 + index,
            })),
          },
        ],
      },
    ],
  };
}

describe("VN Factor Lab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    engine.mockResolvedValue({
      asOf: "2025-09-09",
      universeSize: 5,
      observationCount: 252,
      methodology: "point_in_time_price_volume_v1",
      rows: ["FPT", "HPG", "MWG", "VCB", "VNM"].map((symbol, index) => ({
        symbol,
        compositeScore: 90 - index,
        momentumScore: 90,
        lowVolatilityScore: 80,
        trendScore: 90,
        liquidityScore: 70,
        momentum126dPct: 12,
        volatility63dPct: 20,
      })),
    });
  });

  it("fails closed until five VN symbols have 252 sessions", async () => {
    prisma.asset.findMany.mockResolvedValue([asset("FPT"), asset("VNM")]);
    await expect(loadVietnamFactorLab(context)).resolves.toMatchObject({
      ready: false,
      eligibleAssetCount: 2,
    });
    expect(engine).not.toHaveBeenCalled();
  });

  it("sends only aligned point-in-time matrices to the Python engine", async () => {
    prisma.asset.findMany.mockResolvedValue(
      ["FPT", "HPG", "MWG", "VCB", "VNM"].map((symbol) => asset(symbol)),
    );
    const result = await loadVietnamFactorLab(context);
    expect(result.ready).toBe(true);
    expect(engine).toHaveBeenCalledWith(expect.objectContaining({ asOf: "2025-09-09" }));
  });
});
