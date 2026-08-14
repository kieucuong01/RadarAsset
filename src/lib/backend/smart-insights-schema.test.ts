import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

function model(name: string) {
  const found = Prisma.dmmf.datamodel.models.find((item) => item.name === name);
  expect(found, `${name} must exist in the generated Prisma client`).toBeDefined();
  return found!;
}

describe("Smart Insights event storage schema", () => {
  it("exposes auditable event observations and cluster membership", () => {
    const observation = model("GlobalEventObservation");
    const cluster = model("GlobalEventCluster");
    const membership = model("GlobalEventClusterMember");

    expect(observation.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining([
        "provider",
        "rawSnapshot",
        "providerEventKey",
        "occurredAt",
        "normalizedSeverity",
        "contentHash",
        "qualityFlags",
      ]),
    );
    expect(cluster.fields.map((field) => field.name)).toContain("members");
    expect(membership.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining(["cluster", "observation", "matchScore"]),
    );
  });

  it("exposes one rolling baseline state per event segment", () => {
    const baseline = model("EventBaselineState");
    expect(baseline.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining([
        "baselineKey",
        "eventCategory",
        "region",
        "weekday",
        "month",
        "count",
        "mean",
        "m2",
      ]),
    );
  });
});
