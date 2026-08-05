import { describe, expect, it } from "vitest";

import { DATA_STATUS_META, MVP_FEATURES, isFeatureAvailable } from "./mvp-ui";

describe("MVP UI contracts", () => {
  it("provides a visible Vietnamese label for every data status", () => {
    expect(DATA_STATUS_META).toEqual({
      SYSTEM: expect.objectContaining({ label: "Dữ liệu hệ thống" }),
      SAMPLE: expect.objectContaining({ label: "Dữ liệu mẫu" }),
      SIMULATED: expect.objectContaining({ label: "Mô phỏng" }),
      UNAVAILABLE: expect.objectContaining({ label: "Chưa khả dụng trong MVP" }),
    });
  });

  it("only enables the watchlist action in this sprint", () => {
    expect(isFeatureAvailable("watchlistAdd")).toBe(true);
    expect(isFeatureAvailable("listenBriefing")).toBe(false);
    expect(isFeatureAvailable("applyPortfolio")).toBe(false);
    expect(isFeatureAvailable("alertEdit")).toBe(false);
    expect(isFeatureAvailable("notifications")).toBe(false);
    expect(Object.keys(MVP_FEATURES)).toHaveLength(5);
  });
});
