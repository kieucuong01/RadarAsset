import { describe, expect, it } from "vitest";

import { parseInsightWindow, SmartInsightsInputError } from "./smart-insights";

describe("Smart Insights read bounds", () => {
  it("accepts a 31-day inclusive metric window", () => {
    const result = parseInsightWindow(new URL("http://local?from=2026-08-01&to=2026-09-01"));
    expect(result.from.toISOString()).toContain("2026-08-01");
  });

  it("rejects windows beyond 31 days", () => {
    expect(() => parseInsightWindow(new URL("http://local?from=2026-01-01&to=2026-03-01"))).toThrow(
      SmartInsightsInputError,
    );
  });
});
