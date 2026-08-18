import type { PortfolioChartTimeframe } from "@/lib/backend/types";
import { useI18n } from "@/lib/i18n/context";

type PortfolioPerformanceRangeSelectorProps = {
  value: PortfolioChartTimeframe;
  onChange: (value: PortfolioChartTimeframe) => void;
};

export function PortfolioPerformanceRangeSelector({
  value,
  onChange,
}: PortfolioPerformanceRangeSelectorProps) {
  const { locale } = useI18n();
  const options: Array<{ value: PortfolioChartTimeframe; label: string }> = [
    { value: "1W", label: "1W" },
    { value: "1M", label: "1M" },
    { value: "YTD", label: "YTD" },
    { value: "1Y", label: "1Y" },
    { value: "ALL", label: locale === "vi" ? "Toàn bộ" : "All time" },
  ];

  return (
    <div
      className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1"
      aria-label={locale === "vi" ? "Khoảng thời gian biểu đồ" : "Chart time range"}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
            value === option.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
