import { describe, expect, it } from "vitest";
import {
  defaultCurrency,
  formatCount,
  formatMetricValue,
  formatMoney,
  formatNumber,
  formatPercent,
  formatPrice,
  formatRatio,
  formatScore,
} from "@/lib/financial-format";

describe("financial formatting", () => {
  it("uses en-US punctuation and trims unnecessary decimals", () => {
    expect(formatNumber(1000)).toBe("1,000");
    expect(formatNumber("61.250000")).toBe("61.25");
    expect(formatCount(12450.8)).toBe("12,451");
  });

  it("uses locale fallback currency without overriding explicit currency", () => {
    expect(defaultCurrency("vi")).toBe("VND");
    expect(defaultCurrency("en")).toBe("USD");
    expect(formatMoney(1250000, { locale: "vi" })).toBe("1,250,000 VND");
    expect(formatMoney(1250000.55, { locale: "vi", currency: "USD" })).toBe("1,250,000.55 USD");
    expect(formatMoney(1250000.55, { locale: "en", currency: "USDT" })).toBe("1,250,000.55 USDT");
  });

  it("preserves useful precision for small crypto prices", () => {
    expect(formatPrice(56200000, { locale: "vi", currency: "USD" })).toBe("56,200,000 USD");
    expect(formatPrice(0.00001234, { locale: "vi", currency: "USDT" })).toBe("0.00001234 USDT");
    expect(formatPrice(0.0000000012, { locale: "en", currency: "USDT" })).toBe("1.2e-9 USDT");
  });

  it("formats percentages, scores, ratios, and compact values", () => {
    expect(formatPercent("82.7400")).toBe("82.74%");
    expect(formatPercent(0.1234, { multiplier: 100, sign: true })).toBe("+12.34%");
    expect(formatScore("-29.5600")).toBe("−29.56");
    expect(formatRatio("0.3438893455")).toBe("0.3439");
    expect(formatMoney(1_250_000_000, { locale: "vi", currency: "USD", compact: true })).toBe(
      "1.25B USD",
    );
  });

  it("normalizes known units and preserves unknown units", () => {
    expect(formatMetricValue(52.4, { locale: "vi", unit: "INDEX" })).toBe("52.4 điểm");
    expect(formatMetricValue(120.25, { locale: "vi", unit: "USD_MILLION" })).toBe(
      "120.25 triệu USD",
    );
    expect(formatMetricValue(83.456, { locale: "vi", unit: "USD/barrel" })).toBe("83.46 USD/thùng");
    expect(formatMetricValue(12000, { locale: "vi", unit: "contracts" })).toBe("12,000 hợp đồng");
    expect(formatMetricValue(4.125, { locale: "en", unit: "BTC" })).toBe("4.125 BTC");
    expect(formatMetricValue(7.25, { locale: "vi", unit: "custom-unit" })).toBe("7.25 custom-unit");
  });

  it("fails closed for invalid values", () => {
    for (const value of [null, undefined, "", "12x", Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatNumber(value)).toBe("—");
    }
    expect(formatPercent(12, { multiplier: Number.POSITIVE_INFINITY })).toBe("—");
  });
});
