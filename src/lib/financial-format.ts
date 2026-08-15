import type { Locale } from "@/lib/i18n/dictionary";

export type NumericInput = number | string | null | undefined;

type NumberOptions = {
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  signDisplay?: Intl.NumberFormatOptions["signDisplay"];
  compact?: boolean;
};

const MISSING = "—";
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const formatterCache = new Map<string, Intl.NumberFormat>();

function numeric(value: NumericInput): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !DECIMAL.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatter(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options);
  const cached = formatterCache.get(key);
  if (cached) return cached;
  const created = new Intl.NumberFormat("en-US", options);
  formatterCache.set(key, created);
  return created;
}

function minus(value: string): string {
  return value.replace(/^-/, "−");
}

export function defaultCurrency(locale: Locale): "VND" | "USD" {
  return locale === "vi" ? "VND" : "USD";
}

export function formatNumber(value: NumericInput, options: NumberOptions = {}): string {
  const parsed = numeric(value);
  if (parsed == null) return MISSING;
  return minus(
    formatter({
      notation: options.compact ? "compact" : "standard",
      compactDisplay: options.compact ? "short" : undefined,
      minimumFractionDigits: options.minimumFractionDigits ?? 0,
      maximumFractionDigits: options.maximumFractionDigits ?? 4,
      signDisplay: options.signDisplay,
    }).format(parsed),
  );
}

export function formatCount(value: NumericInput): string {
  return formatNumber(value, { maximumFractionDigits: 0 });
}

export function formatMoney(
  value: NumericInput,
  options: { locale: Locale; currency?: string | null; compact?: boolean },
): string {
  const currency = options.currency?.trim() || defaultCurrency(options.locale);
  const maximumFractionDigits = currency === "VND" ? 0 : 2;
  const amount = formatNumber(value, { maximumFractionDigits, compact: options.compact });
  return amount === MISSING ? MISSING : `${amount} ${currency}`;
}

export function formatPrice(
  value: NumericInput,
  options: { locale: Locale; currency?: string | null; compact?: boolean },
): string {
  const parsed = numeric(value);
  if (parsed == null) return MISSING;
  const currency = options.currency?.trim() || defaultCurrency(options.locale);
  if (!options.compact && parsed !== 0 && Math.abs(parsed) < 0.00000001) {
    return `${parsed.toExponential(2).replace(/\.0+e/, "e").replace(/0+e/, "e")} ${currency}`;
  }
  const maximumFractionDigits = currency === "VND" ? 0 : Math.abs(parsed) < 0.01 ? 8 : 2;
  const amount = formatNumber(parsed, { maximumFractionDigits, compact: options.compact });
  return `${amount} ${currency}`;
}

export function formatPercent(
  value: NumericInput,
  options: { multiplier?: number; sign?: boolean } = {},
): string {
  const parsed = numeric(value);
  if (parsed == null) return MISSING;
  const number = formatNumber(parsed * (options.multiplier ?? 1), {
    maximumFractionDigits: 2,
    signDisplay: options.sign ? "exceptZero" : "auto",
  });
  return `${number}%`;
}

export function formatScore(value: NumericInput): string {
  return formatNumber(value, { maximumFractionDigits: 2 });
}

export function formatRatio(value: NumericInput): string {
  return formatNumber(value, { maximumFractionDigits: 4 });
}

export function formatMetricValue(
  value: NumericInput,
  options: { locale: Locale; unit?: string | null; compact?: boolean },
): string {
  const unit = options.unit?.trim();
  if (!unit) return formatRatio(value);
  if (unit === "PERCENT" || unit === "%") return formatPercent(value);
  if (unit === "INDEX") {
    const result = formatNumber(value, { maximumFractionDigits: 2, compact: options.compact });
    return result === MISSING
      ? MISSING
      : `${result} ${options.locale === "vi" ? "điểm" : "points"}`;
  }
  if (unit === "USD_MILLION") {
    const result = formatNumber(value, { maximumFractionDigits: 2, compact: options.compact });
    return result === MISSING
      ? MISSING
      : `${result} ${options.locale === "vi" ? "triệu USD" : "USD million"}`;
  }
  if (unit === "USD/barrel") {
    const result = formatNumber(value, { maximumFractionDigits: 2, compact: options.compact });
    return result === MISSING
      ? MISSING
      : `${result} ${options.locale === "vi" ? "USD/thùng" : "USD/barrel"}`;
  }
  if (unit === "contracts") {
    const result = formatCount(value);
    return result === MISSING
      ? MISSING
      : `${result} ${options.locale === "vi" ? "hợp đồng" : "contracts"}`;
  }
  if (["USD", "USDT", "VND"].includes(unit)) {
    return formatMoney(value, { locale: options.locale, currency: unit, compact: options.compact });
  }
  const result = formatNumber(value, { maximumFractionDigits: 8, compact: options.compact });
  return result === MISSING ? MISSING : `${result} ${unit}`;
}
