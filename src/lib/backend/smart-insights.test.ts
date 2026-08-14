import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: { metricObservation: { findMany: vi.fn() } },
}));

vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => prisma }));

import { loadMetrics, parseInsightWindow, SmartInsightsInputError } from "./smart-insights";

describe("Smart Insights read bounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.metricObservation.findMany.mockResolvedValue([]);
  });

  it("accepts a 31-day inclusive metric window", () => {
    const result = parseInsightWindow(new URL("http://local?from=2026-08-01&to=2026-09-01"));
    expect(result.from.toISOString()).toContain("2026-08-01");
  });

  it("rejects windows beyond 31 days", () => {
    expect(() => parseInsightWindow(new URL("http://local?from=2026-01-01&to=2026-03-01"))).toThrow(
      SmartInsightsInputError,
    );
  });

  it("keeps enough rows for all daily Crypto series in the 31-day window", async () => {
    await loadMetrics({
      market: "crypto",
      from: new Date("2026-07-14T00:00:00Z"),
      to: new Date("2026-08-14T00:00:00Z"),
    });

    expect(prisma.metricObservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5_000 }),
    );
  });

  it("returns only the newest immutable revision for each natural key", async () => {
    const base = {
      naturalKey: "crypto:onchain:nvt:BTC:2026-08-14",
      effectiveAt: new Date("2026-08-14T00:00:00Z"),
      effectiveStart: new Date("2026-08-14T00:00:00Z"),
      effectiveEnd: new Date("2026-08-14T00:00:00Z"),
      observedAt: new Date("2026-08-14T01:00:00Z"),
      qualityStatus: "passed",
      qualityFlags: [],
      metricDefinition: {
        code: "crypto.onchain.nvt",
        market: "crypto",
        unit: "ratio",
        freshnessSlaMinutes: 2_880,
        methodologyVersion: "v1",
      },
      provider: { code: "coinmetrics-community" },
      asset: { symbol: "BTC" },
      rawSnapshot: { sourceUrl: "https://example.test/coinmetrics" },
    };
    prisma.metricObservation.findMany.mockResolvedValue([
      { ...base, id: "revision-2", revision: 2, value: { toString: () => "20" } },
      { ...base, id: "revision-1", revision: 1, value: { toString: () => "18" } },
    ]);

    const result = await loadMetrics({
      market: "crypto",
      from: new Date("2026-08-01T00:00:00Z"),
      to: new Date("2026-08-14T00:00:00Z"),
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ observationId: "revision-2", value: "20" });
  });
});
