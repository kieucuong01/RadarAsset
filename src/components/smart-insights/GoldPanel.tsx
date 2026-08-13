import type { MetricModel } from "@/lib/smart-insights-client";
import { MetricPanel } from "./MetricPanel";

export function GoldPanel({ metrics }: { metrics: MetricModel[] }) {
  return (
    <MetricPanel
      title="Gold Regime"
      description="XAU momentum, real yields, USD pressure, ETF, CFTC and central-bank demand."
      metrics={metrics}
    />
  );
}
