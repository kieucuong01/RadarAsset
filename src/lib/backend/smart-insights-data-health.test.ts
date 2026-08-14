import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: {
    dataProvider: { findMany: vi.fn() },
    providerRun: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => prisma }));

import { loadSmartInsightsDataHealth } from "./smart-insights-data-health";

describe("Smart Insights data health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.dataProvider.findMany.mockResolvedValue([]);
    prisma.providerRun.findMany.mockResolvedValue([]);
  });

  it("returns every code-owned source and keeps a failed retry separate from fresh data", async () => {
    prisma.dataProvider.findMany.mockResolvedValue([
      {
        id: "provider-a",
        code: "alternative-fng",
        name: "Alternative.me Crypto Fear and Greed",
        status: "active",
        metricObservations: [
          {
            effectiveAt: new Date("2026-08-13T00:00:00.000Z"),
            observedAt: new Date("2026-08-13T01:00:00.000Z"),
            metricDefinition: { freshnessSlaMinutes: 2_880 },
            rawPayload: "must-not-leak",
          },
        ],
        rawInsightSnapshots: [
          {
            observedAt: new Date("2026-08-12T01:00:00.000Z"),
            storageLocator: "private/path.json.gz",
          },
        ],
      },
    ]);
    prisma.providerRun.findMany.mockResolvedValue([
      {
        provider: "alternative-fng",
        status: "failed",
        errorCode: "RATE_LIMITED",
        finishedAt: new Date("2026-08-13T01:30:00.000Z"),
        createdAt: new Date("2026-08-13T01:30:00.000Z"),
        errorMessage: "private upstream detail",
      },
    ]);

    const response = await loadSmartInsightsDataHealth(new Date("2026-08-13T02:00:00.000Z"));
    const fearGreed = response.sources.find((source) => source.sourceCode === "alternative-fng");

    expect(response.sources).toHaveLength(16);
    expect(
      response.sources.find((source) => source.sourceCode === "mempool-btc-large-addresses"),
    ).toMatchObject({
      sourceName: "mempool.space BTC Large Addresses",
      market: "crypto",
      collectionMode: "api",
      parserVersion: "mempool-btc-large-addresses-v1",
      lastStatus: "unavailable",
      freshness: "UNAVAILABLE",
    });
    expect(
      response.sources
        .filter(
          (source) =>
            source.sourceCode.startsWith("farside-") || source.sourceCode === "coinshares-weekly",
        )
        .map((source) => [source.sourceCode, source.collectionMode]),
    ).toEqual([
      ["coinshares-weekly", "scrapling"],
      ["farside-btc-etf", "scrapling"],
      ["farside-eth-etf", "scrapling"],
      ["farside-sol-etf", "scrapling"],
    ]);
    expect(response.sources.some((source) => source.sourceCode.startsWith("wgc-"))).toBe(false);
    expect(fearGreed).toEqual({
      sourceCode: "alternative-fng",
      sourceName: "Alternative.me Crypto Fear and Greed",
      market: "crypto",
      collectionMode: "api",
      parserVersion: "alternative-fng-v1",
      lastEffectiveAt: "2026-08-13T00:00:00.000Z",
      lastObservedAt: "2026-08-13T01:00:00.000Z",
      lastStatus: "validated",
      lastErrorCode: "RATE_LIMITED",
      freshness: "FRESH",
    });
    expect(JSON.stringify(response)).not.toContain("must-not-leak");
    expect(JSON.stringify(response)).not.toContain("private upstream detail");
    expect(JSON.stringify(response)).not.toContain("private/path");
  });

  it("marks never-run sources unavailable and drops unknown error text", async () => {
    prisma.providerRun.findMany.mockResolvedValue([
      {
        provider: "cryptocraft",
        status: "failed",
        errorCode: "postgresql://user:secret@internal/database",
        finishedAt: new Date("2026-08-13T01:30:00.000Z"),
        createdAt: new Date("2026-08-13T01:30:00.000Z"),
      },
    ]);

    const response = await loadSmartInsightsDataHealth(new Date("2026-08-13T02:00:00.000Z"));
    const cryptocraft = response.sources.find((source) => source.sourceCode === "cryptocraft");

    expect(cryptocraft).toMatchObject({
      collectionMode: "scrapling",
      lastEffectiveAt: null,
      lastObservedAt: null,
      lastStatus: "unavailable",
      lastErrorCode: null,
      freshness: "UNAVAILABLE",
    });
    expect(JSON.stringify(response)).not.toContain("secret");
  });
});
