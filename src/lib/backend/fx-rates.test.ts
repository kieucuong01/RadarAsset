import { describe, expect, it } from "vitest";

import { convertMoney, normalizeCurrency, selectRateOnOrBefore } from "./fx-rates";

describe("portfolio FX conversion", () => {
  it("converts USD and VND in both directions and treats USDT as USD", () => {
    expect(convertMoney(100, "USD", "VND", 26_250)).toBe(2_625_000);
    expect(convertMoney(2_625_000, "VND", "USD", 26_250)).toBe(100);
    expect(convertMoney(100, "USDT", "USD", 26_250)).toBe(100);
    expect(normalizeCurrency(" usdt ")).toBe("USD");
    expect(() => normalizeCurrency("EUR")).toThrow("Unsupported portfolio currency");
  });

  it("selects only the latest observation on or before the requested date", () => {
    const rates = [
      { effectiveDate: "2026-08-15", rate: 26_250, source: "vietcombank" },
      { effectiveDate: "2026-08-18", rate: 26_300, source: "vietcombank" },
      { effectiveDate: "2026-08-14", rate: 26_200, source: "vietcombank" },
    ];

    expect(selectRateOnOrBefore(rates, "2026-08-16")).toEqual({
      effectiveDate: "2026-08-15",
      rate: 26_250,
      source: "vietcombank",
      fallback: false,
    });
  });

  it("prefers Vietcombank over a same-day historical market quote", () => {
    expect(
      selectRateOnOrBefore(
        [
          { effectiveDate: "2026-08-15", rate: 26_100, source: "yahoo_finance" },
          { effectiveDate: "2026-08-15", rate: 26_140, source: "vietcombank" },
        ],
        "2026-08-15",
      ),
    ).toMatchObject({ rate: 26_140, source: "vietcombank" });
  });

  it("uses the declared 26,000 fallback when no prior observation exists", () => {
    expect(
      selectRateOnOrBefore(
        [{ effectiveDate: "2026-08-15", rate: 26_250, source: "vietcombank" }],
        "2010-01-01",
      ),
    ).toEqual({
      effectiveDate: null,
      rate: 26_000,
      source: "fallback",
      fallback: true,
    });
  });

  it("rejects invalid rates instead of producing fabricated money", () => {
    expect(() => convertMoney(100, "USD", "VND", 0)).toThrow("positive");
    expect(() =>
      selectRateOnOrBefore(
        [{ effectiveDate: "2026-08-15", rate: Number.NaN, source: "vietcombank" }],
        "2026-08-16",
      ),
    ).toThrow("Invalid USD/VND observation");
  });
});
