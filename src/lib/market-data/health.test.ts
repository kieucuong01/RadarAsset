import { describe, expect, it } from "vitest";

import { calculateFreshness, expectedClosedBarOpen } from "./health";

describe("market data freshness", () => {
  it("labels fixture data explicitly even when recently published", () => {
    expect(
      calculateFreshness({
        market: "crypto_spot",
        timeframe: "1h",
        coverageEnd: new Date("2026-08-10T11:00:00Z"),
        source: "research_fixture",
        lastStatus: "succeeded",
        now: new Date("2026-08-10T12:10:00Z"),
      }),
    ).toBe("fixture");
  });

  it("marks an hourly crypto feed stale after two missing closed bars", () => {
    expect(
      calculateFreshness({
        market: "crypto_spot",
        timeframe: "1h",
        coverageEnd: new Date("2026-08-10T09:00:00Z"),
        source: "binance-public-spot",
        lastStatus: "succeeded",
        now: new Date("2026-08-10T12:10:00Z"),
      }),
    ).toBe("stale");
  });

  it("allows one missing hourly bar inside the ninety-minute tolerance", () => {
    expect(
      calculateFreshness({
        market: "crypto_spot",
        timeframe: "1h",
        coverageEnd: new Date("2026-08-10T10:00:00Z"),
        source: "binance-public-spot",
        lastStatus: "failed",
        now: new Date("2026-08-10T12:10:00Z"),
      }),
    ).toBe("fresh");
  });

  it("rolls the expected FPT bar backward over the weekend", () => {
    const now = new Date("2026-08-09T12:00:00Z");

    expect(expectedClosedBarOpen("vn_equity", "1h", now)).toEqual(
      new Date("2026-08-07T07:00:00Z"),
    );
    expect(
      calculateFreshness({
        market: "vn_equity",
        timeframe: "1h",
        coverageEnd: new Date("2026-08-07T07:00:00Z"),
        source: "vnstock-vci-free",
        lastStatus: "succeeded",
        now,
      }),
    ).toBe("fresh");
  });

  it("marks daily crypto data stale after two missing sessions", () => {
    expect(
      calculateFreshness({
        market: "crypto_spot",
        timeframe: "1d",
        coverageEnd: new Date("2026-08-07T00:00:00Z"),
        source: "binance-public-spot",
        lastStatus: "succeeded",
        now: new Date("2026-08-10T12:10:00Z"),
      }),
    ).toBe("stale");
  });

  it("reports unavailable when no active coverage exists", () => {
    expect(
      calculateFreshness({
        market: "metal_spot",
        timeframe: "1d",
        coverageEnd: null,
        source: null,
        lastStatus: "unavailable",
        now: new Date("2026-08-10T12:10:00Z"),
      }),
    ).toBe("unavailable");
  });
});
