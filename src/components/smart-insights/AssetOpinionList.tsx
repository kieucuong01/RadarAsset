"use client";

import { AlertTriangle, CheckCircle2, CircleMinus, TrendingDown, TrendingUp } from "lucide-react";

import { FreshnessBadge } from "./FreshnessBadge";
import { failedGateLabel, isTechnicalQuantOpinion } from "./asset-opinion-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AssetOpinionModel } from "@/lib/smart-insights-client";
import { cn } from "@/lib/utils";

type Locale = "vi" | "en";

const ACTIONS: Record<string, { vi: string; en: string }> = {
  HOLD: { vi: "Giữ và theo dõi", en: "Hold and monitor" },
  REVIEW_INCREASE: { vi: "Xem xét tăng tỷ trọng", en: "Review increasing exposure" },
  REVIEW_REDUCE_RISK: { vi: "Xem xét giảm rủi ro", en: "Review reducing risk" },
  WAIT_CONFIRMATION: { vi: "Chờ dữ liệu xác nhận", en: "Wait for confirmation" },
  NO_ACTION_INSUFFICIENT_DATA: { vi: "Chưa hành động", en: "No action yet" },
};

function stanceIcon(stance: string) {
  if (stance === "POSITIVE" || stance === "CONSTRUCTIVE") return TrendingUp;
  if (stance === "NEGATIVE" || stance === "STRONGLY_NEGATIVE") return TrendingDown;
  if (stance === "INSUFFICIENT_DATA") return AlertTriangle;
  if (stance === "CAUTIOUS") return CircleMinus;
  return CheckCircle2;
}

function stanceClass(stance: string) {
  if (stance === "POSITIVE" || stance === "CONSTRUCTIVE")
    return "border-bull/30 bg-bull/10 text-bull";
  if (stance === "NEGATIVE" || stance === "STRONGLY_NEGATIVE")
    return "border-bear/30 bg-bear/10 text-bear";
  return "border-border bg-muted text-muted-foreground";
}

function actionLabel(action: string, locale: Locale) {
  return ACTIONS[action]?.[locale] ?? action.replaceAll("_", " ");
}

function explanationLabel(opinion: AssetOpinionModel, locale: Locale) {
  if (opinion.explanationStatus === "accepted") {
    return locale === "vi" ? "AI đã phân tích" : "AI analyzed";
  }
  if (opinion.explanationStatus === "quant_only") {
    if (isTechnicalQuantOpinion(opinion)) {
      return locale === "vi"
        ? "Quant kỹ thuật · Tin cậy giới hạn"
        : "Technical quant · Capped confidence";
    }
    return locale === "vi"
      ? "Phân tích định lượng · Chỉ có quan điểm định lượng"
      : "Quant analysis · Quant view only";
  }
  if (opinion.explanationStatus === "insufficient_data") {
    const reason = opinion.failedGates[0] ? failedGateLabel(opinion.failedGates[0], locale) : null;
    return locale === "vi"
      ? `Chưa đủ dữ liệu · Chưa đủ bằng chứng${reason ? `: ${reason}` : ""}`
      : `Insufficient data · Insufficient evidence${reason ? `: ${reason}` : ""}`;
  }
  if (opinion.explanationStatus === "unavailable") {
    return locale === "vi" ? "Dữ liệu chưa khả dụng" : "Data unavailable";
  }
  return null;
}

function percent(value: string, locale: Locale) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US", {
        maximumFractionDigits: 1,
      }).format(parsed) + "%"
    : "—";
}

function OpinionState({ opinion, locale }: { opinion: AssetOpinionModel; locale: Locale }) {
  const Icon = stanceIcon(opinion.stance);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline" className={cn("gap-1", stanceClass(opinion.stance))}>
        <Icon aria-hidden="true" /> {opinion.stance.replaceAll("_", " ")}
      </Badge>
      <FreshnessBadge state={opinion.freshness} />
      <span className="text-xs text-muted-foreground">
        {locale === "vi" ? "Tin cậy" : "Confidence"} {percent(opinion.confidence, locale)}
      </span>
    </div>
  );
}

export function AssetOpinionList({
  opinions,
  selectedSymbol,
  locale,
  onSelect,
}: {
  opinions: AssetOpinionModel[];
  selectedSymbol: string;
  locale: Locale;
  onSelect: (symbol: string) => void;
}) {
  return (
    <>
      <div className="hidden md:block" data-testid="asset-opinion-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{locale === "vi" ? "Tài sản" : "Asset"}</TableHead>
              <TableHead>{locale === "vi" ? "Quan điểm" : "Stance"}</TableHead>
              <TableHead className="text-right">Quant</TableHead>
              <TableHead className="text-right">
                {locale === "vi" ? "Tỷ trọng" : "Weight"}
              </TableHead>
              <TableHead>{locale === "vi" ? "Hành động" : "Action"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {opinions.map((opinion) => (
              <TableRow
                key={opinion.symbol}
                data-state={selectedSymbol === opinion.symbol ? "selected" : undefined}
              >
                <TableCell>
                  <Button
                    variant="ghost"
                    className="h-auto min-h-11 justify-start px-2 py-2 text-left"
                    aria-pressed={selectedSymbol === opinion.symbol}
                    onClick={() => onSelect(opinion.symbol)}
                  >
                    <span>
                      <span className="block font-semibold">{opinion.symbol}</span>
                      <span className="block text-xs font-normal text-muted-foreground">
                        {opinion.assetName}
                      </span>
                      {opinion.evidence.length ? (
                        <span className="mt-1 block max-w-52 truncate text-xs font-normal text-muted-foreground">
                          {opinion.evidence
                            .slice(0, 3)
                            .map((item) => item.displayValue)
                            .join(" · ")}
                        </span>
                      ) : null}
                    </span>
                  </Button>
                </TableCell>
                <TableCell>
                  <OpinionState opinion={opinion} locale={locale} />
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {opinion.quantScore ?? "—"}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {percent(opinion.portfolioWeightPct, locale)}
                </TableCell>
                <TableCell className="max-w-56 text-sm">
                  <span className="block">{actionLabel(opinion.personalizedAction, locale)}</span>
                  {explanationLabel(opinion, locale) ? (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {explanationLabel(opinion, locale)}
                    </span>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-3 md:hidden" data-testid="asset-opinion-cards">
        {opinions.map((opinion) => (
          <Button
            key={opinion.symbol}
            variant="outline"
            className={cn(
              "h-auto min-h-28 w-full justify-start whitespace-normal p-4 text-left",
              selectedSymbol === opinion.symbol && "border-primary bg-primary/5",
            )}
            aria-pressed={selectedSymbol === opinion.symbol}
            onClick={() => onSelect(opinion.symbol)}
          >
            <span className="flex w-full min-w-0 flex-col gap-3">
              <span className="flex items-start justify-between gap-3">
                <span>
                  <span className="block text-base font-semibold">{opinion.symbol}</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {opinion.assetName}
                  </span>
                </span>
                <span className="font-mono text-sm tabular-nums">{opinion.quantScore ?? "—"}</span>
              </span>
              <OpinionState opinion={opinion} locale={locale} />
              <span className="text-sm font-normal">
                {actionLabel(opinion.personalizedAction, locale)}
              </span>
              {explanationLabel(opinion, locale) ? (
                <span className="text-xs font-normal text-muted-foreground">
                  {explanationLabel(opinion, locale)}
                </span>
              ) : null}
              {opinion.evidence.length ? (
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {opinion.evidence
                    .slice(0, 3)
                    .map((item) => item.displayValue)
                    .join(" · ")}
                </span>
              ) : null}
            </span>
          </Button>
        ))}
      </div>
    </>
  );
}
