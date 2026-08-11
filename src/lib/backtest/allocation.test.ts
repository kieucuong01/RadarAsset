import { describe, expect, it } from "vitest";

import { equalAllocationBps, notionalFromBps } from "./allocation";

describe("portfolio allocation", () => {
  it("distributes remainder basis points in stable symbol order", () => {
    expect(equalAllocationBps(["VNM", "BTC", "FPT"])).toEqual({
      BTC: 3334,
      FPT: 3333,
      VNM: 3333,
    });
  });

  it("derives sleeve notional without floating allocation drift", () => {
    expect(notionalFromBps(100_000, 3334)).toBe(33_340);
  });

  it("rejects an empty or oversized portfolio", () => {
    expect(() => equalAllocationBps([])).toThrow("Expected 1 to 10 assets");
    expect(() =>
      equalAllocationBps(Array.from({ length: 11 }, (_, index) => `ASSET${index}`)),
    ).toThrow("Expected 1 to 10 assets");
  });
});
