import { describe, expect, it } from "vitest";
import { buildForwardChart } from "./presentation";

describe("forward-test presentation", () => {
  it("normalizes strategy and benchmark to 100 at activation", () => {
    expect(
      buildForwardChart([
        {
          timestamp: "2026-08-01T00:00:00.000Z",
          equity: 1000,
          benchmarkEquity: 1000,
          pnlExcludingContributions: 0,
          cumulativeContributions: 0,
          cumulativeFees: 0,
        },
        {
          timestamp: "2026-08-02T00:00:00.000Z",
          equity: 1020,
          benchmarkEquity: 1010,
          pnlExcludingContributions: 20,
          cumulativeContributions: 0,
          cumulativeFees: 1,
        },
      ]),
    ).toEqual([
      { timestamp: "2026-08-01T00:00:00.000Z", strategy: 100, buyHold: 100 },
      { timestamp: "2026-08-02T00:00:00.000Z", strategy: 102, buyHold: 101 },
    ]);
  });

  it("returns an empty model rather than divide by zero", () => {
    expect(
      buildForwardChart([
        {
          timestamp: "2026-08-01T00:00:00.000Z",
          equity: 0,
          benchmarkEquity: 0,
          pnlExcludingContributions: 0,
          cumulativeContributions: 0,
          cumulativeFees: 0,
        },
      ]),
    ).toEqual([]);
  });
});
