import { describe, expect, it } from "vitest";

import { DEFAULT_LOCALE, LOCALES, normalizeLocale, translate } from "./dictionary";

describe("i18n dictionary", () => {
  it("normalizes supported locales and defaults to Vietnamese", () => {
    expect(DEFAULT_LOCALE).toBe("vi");
    expect(LOCALES.map((locale) => locale.code)).toEqual(["vi", "en"]);
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("vi")).toBe("vi");
    expect(normalizeLocale("fr")).toBe("vi");
    expect(normalizeLocale(null)).toBe("vi");
  });

  it("returns translated copy by dotted key", () => {
    expect(translate("vi", "header.theme")).toBe("Đổi giao diện sáng tối");
    expect(translate("en", "header.theme")).toBe("Toggle light or dark mode");
    expect(translate("en", "quant.tabs.backtest")).toBe("Backtest & Risk Engine");
  });

  it("uses visibly different labels for the main VI and EN navigation", () => {
    expect(translate("vi", "routes.insights")).toBe("Tổng quan");
    expect(translate("en", "routes.insights")).toBe("Smart Insights");
    expect(translate("vi", "routes.portfolio")).toBe("Danh mục mô phỏng");
    expect(translate("en", "routes.portfolio")).toBe("Mock Portfolio");
    expect(translate("vi", "quant.tabs.optimizer")).toBe("Tối ưu danh mục");
    expect(translate("en", "quant.tabs.optimizer")).toBe("Portfolio Optimizer");
  });

  it("keeps Vietnamese copy as valid UTF-8, not mojibake", () => {
    const text = translate("vi", "quant.hero.description");

    expect(text).toContain("Tối ưu");
    expect(text).not.toMatch(/[ÃÂ�]/);
  });
});
