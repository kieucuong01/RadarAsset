import { describe, expect, it } from "vitest";

import { isInternalNavigation } from "./NavigationProgress";

describe("isInternalNavigation", () => {
  const currentUrl = "https://datavest.vn/";

  it("accepts a same-origin route change", () => {
    expect(isInternalNavigation("/portfolio", currentUrl)).toBe(true);
  });

  it("ignores the current route, anchors, and external links", () => {
    expect(isInternalNavigation("/", currentUrl)).toBe(false);
    expect(isInternalNavigation("/#risk", currentUrl)).toBe(false);
    expect(isInternalNavigation("https://example.com/portfolio", currentUrl)).toBe(false);
    expect(isInternalNavigation("mailto:test@example.com", currentUrl)).toBe(false);
  });
});
