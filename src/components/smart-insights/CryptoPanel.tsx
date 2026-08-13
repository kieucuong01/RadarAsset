import type { MetricModel } from "@/lib/smart-insights-client";
import { MetricPanel } from "./MetricPanel";

export function CryptoPanel({ metrics }: { metrics: MetricModel[] }) {
  return (
    <MetricPanel
      title="Crypto Quant Pulse"
      description="Fear & Greed, daily ETF flows, derivatives, on-chain and liquidity observations."
      metrics={metrics}
    />
  );
}
