import { useMemo, useState } from "react";
import { Eye, EyeOff, TrendingDown, TrendingUp } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AssetIcon } from "@/components/AssetIcon";
import { PortfolioTransactionDialog } from "@/components/PortfolioTransactionDialog";
import type { PortfolioResponse, PortfolioTimeframe } from "@/lib/backend/types";
import { defaultCurrency, formatMoney, formatNumber, formatPercent } from "@/lib/financial-format";
import { useI18n } from "@/lib/i18n/context";

const TIMEFRAMES = ["1W", "1M", "YTD", "1Y"] as const;

const allocationColors: Record<string, string> = {
  Crypto: "var(--primary)",
  Stocks: "var(--bull)",
  Cash: "var(--muted-foreground)",
};

type PortfolioOverviewPanelProps = {
  portfolio: PortfolioResponse | null;
  timeframe: PortfolioTimeframe;
  onTimeframeChange: (timeframe: PortfolioTimeframe) => void;
  onRecorded: (portfolio: PortfolioResponse) => void;
};

export function PortfolioOverviewPanel({
  portfolio,
  timeframe,
  onTimeframeChange,
  onRecorded,
}: PortfolioOverviewPanelProps) {
  const { t, locale } = useI18n();
  const [hide, setHide] = useState(false);
  const allocationData = useMemo(
    () => portfolio?.allocation.map((item) => ({ name: item.category, value: item.value })) ?? [],
    [portfolio],
  );
  const topHoldings = useMemo(
    () =>
      [...(portfolio?.holdings ?? [])].sort((left, right) => right.alloc - left.alloc).slice(0, 8),
    [portfolio],
  );
  const totalValue = portfolio?.totalValue ?? 0;
  const totalCost = portfolio?.totalCost ?? 0;
  const unrealizedPnL = portfolio?.unrealizedPnL ?? 0;
  const realizedPnL = portfolio?.realizedPnL ?? 0;
  const totalPnL = portfolio?.totalPnL ?? 0;
  const totalPnLPct = portfolio?.totalPnLPct ?? 0;
  const day = portfolio?.dayChangePct ?? 0;
  const performance = portfolio?.performance ?? [];
  const currency = portfolio?.baseCurrency ?? defaultCurrency(locale);
  const money = (value: number) => formatMoney(value, { locale, currency });
  const signedMoney = (value: number) => `${value > 0 ? "+" : ""}${money(value)}`;

  return (
    <section className="grid lg:grid-cols-2 gap-6" aria-labelledby="overview-heading">
      <h2 id="overview-heading" className="sr-only">
        {t("portfolio.header.title")}
      </h2>

      <div className="space-y-6">
        <div className="rounded-2xl p-7 border border-border bg-card shadow-elegant">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {t("portfolio.balance.total")}
              <button
                onClick={() => setHide(!hide)}
                className="hover:text-foreground"
                aria-label={t("portfolio.balance.toggle")}
              >
                {hide ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <PortfolioTransactionDialog
              holdings={portfolio?.holdings ?? []}
              disabled={!portfolio}
              timeframe={timeframe}
              onRecorded={onRecorded}
              portfolioCurrency={currency}
            />
          </div>
          <div className="mt-2 text-5xl md:text-6xl font-bold tracking-tight tabular-nums">
            {hide ? "******" : money(totalValue)}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span
              className={`inline-flex items-center gap-1 text-xs font-semibold px-3 py-1 rounded-full ${
                day >= 0 ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"
              }`}
            >
              {day >= 0 ? (
                <TrendingUp className="w-3.5 h-3.5" />
              ) : (
                <TrendingDown className="w-3.5 h-3.5" />
              )}
              {formatPercent(day, { sign: true })} 24h
            </span>
            <span className="text-xs text-muted-foreground">
              {t("portfolio.balance.totalPnl")}:{" "}
              <span className={totalPnL >= 0 ? "text-bull" : "text-bear"}>
                {signedMoney(totalPnL)} ({formatPercent(totalPnLPct, { sign: true })})
              </span>
            </span>
          </div>
          <div className="mt-5 grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                {t("portfolio.balance.openCost")}
              </div>
              <div className="mt-1 font-semibold tabular-nums">
                {hide ? "******" : money(totalCost)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                {t("portfolio.balance.unrealized")}
              </div>
              <div
                className={`mt-1 font-semibold tabular-nums ${
                  unrealizedPnL >= 0 ? "text-bull" : "text-bear"
                }`}
              >
                {hide ? "******" : signedMoney(unrealizedPnL)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                {t("portfolio.balance.realized")}
              </div>
              <div
                className={`mt-1 font-semibold tabular-nums ${
                  realizedPnL >= 0 ? "text-bull" : "text-bear"
                }`}
              >
                {hide ? "******" : signedMoney(realizedPnL)}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl p-6 border border-border bg-card">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{t("portfolio.allocation.title")}</h2>
            <span className="text-xs text-muted-foreground">
              {t("portfolio.allocation.byCategory")}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-[1fr_auto] items-center gap-4">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={allocationData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                    outerRadius={95}
                    paddingAngle={3}
                    stroke="var(--card)"
                    strokeWidth={3}
                  >
                    {allocationData.map((item) => (
                      <Cell
                        key={item.name}
                        fill={allocationColors[item.name] ?? "var(--primary)"}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value: number) => [
                      formatPercent(value),
                      t("portfolio.allocation.tooltip"),
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="space-y-3 pr-2">
              {allocationData.map((item) => (
                <li key={item.name} className="flex items-center gap-3 text-sm">
                  <span
                    className="w-3 h-3 rounded-sm"
                    style={{ backgroundColor: allocationColors[item.name] ?? "var(--primary)" }}
                  />
                  <span className="text-muted-foreground w-16">{item.name}</span>
                  <span className="font-semibold tabular-nums">{formatPercent(item.value)}</span>
                </li>
              ))}
            </ul>
          </div>
          {topHoldings.length ? (
            <div className="mt-4 border-t border-border pt-4">
              <p className="mb-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                {locale === "vi" ? "Phân bổ theo mã" : "Allocation by symbol"}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {topHoldings.map((holding) => (
                  <div
                    key={holding.assetId}
                    className="flex items-center justify-between gap-3 rounded-lg bg-muted/35 px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <AssetIcon symbol={holding.ticker} name={holding.name} size="sm" />
                      <span className="truncate text-sm font-medium">{holding.ticker}</span>
                    </div>
                    <span className="text-xs font-semibold tabular-nums">
                      {formatPercent(holding.alloc)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl p-6 border border-border bg-card flex flex-col">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold">{t("portfolio.performance.title")}</h2>
            <p className="text-xs text-muted-foreground mt-1">
              {t("portfolio.performance.description")}
            </p>
          </div>
          <div className="inline-flex items-center rounded-lg border border-border bg-muted/40 p-1">
            {TIMEFRAMES.map((item) => (
              <button
                key={item}
                onClick={() => onTimeframeChange(item)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  timeframe === item
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-6 text-xs">
          <span className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-primary" /> {t("common.portfolio")}
          </span>
          <span className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground" /> VNINDEX
          </span>
        </div>

        <div className="flex-1 mt-4 min-h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={performance} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="gPort" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gBench" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--muted-foreground)" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="var(--muted-foreground)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                width={40}
                tickFormatter={(value: number) => formatNumber(value)}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value) => formatNumber(Number(value))}
              />
              <Area
                type="monotone"
                dataKey="Portfolio"
                stroke="var(--primary)"
                strokeWidth={2.2}
                fill="url(#gPort)"
              />
              <Area
                type="monotone"
                dataKey="Benchmark"
                stroke="var(--muted-foreground)"
                strokeWidth={1.8}
                strokeDasharray="4 3"
                fill="url(#gBench)"
              />
              <Legend wrapperStyle={{ display: "none" }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
