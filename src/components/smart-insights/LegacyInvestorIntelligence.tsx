"use client";

import { useEffect, useState } from "react";
import { Activity, ShieldAlert, Sparkles, TrendingUp } from "lucide-react";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import type { AssetIntelligenceResponse, ResearchRunResponse } from "@/lib/backend/types";
import { useI18n } from "@/lib/i18n/context";

const ASSETS = ["BTC", "ETH", "SPY", "QQQ", "GOLD", "VN30"];

const SAMPLE_INTELLIGENCE = {
  vi: {
    summary: "Ví dụ: luận điểm đầu tư được tổng hợp từ tín hiệu, bằng chứng và forecast đã lưu.",
    catalysts: ["Ví dụ: tín hiệu dòng tiền được xác nhận", "Ví dụ: động lượng cải thiện"],
    risks: ["Ví dụ: dữ liệu nguồn trở nên cũ", "Ví dụ: sự kiện vĩ mô tạo biến động"],
  },
  en: {
    summary:
      "Example: an investment thesis synthesized from stored signals, evidence and forecasts.",
    catalysts: ["Example: flow signal is confirmed", "Example: momentum improves"],
    risks: ["Example: source data becomes stale", "Example: macro event raises volatility"],
  },
};

export function LegacyInvestorIntelligence() {
  const { locale, t } = useI18n();
  const [symbol, setSymbol] = useState("BTC");
  const [intelligence, setIntelligence] = useState<AssetIntelligenceResponse | null>(null);
  const [runs, setRuns] = useState<ResearchRunResponse[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([
      fetch(`/api/assets/${encodeURIComponent(symbol)}/intelligence`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      }).then((response) => {
        if (!response.ok) throw new Error("Asset intelligence unavailable");
        return response.json() as Promise<AssetIntelligenceResponse>;
      }),
      fetch("/api/research/runs", {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      }).then((response) => {
        if (!response.ok) throw new Error("Research runs unavailable");
        return response.json() as Promise<ResearchRunResponse[]>;
      }),
    ]).then(([intelligenceResult, runsResult]) => {
      if (controller.signal.aborted) return;
      if (intelligenceResult.status === "fulfilled") setIntelligence(intelligenceResult.value);
      else setIntelligence(null);
      if (runsResult.status === "fulfilled") setRuns(runsResult.value);
      else setRuns([]);
      setError(
        intelligenceResult.status === "rejected" && runsResult.status === "rejected"
          ? locale === "vi"
            ? "Không tải được dữ liệu Investor Intelligence; đang hiển thị dữ liệu mẫu."
            : "Investor Intelligence is unavailable; showing sample data."
          : null,
      );
    });
    return () => controller.abort();
  }, [locale, symbol]);

  const isSeeded =
    !intelligence || intelligence.evidence.some((item) => item.url?.includes("example.com"));
  const sample = SAMPLE_INTELLIGENCE[locale];
  const catalysts = intelligence?.topCatalysts.length
    ? intelligence.topCatalysts
    : sample.catalysts;
  const risks = intelligence?.topRisks.length ? intelligence.topRisks : sample.risks;
  const forecast = intelligence?.forecasts[0];
  const stance = intelligence?.stance ?? "watch";
  const score = intelligence?.score ?? null;

  return (
    <section className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.9fr)]">
      <div className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-6 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-semibold">
              <Sparkles className="size-4 text-primary" />
              {t("overview.intelligence.title")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("overview.intelligence.description")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DataStatusBadge status={isSeeded ? "SAMPLE" : "SYSTEM"} detail={error ?? undefined} />
            <select
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
              className="h-9 rounded-lg border border-border bg-background px-3 text-xs font-semibold outline-none"
            >
              {ASSETS.map((asset) => (
                <option key={asset} value={asset}>
                  {asset}
                </option>
              ))}
            </select>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary">
              {stance.toUpperCase()} / {score ?? "—"}
            </span>
          </div>
        </div>

        {error ? (
          <div className="border-b border-chart-4/20 bg-chart-4/5 px-6 py-3 text-sm text-chart-4">
            {error}
          </div>
        ) : null}

        <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="min-w-0 space-y-5">
            <div>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {t("overview.intelligence.activeThesis")}
              </div>
              <p className="text-sm leading-relaxed">{intelligence?.summary ?? sample.summary}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <SignalList
                title={t("overview.intelligence.catalysts")}
                tone="bull"
                items={catalysts}
              />
              <SignalList title={t("overview.intelligence.risks")} tone="bear" items={risks} />
            </div>
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {t("overview.intelligence.evidenceTrail")}
              </div>
              <div className="space-y-3">
                {intelligence?.evidence.slice(0, 3).map((item) => (
                  <div key={item.id} className="text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="line-clamp-1 font-medium">{item.title}</span>
                      <span className="font-mono text-[10px] uppercase text-muted-foreground">
                        {item.sourceType}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {item.excerpt}
                    </p>
                  </div>
                ))}
                {!intelligence?.evidence.length ? (
                  <p className="text-xs text-muted-foreground">
                    {t("overview.intelligence.noEvidence")}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-background/60 p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {t("overview.intelligence.sentimentMix")}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                {(["bull", "bear", "neutral"] as const).map((key) => (
                  <div key={key} className="rounded-lg bg-muted/50 p-2">
                    <div className="text-xl font-bold tabular-nums">
                      {intelligence?.sentimentBreakdown[key] ?? 0}
                    </div>
                    <div className="text-[10px] uppercase text-muted-foreground">{key}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-background/60 p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {t("overview.intelligence.forecast")}
              </div>
              {forecast ? (
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{forecast.horizon}</dt>
                    <dd className="font-bold tabular-nums">
                      {forecast.targetPrice.toLocaleString()}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Expected</dt>
                    <dd
                      className={
                        forecast.expectedReturnPct >= 0
                          ? "font-bold text-bull"
                          : "font-bold text-bear"
                      }
                    >
                      {forecast.expectedReturnPct.toFixed(2)}%
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Confidence</dt>
                    <dd className="font-bold">{forecast.confidence}%</dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                  {t("overview.intelligence.noForecast")}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <Activity className="size-4 text-primary" /> {t("overview.intelligence.researchRuns")}
          </h2>
          <DataStatusBadge status={runs.length ? "SYSTEM" : "SAMPLE"} />
        </div>
        <div className="max-h-[430px] divide-y divide-border overflow-y-auto">
          {runs.slice(0, 6).map((run) => (
            <div key={run.id} className="p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold">{run.source}</div>
                <span className="font-mono text-[10px] uppercase text-muted-foreground">
                  {run.status}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {run.kind}
                {run.symbol ? ` / ${run.symbol}` : ""}
              </div>
              {run.summary ? <p className="mt-2 line-clamp-2 text-xs">{run.summary}</p> : null}
            </div>
          ))}
          {!runs.length ? (
            <div className="p-5 text-xs text-muted-foreground">
              {locale === "vi"
                ? "Ví dụ: research run và kết quả kiểm định sẽ xuất hiện tại đây."
                : "Example: research runs and validation results appear here."}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function SignalList({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "bull" | "bear";
  items: string[];
}) {
  const Icon = tone === "bull" ? TrendingUp : ShieldAlert;
  return (
    <div className="rounded-xl border border-border bg-background/60 p-4">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-sm">
            <Icon
              className={
                tone === "bull"
                  ? "mt-0.5 size-4 shrink-0 text-bull"
                  : "mt-0.5 size-4 shrink-0 text-bear"
              }
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
