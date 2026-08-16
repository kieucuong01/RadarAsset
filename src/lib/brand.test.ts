import { describe, expect, it } from "vitest";

import { BRAND, BRAND_COLORS, resolveSiteUrl } from "./brand";

describe("DataVest brand contract", () => {
  it("defines one canonical Vietnamese-first entity", () => {
    expect(BRAND).toMatchObject({
      name: "DataVest.vn",
      shortName: "DataVest",
      origin: "https://datavest.vn",
      descriptor: "Dữ liệu định lượng cho nhà đầu tư cá nhân",
      tagline: "Dữ liệu trước. Quyết định sau.",
    });
    expect(BRAND.description).toContain("nhà đầu tư cá nhân Việt Nam");
    expect(BRAND.description).not.toMatch(/guaranteed|chắc thắng|AI price prediction/i);
  });

  it("uses the approved A1 palette", () => {
    expect(BRAND_COLORS).toEqual({
      cobalt: "#1746A2",
      amber: "#F2B84B",
      midnight: "#0E1B32",
      paper: "#F5F7FB",
      white: "#FFFFFF",
    });
  });

  it("accepts only an absolute configured public origin", () => {
    expect(resolveSiteUrl(undefined)).toBe("https://datavest.vn");
    expect(resolveSiteUrl("https://preview.example.com/")).toBe("https://preview.example.com");
    expect(() => resolveSiteUrl("javascript:alert(1)")).toThrow("http or https");
  });
});
