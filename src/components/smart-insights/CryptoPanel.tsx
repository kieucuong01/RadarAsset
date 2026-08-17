import type { MetricModel } from "@/lib/smart-insights-client";
import { useI18n } from "@/lib/i18n/context";
import { MetricPanel } from "./MetricPanel";

export function CryptoPanel({ metrics }: { metrics: MetricModel[] }) {
  const { locale } = useI18n();
  return (
    <MetricPanel
      title={locale === "vi" ? "Nhịp Quant Crypto" : "Crypto Quant Pulse"}
      description={
        locale === "vi"
          ? "Sợ hãi & Tham lam, dòng vốn ETF hằng ngày, phái sinh, chuỗi khối và thanh khoản."
          : "Fear & Greed, daily ETF flows, derivatives, on-chain and liquidity observations."
      }
      metrics={metrics}
    />
  );
}
