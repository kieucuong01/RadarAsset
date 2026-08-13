import type { MetricModel } from "@/lib/smart-insights-client";
import { MetricPanel } from "./MetricPanel";

export function MacroPanel({ metrics }: { metrics: MetricModel[] }) {
  return (
    <MetricPanel
      title="Macro Regime"
      description="Official liquidity, rates, inflation, growth and positioning observations."
      metrics={metrics}
    />
  );
}
