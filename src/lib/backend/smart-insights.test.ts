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
});
