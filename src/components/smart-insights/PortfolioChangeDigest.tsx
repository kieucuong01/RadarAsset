"use client";

import { ArrowRight, BellRing } from "lucide-react";

import { metricLabel } from "./asset-opinion-labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PortfolioOpinionChange } from "@/lib/asset-opinion-changes";
import { formatMetricValue, formatPercent, formatScore } from "@/lib/financial-format";

export function PortfolioChangeDigest({
  changes,
  status,
  locale,
  onSelect,
}: {
  changes: PortfolioOpinionChange[];
  status: "accumulating" | "ready";
  locale: "vi" | "en";
  onSelect: (symbol: string, trigger: HTMLElement) => void;
}) {
  return (
    <Card className="overflow-hidden border-primary/20 shadow-none">
      <CardHeader className="border-b bg-primary/5">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <BellRing className="size-4" aria-hidden="true" />
          </span>
          <div>
            <CardTitle className="text-base">
              {locale === "vi" ? "Thay đổi quan trọng với danh mục" : "Important portfolio changes"}
            </CardTitle>
            <CardDescription className="mt-1">
              {locale === "vi"
                ? "So với briefing ngày trước · tối đa 3 thay đổi có ảnh hưởng lớn nhất."
                : "Versus the prior daily briefing · at most three highest-impact changes."}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {changes.length ? (
          <div className="divide-y">
            {changes.slice(0, 3).map((change) => {
              const held = Number(change.portfolioWeightPct) > 0;
              return (
                <button
                  key={change.symbol}
                  type="button"
                  className="grid w-full gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_minmax(180px,0.7fr)_auto] sm:items-center"
                  onClick={(event) => onSelect(change.symbol, event.currentTarget)}
                  aria-label={`${change.symbol} · ${locale === "vi" ? "Mở phân tích chi tiết" : "Open detailed analysis"}`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{change.symbol}</span>
                      <Badge variant={held ? "default" : "secondary"}>
                        {held
                          ? locale === "vi"
                            ? "Đang nắm giữ"
                            : "Held"
                          : locale === "vi"
                            ? "Theo dõi"
                            : "Tracked"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {change.changeType === "stance_action"
                        ? `${change.previousStance.replaceAll("_", " ")} → ${change.currentStance.replaceAll("_", " ")}`
                        : locale === "vi"
                          ? `Điểm Quant thay đổi ${formatScore(change.scoreDelta)}`
                          : `Quant score changed ${formatScore(change.scoreDelta)}`}
                    </p>
                    {held ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {locale === "vi" ? "Tỷ trọng danh mục" : "Portfolio weight"}{" "}
                        {formatPercent(change.portfolioWeightPct)}
                      </p>
                    ) : null}
                  </div>
                  <div className="min-w-0 text-xs">
                    <p className="font-medium text-muted-foreground">
                      {locale === "vi" ? "Số liệu chính" : "Primary evidence"}
                    </p>
                    <p className="mt-1 truncate font-mono tabular-nums">
                      {change.reason
                        ? `${metricLabel(change.reason.metricCode, locale)} · ${formatMetricValue(change.reason.rawValue, { locale, unit: change.reason.unit })}`
                        : "—"}
                    </p>
                  </div>
                  <ArrowRight
                    className="hidden size-4 text-muted-foreground sm:block"
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>
        ) : (
          <p className="px-4 py-5 text-sm text-muted-foreground">
            {status === "accumulating"
              ? locale === "vi"
                ? "Cần thêm một briefing daily để bắt đầu so sánh thay đổi."
                : "One more daily briefing is needed before changes can be compared."
              : locale === "vi"
                ? "Không có thay đổi định lượng quan trọng so với briefing ngày trước."
                : "No material quant change versus the prior daily briefing."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
