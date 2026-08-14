import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: {
    globalEventCluster: { findMany: vi.fn() },
    signalSnapshot: { findFirst: vi.fn() },
    metricObservation: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => prisma }));

import { loadEnergyPulse, loadMacroEventRisk } from "./smart-insights-macro";

const context = { userId: "user-a", organizationId: "org-a", role: "viewer" as const };
const from = new Date("2026-08-01T00:00:00.000Z");
const to = new Date("2026-08-14T12:00:00.000Z");

describe("Smart Insights macro read models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.globalEventCluster.findMany.mockResolvedValue([]);
    prisma.signalSnapshot.findFirst.mockResolvedValue(null);
    prisma.metricObservation.findMany.mockResolvedValue([]);
  });

  it("returns bounded event rows, component evidence and BTC/XAU impact", async () => {
    prisma.globalEventCluster.findMany.mockResolvedValue([
      {
        id: "cluster-a",
        category: "natural_hazard",
        subcategory: "EQ",
        title: "Earthquake near Sendai",
        country: "JAPAN",
        region: "Sendai",
        occurredAt: new Date("2026-08-13T03:15:00.000Z"),
        normalizedSeverity: { toString: () => "60" },
        corroborationCount: 2,
        status: "active",
        qualityFlags: [],
        members: [
          {
            observation: {
              id: "obs-a",
              sourceUrl: "https://earthquake.usgs.gov/earthquakes/eventpage/a",
              lastObservedAt: new Date("2026-08-13T04:00:00.000Z"),
              provider: { code: "usgs-earthquakes" },
            },
          },
        ],
      },
    ]);
    prisma.signalSnapshot.findFirst.mockResolvedValue({
      score: { toString: () => "57.17" },
      coverage: { toString: () => "1" },
      effectiveAt: to,
      methodologyVersion: "macro-event-risk-v1",
      status: "active",
      inputs: [
        {
          metricCode: "macro.event.severity",
          value: "60",
          configuredWeight: "0.30",
          isFresh: true,
          sourceObservationIds: ["obs-a"],
        },
      ],
    });

    const result = await loadMacroEventRisk(context, { from, to }, to);

    expect(result.status).toBe("AVAILABLE");
    expect(result.score).toBe(57.17);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.sources[0]?.sourceCode).toBe("usgs-earthquakes");
    expect(result.assetImpacts.map((row) => row.asset)).toEqual(["BTC", "XAU"]);
    expect(JSON.stringify(result)).not.toContain("rawPayload");
    expect(JSON.stringify(result)).not.toContain("api_key");
  });

  it("returns unavailable rather than seed data when event inputs are absent", async () => {
    const result = await loadMacroEventRisk(context, { from, to }, to);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.score).toBeNull();
    expect(result.events).toEqual([]);
  });

  it("preserves an unavailable provider severity instead of inventing zero", async () => {
    prisma.globalEventCluster.findMany.mockResolvedValue([
      {
        id: "cluster-no-severity",
        category: "natural_hazard",
        subcategory: null,
        title: "Wildfire observation",
        country: null,
        region: null,
        occurredAt: to,
        normalizedSeverity: null,
        corroborationCount: 1,
        status: "active",
        qualityFlags: [],
        members: [],
      },
    ]);

    const result = await loadMacroEventRisk(context, { from, to }, to);

    expect(result.events[0]?.severity).toBeNull();
    expect(result.timeline).toEqual([]);
  });

  it("builds energy cards and aligned Brent/WTI series from accepted observations", async () => {
    prisma.metricObservation.findMany.mockResolvedValue([
      {
        id: "brent-a",
        effectiveAt: new Date("2026-08-13T00:00:00.000Z"),
        observedAt: new Date("2026-08-13T12:00:00.000Z"),
        value: { toString: () => "85.2" },
        qualityStatus: "passed",
        metricDefinition: { code: "macro.energy.brent_usd_bbl", unit: "USD/barrel" },
        provider: { code: "eia-energy" },
        rawSnapshot: { sourceUrl: "https://api.eia.gov/v2/" },
      },
      {
        id: "wti-a",
        effectiveAt: new Date("2026-08-13T00:00:00.000Z"),
        observedAt: new Date("2026-08-13T12:00:00.000Z"),
        value: { toString: () => "81" },
        qualityStatus: "passed",
        metricDefinition: { code: "macro.energy.wti_usd_bbl", unit: "USD/barrel" },
        provider: { code: "eia-energy" },
        rawSnapshot: { sourceUrl: "https://api.eia.gov/v2/" },
      },
    ]);

    const result = await loadEnergyPulse(context, { from, to }, to);

    expect(result.status).toBe("LIMITED_DATA");
    expect(result.cards.find((row) => row.code === "brent")?.value).toBe(85.2);
    expect(result.cards.find((row) => row.code === "spread")?.value).toBeCloseTo(4.2);
    expect(result.priceSeries).toEqual([{ ts: "2026-08-13T00:00:00.000Z", brent: 85.2, wti: 81 }]);
  });
});
