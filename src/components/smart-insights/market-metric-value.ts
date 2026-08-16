import { formatMetricValue, formatPercent } from "@/lib/financial-format";
import type { Locale } from "@/lib/i18n/dictionary";
import type { MetricModel } from "@/lib/smart-insights-client";

export function formatMarketMetric(row: MetricModel, locale: Locale) {
  const unit = row.unit.trim();
  const normalized = unit.toLowerCase().replaceAll("_", " ");
  if (normalized === "return" || normalized === "ratio change") {
    return formatPercent(row.value, { multiplier: 100 });
  }
  if (["%", "% yoy", "percent", "rate"].includes(normalized)) {
    return formatPercent(row.value);
  }
  if (normalized === "index") {
    return formatMetricValue(row.value, { locale, unit: "INDEX" });
  }
  if (normalized === "usd million") {
    return formatMetricValue(row.value, { locale, unit: "USD_MILLION" });
  }
  return formatMetricValue(row.value, { locale, unit });
}
