"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, Filter, Search } from "lucide-react";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import { useI18n } from "@/lib/i18n/context";

type Signal = {
  id: string;
  source: string;
  asset: string;
  sentiment: "bull" | "bear" | "neutral";
  title: string;
  summary: string;
  ago: string;
};

const SAMPLE_EXPERT_SIGNALS: Signal[] = [
  {
    id: "sample-flow",
    source: "Research Workbench",
    asset: "BTC",
    sentiment: "bull",
    title: "Ví dụ: dòng tiền được cải thiện",
    summary: "Tín hiệu mẫu minh họa cách một nhận định có bằng chứng sẽ xuất hiện trong feed.",
    ago: "mẫu",
  },
  {
    id: "sample-macro",
    source: "Macro Research",
    asset: "Macro",
    sentiment: "bear",
    title: "Ví dụ: lợi suất thực tạo áp lực",
    summary:
      "Nội dung minh họa cho một kịch bản rủi ro vĩ mô, không phải nhận định thị trường hiện tại.",
    ago: "mẫu",
  },
  {
    id: "sample-gold",
    source: "Gold Research",
    asset: "GOLD",
    sentiment: "neutral",
    title: "Ví dụ: vàng chờ xác nhận xu hướng",
    summary: "Nội dung mẫu để giữ nguyên chức năng lọc và bố cục Expert Signals cũ.",
    ago: "mẫu",
  },
];

export function LegacyExpertSignals() {
  const { locale, t } = useI18n();
  const [signals, setSignals] = useState<Signal[]>(SAMPLE_EXPERT_SIGNALS);
  const [query, setQuery] = useState("");
  const [asset, setAsset] = useState("all");
  const [source, setSource] = useState("all");
  const [sentiment, setSentiment] = useState<Signal["sentiment"] | "all">("all");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/insights", { signal: controller.signal, headers: { Accept: "application/json" } })
      .then((response) => {
        if (!response.ok) throw new Error("Insights unavailable");
        return response.json() as Promise<
          Array<Partial<Signal> & Pick<Signal, "id" | "asset" | "sentiment" | "title" | "summary">>
        >;
      })
      .then((rows) => {
        if (controller.signal.aborted || !rows.length) return;
        setSignals(
          rows.map((row) => ({
            id: row.id,
            source: row.source ?? "Research Workbench",
            asset: row.asset,
            sentiment: row.sentiment,
            title: row.title,
            summary: row.summary,
            ago: row.ago ?? (locale === "vi" ? "đã lưu" : "stored"),
          })),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setSignals(SAMPLE_EXPERT_SIGNALS);
      });
    return () => controller.abort();
  }, [locale]);

  const assets = useMemo(() => [...new Set(signals.map((item) => item.asset))].sort(), [signals]);
  const sources = useMemo(() => [...new Set(signals.map((item) => item.source))].sort(), [signals]);
  const filtered = useMemo(
    () =>
      signals.filter((item) => {
        if (asset !== "all" && item.asset !== asset) return false;
        if (source !== "all" && item.source !== source) return false;
        if (sentiment !== "all" && item.sentiment !== sentiment) return false;
        return (
          !query.trim() ||
          `${item.title} ${item.summary}`.toLowerCase().includes(query.toLowerCase())
        );
      }),
    [asset, query, sentiment, signals, source],
  );

  return (
    <section aria-labelledby="expert-signals-heading">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="expert-signals-heading" className="text-2xl font-bold tracking-tight">
              {t("overview.news.title")}
            </h2>
            <DataStatusBadge status="SAMPLE" />
          </div>
          <p className="text-sm text-muted-foreground">
            {locale === "vi"
              ? "Feed này hiện dùng dữ liệu seed để giữ nguyên tính năng UI cũ."
              : "This feed currently uses seed data to preserve the former UI feature."}
          </p>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          {filtered.length} / {signals.length}
        </span>
      </div>

      <div className="mb-5 grid gap-3 rounded-2xl border border-border bg-card p-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
        <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("overview.news.search")}
            className="w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <SignalSelect
          icon={<Filter className="size-3.5" />}
          label={t("overview.news.asset")}
          value={asset}
          onChange={setAsset}
          options={[
            { value: "all", label: t("overview.news.allAssets") },
            ...assets.map((value) => ({ value, label: value })),
          ]}
        />
        <SignalSelect
          label={t("overview.news.source")}
          value={source}
          onChange={setSource}
          options={[
            { value: "all", label: t("overview.news.allSources") },
            ...sources.map((value) => ({ value, label: value })),
          ]}
        />
        <div className="inline-flex items-center rounded-lg border border-border bg-muted/40 p-0.5">
          {(["all", "bull", "bear", "neutral"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setSentiment(value)}
              className={
                sentiment === value
                  ? "rounded-md bg-background px-2.5 py-1.5 text-[11px] font-semibold shadow-sm"
                  : "rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
              }
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      {filtered.length ? (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => (
            <article
              key={item.id}
              className="group flex flex-col rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-elegant"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    {item.source}
                  </span>
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                    {item.asset}
                  </span>
                </div>
                <span
                  className={
                    item.sentiment === "bull"
                      ? "rounded-full border border-bull/20 bg-bull/10 px-2 py-1 text-[10px] font-semibold text-bull"
                      : item.sentiment === "bear"
                        ? "rounded-full border border-bear/20 bg-bear/10 px-2 py-1 text-[10px] font-semibold text-bear"
                        : "rounded-full border px-2 py-1 text-[10px] font-semibold text-muted-foreground"
                  }
                >
                  {item.sentiment}
                </span>
              </div>
              <h3 className="mb-2 line-clamp-2 text-lg font-semibold leading-snug">{item.title}</h3>
              <p className="line-clamp-3 flex-1 text-sm text-muted-foreground">{item.summary}</p>
              <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3" /> {item.ago}
                </span>
                <span>{locale === "vi" ? "Dữ liệu mẫu" : "Sample data"}</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed p-12 text-center text-muted-foreground">
          <Search className="mx-auto mb-3 size-8 opacity-50" />
          {t("overview.news.empty")}
        </div>
      )}
    </section>
  );
}

function SignalSelect({
  label,
  value,
  onChange,
  options,
  icon,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  icon?: React.ReactNode;
}) {
  return (
    <label className="inline-flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs">
      {icon}
      <span className="hidden text-muted-foreground sm:inline">{label}:</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="cursor-pointer bg-transparent pr-1 font-semibold outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
