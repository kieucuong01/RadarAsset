import type { ReactNode } from "react";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import type { PortfolioResponse } from "@/lib/backend/types";
import { useI18n } from "@/lib/i18n/context";

export function PortfolioHeader({ portfolio }: { portfolio: PortfolioResponse | null }) {
  const { t } = useI18n();
  const asOf = portfolio?.dataAsOf
    ? new Date(portfolio.dataAsOf).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : t("portfolio.header.notLoaded");

  return (
    <header className="space-y-2">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            {t("portfolio.header.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("portfolio.header.description")}</p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <DataStatusBadge status="SIMULATED" detail={t("portfolio.header.simulatedDetail")} />
          <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            <div className="font-mono uppercase tracking-wider">
              {t("portfolio.header.dataSource")}
            </div>
            <div className="mt-1 text-foreground">
              {portfolio?.dataSource ?? "local"} - {asOf}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

export function PortfolioStatusPanel({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "muted" | "bear";
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border p-6 ${
        tone === "bear" ? "border-bear/30 bg-bear/5" : "border-border bg-card"
      }`}
    >
      <h2 className={`font-semibold ${tone === "bear" ? "text-bear" : ""}`}>{title}</h2>
      <div className="text-sm text-muted-foreground mt-1">{children}</div>
    </div>
  );
}
