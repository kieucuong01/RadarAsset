import { describe, expect, it } from "vitest";

import { APP_ROUTES } from "./navigation";

describe("application routes", () => {
  it("contains exactly the three implemented routes", () => {
    expect(APP_ROUTES.map((route) => route.href)).toEqual(["/", "/portfolio", "/quant-lab"]);
    expect(new Set(APP_ROUTES.map((route) => route.href)).size).toBe(APP_ROUTES.length);
    expect(APP_ROUTES.some((route) => route.href.startsWith("/asset/"))).toBe(false);
  });

  it("gives every destination a visible desktop and mobile label", () => {
    expect(
      APP_ROUTES.every((route) => route.label.length > 0 && route.mobileLabel.length > 0),
    ).toBe(true);
  });
});
