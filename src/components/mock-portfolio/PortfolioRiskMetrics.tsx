import { Activity, AlertTriangle, Shield, Sigma, Target, TrendingDown } from "lucide-react";

import type { PortfolioRiskMetricResponse } from "@/lib/backend/types";
import { formatMoney, formatPercent, formatRatio } from "@/lib/financial-format";
import { useI18n } from "@/lib/i18n/context";

const riskIcons: Record<PortfolioRiskMetricResponse["key"], typeof Activity> = {
  beta: Activity,
  sharpe: Target,
  volatility: Sigma,
  maxDrawdown: TrendingDown,
  var95: AlertTriangle,
  diversification: Shield,
};

type PortfolioRiskMetricsProps = {
  metrics: PortfolioRiskMetricResponse[];
  currency: string;
};

export function PortfolioRiskMetrics({ metrics, currency }: PortfolioRiskMetricsProps) {
  const { t, locale } = useI18n();

  return (
    <section className="space-y-3" aria-labelledby="risk-metrics-heading">
      <div className="flex items-end justify-between">
        <div>
          <h2 id="risk-metrics-heading" className="font-semibold">
            {t("portfolio.risk.title")}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t("portfolio.risk.description")}</p>
        </div>
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {t("portfolio.risk.source")}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {metrics.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
            {t("portfolio.risk.empty")}
          </div>
        )}
        {metrics.map((metric) => {
          const Icon = riskIcons[metric.key];
          return (
            <div key={metric.key} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                  {metric.label}
                </div>
                <Icon
                  className={`w-3.5 h-3.5 ${
                    metric.tone === "bull"
                      ? "text-bull"
                      : metric.tone === "bear"
                        ? "text-bear"
                        : "text-primary"
                  }`}
                />
              </div>
              <div
                className={`mt-1.5 text-xl font-bold tabular-nums ${
                  metric.tone === "bull"
                    ? "text-bull"
                    : metric.tone === "bear"
                      ? "text-bear"
                      : "text-foreground"
                }`}
              >
                {metric.key === "var95"
                  ? formatMoney(metric.rawValue, { locale, currency })
                  : metric.key === "volatility" || metric.key === "maxDrawdown"
                    ? formatPercent(metric.rawValue)
                    : metric.key === "beta" || metric.key === "sharpe"
                      ? formatRatio(metric.rawValue)
                      : metric.value}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{metric.sub}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
