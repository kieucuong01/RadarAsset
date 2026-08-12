import { describe, expect, it } from "vitest";

import { nextSemanticVersion, normalizeExecutableRule } from "./contracts";

describe("custom strategy executable rules", () => {
  it("normalizes a bounded price threshold rule", () => {
    expect(
      normalizeExecutableRule({
        schemaVersion: 1,
        kind: "price_threshold",
        operator: "crosses_above",
        threshold: 50_000,
        currency: "USD",
        action: "buy",
        sizePct: 25,
      }),
    ).toEqual({
      schemaVersion: 1,
      kind: "price_threshold",
      operator: "crosses_above",
      threshold: 50_000,
      currency: "USD",
      action: "buy",
      sizePct: 25,
    });
  });

  it("normalizes a monthly DCA rule", () => {
    expect(
      normalizeExecutableRule({
        schemaVersion: 1,
        kind: "scheduled_dca",
        contributionAmount: 400,
        currency: "USD",
        frequency: "monthly",
        dayOfMonth: 15,
      }),
    ).toEqual({
      schemaVersion: 1,
      kind: "scheduled_dca",
      contributionAmount: 400,
      currency: "USD",
      frequency: "monthly",
      dayOfMonth: 15,
    });
  });

  it("rejects an invalid scheduled DCA amount and date", () => {
    expect(() =>
      normalizeExecutableRule({
        schemaVersion: 1,
        kind: "scheduled_dca",
        contributionAmount: 0,
        currency: "USD",
        frequency: "monthly",
        dayOfMonth: 29,
      }),
    ).toThrow();
  });

  it("rejects unknown rule fields", () => {
    expect(() =>
      normalizeExecutableRule({
        schemaVersion: 1,
        kind: "price_threshold",
        operator: "crosses_below",
        threshold: 50_000,
        currency: "USD",
        action: "sell",
        sizePct: 100,
        shellCommand: "do-not-run",
      }),
    ).toThrow();
  });

  it("increments only the patch component for a new immutable version", () => {
    expect(nextSemanticVersion(null)).toBe("1.0.0");
    expect(nextSemanticVersion("2.4.9")).toBe("2.4.10");
    expect(() => nextSemanticVersion("invalid")).toThrow();
  });
});
