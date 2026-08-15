import { formatMetricValue } from "@/lib/financial-format";
import type { EvidenceModel } from "@/lib/smart-insights-client";

export function formatEvidenceDisplayValue(evidence: EvidenceModel, locale: "vi" | "en"): string {
  if (!evidence.rawValue?.trim() || !evidence.unit?.trim()) return evidence.displayValue;
  return formatMetricValue(evidence.rawValue, { locale, unit: evidence.unit });
}
