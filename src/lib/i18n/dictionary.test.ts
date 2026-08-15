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

  it("covers visible content inside overview, mock portfolio and quant lab", () => {
    expect(translate("vi", "overview.hero.badge")).toBe("Bản tin ngày");
    expect(translate("en", "overview.hero.badge")).toBe("Daily briefing");
    expect(translate("vi", "portfolio.balance.total")).toBe("Tổng tài sản");
    expect(translate("en", "portfolio.balance.total")).toBe("Total Balance");
    expect(translate("vi", "optimizer.title")).toBe("Bộ tối ưu Awesome-Quant");
    expect(translate("en", "optimizer.title")).toBe("Awesome-Quant Optimizer");
    expect(translate("vi", "strategyLab.title")).toBe("Thư viện chiến lược");
    expect(translate("en", "strategyLab.title")).toBe("Strategy Lab");
    expect(translate("vi", "factorLab.loading")).toBe("Đang tải universe factor Việt Nam…");
    expect(translate("en", "factorLab.loading")).toBe("Loading VN factor universe…");
    expect(translate("vi", "backtestResults.tradeList.title")).toBe("Danh sách lệnh");
    expect(translate("en", "backtestResults.tradeList.title")).toBe("Trade List");
  });

  it("localizes the evidence-backed asset opinion cockpit", () => {
    expect(translate("vi", "overview.assetOpinions.title")).toBe("Quan điểm AI theo tài sản");
    expect(translate("en", "overview.assetOpinions.title")).toBe("AI asset opinions");
    expect(translate("vi", "overview.assetOpinions.states.quantOnly")).toBe(
      "Chỉ có quan điểm định lượng",
    );
    expect(translate("en", "overview.assetOpinions.states.insufficient")).toBe(
      "Insufficient evidence",
    );
    expect(translate("vi", "overview.assetOpinions.actions.reviewReduceRisk")).toBe(
      "Xem xét giảm rủi ro",
    );
  });

  it("keeps Vietnamese copy as valid UTF-8, not mojibake", () => {
    const text = translate("vi", "quant.hero.description");

    expect(text).toContain("Tối ưu");
    expect(text).not.toMatch(/[ÃÂ�]/);
  });

  it("translates Quant method, style, status, and fallback copy", () => {
    expect(translate("vi", "optimizer.methods.maximum_sharpe.label")).toBe("Sharpe tối đa");
    expect(translate("en", "optimizer.methods.maximum_sharpe.label")).toBe("Maximum Sharpe");
    expect(translate("vi", "strategyLab.styles.trend")).toBe("Theo xu hướng");
    expect(translate("en", "strategyLab.styles.trend")).toBe("Trend following");
    expect(translate("vi", "quant.dataHealth.failed")).toBe("Lỗi vận hành");
    expect(translate("en", "common.notAvailable")).toBe("N/A");
  });
});
