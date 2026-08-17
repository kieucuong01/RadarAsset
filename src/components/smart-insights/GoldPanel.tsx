import type { MetricModel } from "@/lib/smart-insights-client";
import { MetricPanel } from "./MetricPanel";
import { useI18n } from "@/lib/i18n/context";

export function GoldPanel({ metrics }: { metrics: MetricModel[] }) {
  const { locale } = useI18n();
  return (
    <MetricPanel
      title={locale === "vi" ? "Chế độ vàng" : "Gold Regime"}
      description={
        locale === "vi"
          ? "Động lượng XAU, lợi suất thực, áp lực USD, ETF, CFTC và nhu cầu ngân hàng trung ương."
          : "XAU momentum, real yields, USD pressure, ETF, CFTC and central-bank demand."
      }
      metrics={metrics}
    />
  );
}
