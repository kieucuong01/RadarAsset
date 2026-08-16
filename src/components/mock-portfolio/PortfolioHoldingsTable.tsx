import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import type { PortfolioResponse } from "@/lib/backend/types";
import {
  formatCount,
  formatMetricValue,
  formatMoney,
  formatPercent,
  formatPrice,
} from "@/lib/financial-format";
import { useI18n } from "@/lib/i18n/context";

type PortfolioHoldingsTableProps = {
  holdings: NonNullable<PortfolioResponse["holdings"]>;
  currency: string;
};

export function PortfolioHoldingsTable({ holdings, currency }: PortfolioHoldingsTableProps) {
  const { t, locale } = useI18n();

  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="p-5 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="font-semibold">{t("portfolio.holdings.title")}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("portfolio.holdings.description")}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {t("portfolio.holdings.count", { count: formatCount(holdings.length) })}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted-foreground">
            <tr className="border-b border-border">
              <th className="text-left font-medium px-5 py-3">{t("portfolio.holdings.asset")}</th>
              <th className="text-right font-medium px-5 py-3">
                {t("portfolio.holdings.quantity")}
              </th>
              <th className="text-right font-medium px-5 py-3">
                {t("portfolio.holdings.averageCost")}
              </th>
              <th className="text-right font-medium px-5 py-3">
                {t("portfolio.holdings.currentPrice")}
              </th>
              <th className="text-right font-medium px-5 py-3">
                {t("portfolio.holdings.totalValue")}
              </th>
              <th className="text-left font-medium px-5 py-3 min-w-[200px]">
                {t("portfolio.holdings.allocation")}
              </th>
              <th className="text-right font-medium px-5 py-3">
                {t("portfolio.holdings.unrealizedPnl")}
              </th>
              <th className="text-center font-medium px-5 py-3">
                {t("portfolio.holdings.signal")}
              </th>
            </tr>
          </thead>
          <tbody>
            {holdings.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">
                  {t("portfolio.holdings.empty")}
                </td>
              </tr>
            )}
            {holdings.map((holding) => {
              const up = holding.pnl >= 0;
              const holdingCurrency = holding.currency ?? currency;
              return (
                <tr
                  key={holding.ticker}
                  className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
                >
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-gradient-primary text-primary-foreground grid place-items-center text-xs font-bold">
                        {holding.ticker.slice(0, 2)}
                      </div>
                      <div>
                        <div className="font-semibold">{holding.name}</div>
                        <div className="text-xs text-muted-foreground">{holding.ticker}</div>
                      </div>
                    </div>
                  </td>
                  <td className="text-right tabular-nums px-5 py-4">
                    {formatMetricValue(holding.qty, { locale, unit: holding.ticker })}
                  </td>
                  <td className="text-right tabular-nums px-5 py-4">
                    {formatPrice(holding.cost, { locale, currency: holdingCurrency })}
                  </td>
                  <td className="text-right tabular-nums px-5 py-4">
                    {formatPrice(holding.price, { locale, currency: holdingCurrency })}
                  </td>
                  <td className="text-right tabular-nums px-5 py-4 font-medium">
                    {formatMoney(holding.value, { locale, currency: holdingCurrency })}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold tabular-nums w-10">
                        {formatPercent(holding.alloc)}
                      </span>
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-gradient-primary"
                          style={{ width: `${holding.alloc}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="text-right px-5 py-4">
                    <div className={`font-semibold tabular-nums ${up ? "text-bull" : "text-bear"}`}>
                      {holding.pnl > 0 ? "+" : ""}
                      {formatMoney(holding.pnl, { locale, currency: holdingCurrency })}
                    </div>
                    <div className={`text-xs tabular-nums ${up ? "text-bull" : "text-bear"}`}>
                      {formatPercent(holding.pnlPct, { sign: true })}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex justify-center">
                      <SentimentBadge sentiment={holding.sentiment} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SentimentBadge({ sentiment }: { sentiment: "Bullish" | "Bearish" | "Neutral" }) {
  const map = {
    Bullish: { cls: "bg-bull/15 text-bull", Icon: TrendingUp },
    Bearish: { cls: "bg-bear/15 text-bear", Icon: TrendingDown },
    Neutral: { cls: "bg-muted text-muted-foreground", Icon: Minus },
  } as const;
  const { cls, Icon } = map[sentiment];

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${cls}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {sentiment}
    </span>
  );
}
