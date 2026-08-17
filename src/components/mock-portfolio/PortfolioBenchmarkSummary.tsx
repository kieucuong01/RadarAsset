import type { PortfolioBenchmarkSummary as Benchmark } from "@/lib/backend/types";
import { formatMoney, formatPercent } from "@/lib/financial-format";
import { useI18n } from "@/lib/i18n/context";

export function PortfolioBenchmarkSummary({
  benchmark,
  currency,
}: {
  benchmark: Benchmark | undefined;
  currency: string;
}) {
  const { locale } = useI18n();
  if (!benchmark) return null;
  const money = (value: number) => formatMoney(value, { locale, currency });
  const excessPositive = (benchmark.excessValue ?? 0) >= 0;

  return (
    <div
      className="mt-5 grid gap-3 md:grid-cols-3"
      aria-label={locale === "vi" ? "So sánh tiền với VNINDEX" : "Money comparison with VNINDEX"}
    >
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
        <div className="text-xs text-muted-foreground">
          {locale === "vi" ? "Danh mục hiện có" : "Current portfolio"}
        </div>
        <div className="mt-1 text-lg font-bold tabular-nums">{money(benchmark.portfolioValue)}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {formatPercent(benchmark.portfolioReturnPct, { sign: true })}
        </div>
      </div>
      <div className="rounded-xl border border-border bg-muted/25 p-4">
        <div className="text-xs text-muted-foreground">
          {locale === "vi" ? "Nếu cùng dòng tiền vào VNINDEX" : "Same cash flows in VNINDEX"}
        </div>
        <div className="mt-1 text-lg font-bold tabular-nums">
          {benchmark.benchmarkValue === null ? "–" : money(benchmark.benchmarkValue)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {benchmark.benchmarkReturnPct === null
            ? "–"
            : formatPercent(benchmark.benchmarkReturnPct, { sign: true })}
        </div>
      </div>
      <div
        className={`rounded-xl border p-4 ${excessPositive ? "border-bull/25 bg-bull/5" : "border-bear/25 bg-bear/5"}`}
      >
        <div className="text-xs text-muted-foreground">
          {locale === "vi" ? "Vượt benchmark" : "Excess vs benchmark"}
        </div>
        <div
          className={`mt-1 text-lg font-bold tabular-nums ${excessPositive ? "text-bull" : "text-bear"}`}
        >
          {benchmark.excessValue === null
            ? "–"
            : `${benchmark.excessValue > 0 ? "+" : ""}${money(benchmark.excessValue)}`}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {benchmark.excessReturnPct === null
            ? "–"
            : formatPercent(benchmark.excessReturnPct, { sign: true })}
        </div>
      </div>
    </div>
  );
}
