"use client";

import {
  ArrowUpRight,
  Brain,
  CheckCircle2,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/context";
import type { BriefingModel, PreferencesModel } from "@/lib/smart-insights-client";

const SAMPLE_DRIVERS = {
  vi: [
    "Ví dụ: xác nhận dòng tiền trước khi tăng mức độ rủi ro.",
    "Ví dụ: đối chiếu tín hiệu với lịch sự kiện quan trọng.",
    "Ví dụ: kiểm tra độ mới của dữ liệu nguồn.",
  ],
  en: [
    "Example: confirm flows before increasing risk.",
    "Example: compare signals with high-impact events.",
    "Example: verify source freshness before acting.",
  ],
};

export function LegacyAIDigest({
  briefing,
  preferences,
  onEvidence,
}: {
  briefing: BriefingModel | null;
  preferences: PreferencesModel | null;
  onEvidence: (id: string) => void;
}) {
  const { locale, t } = useI18n();
  const primary = briefing?.primary[0];
  const drivers = briefing?.primary
    .slice(0, 4)
    .map((item) => item.whatChanged ?? item.headline ?? `${item.market}: ${item.regimeLabel}`);
  const risk = briefing?.riskAlerts[0];
  const confidence = briefing ? Math.round(Number(briefing.overallDataConfidence) * 100) : 0;
  const status = briefing ? "SYSTEM" : "SAMPLE";

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
            <Brain className="size-5" />
          </span>
          <div>
            <h2 className="flex flex-wrap items-center gap-2 font-semibold">
              {t("overview.digest.title")}
              <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary">
                {t("overview.digest.badge")}
              </span>
              <DataStatusBadge status={status} />
            </h2>
            <p className="text-xs text-muted-foreground">
              {briefing
                ? `${briefing.status} · revision ${briefing.revision}`
                : locale === "vi"
                  ? "Chưa có daily briefing được chấp nhận; đang hiển thị nội dung minh họa."
                  : "No accepted daily briefing; showing illustrative content."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono uppercase tracking-wider text-muted-foreground">
            Confidence
          </span>
          <div className="h-2 w-28 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-gradient-primary" style={{ width: `${confidence}%` }} />
          </div>
          <span className="font-bold tabular-nums text-primary">{confidence || "—"}%</span>
        </div>
      </div>

      <div className="grid divide-y divide-border lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:divide-x lg:divide-y-0">
        <div className="min-w-0 space-y-5 p-6">
          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("overview.digest.thesisTitle")}
            </div>
            <p className="text-base leading-relaxed">
              {primary?.whyItMatters ??
                primary?.headline ??
                (locale === "vi"
                  ? "Ví dụ: tổng hợp định lượng hằng ngày sẽ xuất hiện tại đây khi đủ dữ liệu."
                  : "Example: the daily quantitative synthesis appears here when coverage is sufficient.")}
            </p>
          </div>
          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("overview.digest.keyDrivers")}
            </div>
            <ul className="space-y-2 text-sm">
              {(drivers?.length ? drivers : SAMPLE_DRIVERS[locale]).map((driver, index) => {
                const Icon = index === 1 ? TrendingDown : TrendingUp;
                return (
                  <li key={driver} className="flex gap-2.5">
                    <Icon
                      className={
                        index === 1
                          ? "mt-0.5 size-4 shrink-0 text-bear"
                          : "mt-0.5 size-4 shrink-0 text-bull"
                      }
                    />
                    {driver}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="min-w-0 space-y-5 bg-muted/20 p-6">
          <div>
            <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("overview.digest.stanceTitle")}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-sm font-bold text-primary">
                <TrendingUp className="size-3.5" /> {primary?.regimeLabel ?? "REVIEW"}
              </span>
              <span className="text-xs text-muted-foreground">
                {preferences?.preference.riskTolerance ?? "moderate"}
              </span>
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <Target className="size-3" /> {t("overview.digest.actions")}
            </div>
            <ul className="space-y-2 text-sm">
              {(primary?.suggestedCheckTemplate
                ? [primary.suggestedCheckTemplate, ...primary.riskScenarios]
                : SAMPLE_DRIVERS[locale]
              )
                .slice(0, 4)
                .map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>{item}</span>
                  </li>
                ))}
            </ul>
          </div>
          <div className="flex gap-2.5 rounded-xl border border-bear/20 bg-bear/5 p-3 text-xs">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-bear" />
            <div>
              <div className="mb-0.5 font-semibold text-bear">{t("overview.digest.riskWatch")}</div>
              <span className="text-muted-foreground">
                {risk?.headline ?? risk?.whatChanged ?? t("overview.digest.riskWatchBody")}
              </span>
            </div>
          </div>
          {primary?.supportingEvidenceIds[0] ? (
            <Button
              className="w-full"
              variant="outline"
              onClick={() => onEvidence(primary.supportingEvidenceIds[0])}
            >
              <Sparkles /> Evidence <ArrowUpRight data-icon="inline-end" />
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
