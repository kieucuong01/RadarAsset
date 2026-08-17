export type PortfolioCurrency = "USD" | "VND";

export type FxRatePoint = {
  effectiveDate: string;
  rate: number;
  source: string;
};

export type ResolvedFxRate = {
  effectiveDate: string | null;
  rate: number;
  source: string;
  fallback: boolean;
};

export const FALLBACK_USD_VND_RATE = 26_000;

export function normalizeCurrency(value: string): PortfolioCurrency {
  const normalized = value.trim().toUpperCase();
  if (normalized === "USD" || normalized === "USDT") return "USD";
  if (normalized === "VND") return "VND";
  throw new Error(`Unsupported portfolio currency: ${value}.`);
}

export function convertMoney(value: number, from: string, to: string, usdVndRate: number): number {
  const source = normalizeCurrency(from);
  const target = normalizeCurrency(to);
  if (!Number.isFinite(value)) throw new Error("Money value must be finite.");
  if (!Number.isFinite(usdVndRate) || usdVndRate <= 0) {
    throw new Error("USD/VND rate must be positive.");
  }
  if (source === target) return value;
  return source === "USD" ? value * usdVndRate : value / usdVndRate;
}

export function selectRateOnOrBefore(
  rates: readonly FxRatePoint[],
  requestedDate: string,
): ResolvedFxRate {
  let selected: FxRatePoint | null = null;
  for (const rate of rates) {
    if (rate.effectiveDate > requestedDate) continue;
    if (!Number.isFinite(rate.rate) || rate.rate <= 0) {
      throw new Error("Invalid USD/VND observation.");
    }
    if (
      !selected ||
      rate.effectiveDate > selected.effectiveDate ||
      (rate.effectiveDate === selected.effectiveDate &&
        rate.source === "vietcombank" &&
        selected.source !== "vietcombank")
    ) {
      selected = rate;
    }
  }
  if (!selected) {
    return {
      effectiveDate: null,
      rate: FALLBACK_USD_VND_RATE,
      source: "fallback",
      fallback: true,
    };
  }
  return { ...selected, fallback: false };
}
