"use client";

import { Play, Sparkles } from "lucide-react";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import type { BriefingModel, RegimeModel } from "@/lib/smart-insights-client";
import { useI18n } from "@/lib/i18n/context";

const SAMPLE_SUMMARY = {
  vi: [
    "Ví dụ: kiểm tra thay đổi dòng tiền và thanh khoản trước khi điều chỉnh danh mục.",
    "Ví dụ: theo dõi sự kiện vĩ mô có thể làm biến động lợi suất và USD.",
    "Ví dụ: đối chiếu xu hướng vàng với lợi suất thực và vị thế thị trường.",
  ],
  en: [
    "Example: review flow and liquidity changes before adjusting the portfolio.",
    "Example: monitor macro events that can move yields and the dollar.",
    "Example: compare gold momentum with real yields and positioning.",
  ],
};

export function LegacyDailyHero({
  briefing,
  regimes,
}: {
  briefing: BriefingModel | null;
  regimes: RegimeModel[];
}) {
  const { locale, t } = useI18n();
  const liveLines = briefing?.primary
    .slice(0, 3)
    .map((item) => item.headline ?? item.whatChanged ?? `${item.market}: ${item.regimeLabel}`);
  const lines = liveLines?.length ? liveLines : SAMPLE_SUMMARY[locale];
  const date =
    briefing?.localDate ??
    new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
      dateStyle: "full",
    }).format(new Date());
  const directionByMarket = new Map(
    regimes.map((regime) => [regime.market, Number(regime.score ?? 0) >= 0 ? "▲" : "▼"]),
  );

  return (
    <section
      className="relative overflow-hidden rounded-3xl p-8 text-primary-foreground shadow-elegant md:p-12"
      style={{ backgroundImage: "var(--gradient-hero)" }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-30 mix-blend-overlay"
        style={{ backgroundImage: "radial-gradient(circle at 80% 20%, white, transparent 40%)" }}
      />
      <div className="relative grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-bold tracking-widest backdrop-blur">
              <Sparkles className="size-3.5" /> {t("overview.hero.badge")}
            </span>
            <DataStatusBadge
              status={briefing ? "SYSTEM" : "SAMPLE"}
              className="border-white/30 bg-white/10 text-white"
            />
            <span className="text-sm text-white/80">{date}</span>
          </div>
          <h1 className="max-w-2xl text-3xl font-bold leading-tight tracking-tight md:text-5xl">
            {t("overview.hero.title")}
          </h1>
          <ul className="max-w-3xl space-y-2 text-white/90">
            {lines.map((line, index) => {
              const market = ["crypto", "macro", "gold"][index] as "crypto" | "macro" | "gold";
              const direction = briefing ? (directionByMarket.get(market) ?? "•") : "•";
              return (
                <li key={`${market}-${line}`} className="flex gap-3">
                  <span className={direction === "▼" ? "text-bear" : "text-bull"}>{direction}</span>
                  <span>{line}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <button
          type="button"
          disabled
          title={t("common.unavailableMvp")}
          className="group flex items-center gap-4 rounded-2xl border border-white/20 bg-white/10 px-5 py-4 opacity-60 backdrop-blur"
        >
          <span className="grid size-14 place-items-center rounded-full bg-white text-primary shadow-glow">
            <Play className="size-6 fill-current" />
          </span>
          <span className="text-left">
            <span className="block text-sm font-semibold">{t("overview.hero.listen")}</span>
            <span className="block text-xs text-white/70">{t("common.unavailableMvp")}</span>
          </span>
        </button>
      </div>
    </section>
  );
}
