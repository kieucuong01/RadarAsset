import type { MetricModel } from "@/lib/smart-insights-client";
import { MetricPanel } from "./MetricPanel";
import { useI18n } from "@/lib/i18n/context";

export function MacroPanel({ metrics }: { metrics: MetricModel[] }) {
  const { locale } = useI18n();
  return (
    <MetricPanel
      title={locale === "vi" ? "Chế độ vĩ mô" : "Macro Regime"}
      description={
        locale === "vi"
          ? "Quan sát thanh khoản, lãi suất, lạm phát, tăng trưởng và vị thế chính thức."
          : "Official liquidity, rates, inflation, growth and positioning observations."
      }
      metrics={metrics}
    />
  );
}
