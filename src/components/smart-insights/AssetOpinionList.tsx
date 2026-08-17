"use client";

import Link from "next/link";
import type { KeyboardEvent, MouseEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleMinus,
  FlaskConical,
  ShoppingCart,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { FreshnessBadge } from "./FreshnessBadge";
import { failedGateLabel, isTechnicalQuantOpinion } from "./asset-opinion-labels";
import { AssetIcon } from "@/components/AssetIcon";
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
import type { AssetOpinionWorkspaceItem } from "@/lib/asset-opinion-workspace";
import { formatMetricValue, formatPercent, formatPrice, formatScore } from "@/lib/financial-format";
import type { AssetOpinionModel } from "@/lib/smart-insights-client";
import { cn } from "@/lib/utils";

type Locale = "vi" | "en";
type TradeSide = "buy" | "sell";

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

function activateOnKeyboard(event: KeyboardEvent, activate: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activate();
}

function stopRowActivation(event: MouseEvent) {
  event.stopPropagation();
}

function explanationLabel(opinion: AssetOpinionModel, locale: Locale) {
  if (opinion.explanationStatus === "accepted")
    return locale === "vi" ? "AI đã phân tích" : "AI analyzed";
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
  if (opinion.explanationStatus === "unavailable")
    return locale === "vi" ? "Dữ liệu chưa khả dụng" : "Data unavailable";
  return null;
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
        {locale === "vi" ? "Tin cậy" : "Confidence"} {formatPercent(opinion.confidence)}
      </span>
    </div>
  );
}

function PendingOpinion({ locale, label }: { locale: Locale; label: string | null }) {
  if (!label) return <span className="text-muted-foreground">—</span>;
  return (
    <div>
      <Badge variant="secondary">{label}</Badge>
      <p className="mt-1 text-xs text-muted-foreground">
        {locale === "vi"
          ? "Bản phân tích không có đủ bằng chứng định lượng cho tài sản này."
          : "The analysis did not have enough quantitative evidence for this asset."}
      </p>
    </div>
  );
}

function ItemActions({
  item,
  locale,
  tradingAvailable,
  onTrade,
  onRemove,
}: {
  item: AssetOpinionWorkspaceItem;
  locale: Locale;
  tradingAvailable: boolean;
  onTrade: (item: AssetOpinionWorkspaceItem, side: TradeSide) => void;
  onRemove: (item: AssetOpinionWorkspaceItem) => void;
}) {
  const buy = locale === "vi" ? "Mua" : "Buy";
  const sell = locale === "vi" ? "Bán" : "Sell";
  return (
    <div className="flex flex-wrap items-center gap-1.5" onClick={stopRowActivation}>
      <Button
        size="sm"
        variant="outline"
        aria-label={`${buy} ${item.symbol}`}
        title={
          tradingAvailable
            ? undefined
            : locale === "vi"
              ? "Danh mục hiện chưa khả dụng"
              : "Portfolio unavailable"
        }
        disabled={!tradingAvailable}
        onClick={() => onTrade(item, "buy")}
      >
        <ShoppingCart aria-hidden="true" /> {buy}
      </Button>
      <Button
        size="sm"
        variant="outline"
        aria-label={`${sell} ${item.symbol}`}
        title={item.canSell ? undefined : locale === "vi" ? "Chưa nắm giữ mã này" : "No holding"}
        disabled={!item.canSell}
        onClick={() => onTrade(item, "sell")}
      >
        <TrendingDown aria-hidden="true" /> {sell}
      </Button>
      {item.backtestHref ? (
        <Button size="sm" variant="secondary" asChild>
          <Link href={item.backtestHref} aria-label={`Backtest ${item.symbol}`}>
            <FlaskConical aria-hidden="true" /> Backtest
          </Link>
        </Button>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          aria-label={`Backtest ${item.symbol}`}
          title={locale === "vi" ? "Đang chuẩn bị dữ liệu backtest" : "Preparing backtest data"}
          disabled
        >
          <FlaskConical aria-hidden="true" /> Backtest
        </Button>
      )}
      {item.canRemove ? (
        <Button
          size="icon"
          variant="ghost"
          aria-label={`${locale === "vi" ? "Xóa" : "Remove"} ${item.symbol}`}
          onClick={() => onRemove(item)}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}

export function AssetOpinionList({
  items,
  locale,
  tradingAvailable,
  missingOpinionLabel,
  onSelect,
  onTrade,
  onRemove,
}: {
  items: AssetOpinionWorkspaceItem[];
  locale: Locale;
  tradingAvailable: boolean;
  missingOpinionLabel: string | null;
  onSelect: (item: AssetOpinionWorkspaceItem, trigger: HTMLElement) => void;
  onTrade: (item: AssetOpinionWorkspaceItem, side: TradeSide) => void;
  onRemove: (item: AssetOpinionWorkspaceItem) => void;
}) {
  const evidenceValuesBySymbol = new Map(
    items.flatMap((item) => {
      const opinion = item.opinion;
      if (!opinion) return [];
      const inputByEvidenceId = new Map(
        opinion.decisionInputs
          .filter((input) => input.evidenceId)
          .map((input) => [input.evidenceId, input]),
      );
      return [
        [
          item.symbol,
          new Map(
            opinion.evidence.map((evidence) => {
              const input = inputByEvidenceId.get(evidence.id);
              return [
                evidence.id,
                input
                  ? formatMetricValue(input.rawValue, { locale, unit: input.unit })
                  : evidence.displayValue,
              ];
            }),
          ),
        ] as const,
      ];
    }),
  );

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
              <TableHead>{locale === "vi" ? "Thao tác" : "Actions"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const opinion = item.opinion;
              const canOpen = Boolean(opinion);
              return (
                <TableRow
                  key={item.symbol}
                  role={canOpen ? "button" : undefined}
                  tabIndex={canOpen ? 0 : undefined}
                  aria-label={
                    canOpen
                      ? `${locale === "vi" ? "Xem phân tích" : "View analysis"} ${item.symbol} ${item.name}`
                      : undefined
                  }
                  className={cn(
                    "group transition-colors",
                    canOpen &&
                      "cursor-pointer hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  )}
                  onClick={(event) => canOpen && onSelect(item, event.currentTarget)}
                  onKeyDown={(event) =>
                    canOpen && activateOnKeyboard(event, () => onSelect(item, event.currentTarget))
                  }
                >
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-3">
                      <AssetIcon symbol={item.symbol} name={item.name} />
                      <div className="min-w-0">
                        <span className="block font-semibold">{item.symbol}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.name}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {formatPrice(item.price, { locale, currency: item.currency })}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {opinion ? (
                      <OpinionState opinion={opinion} locale={locale} />
                    ) : (
                      <PendingOpinion locale={locale} label={missingOpinionLabel} />
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {opinion ? formatScore(opinion.quantScore) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {opinion ? formatPercent(opinion.portfolioWeightPct) : "—"}
                  </TableCell>
                  <TableCell className="min-w-72">
                    {opinion ? (
                      <div className="mb-2 text-xs text-muted-foreground">
                        {actionLabel(opinion.personalizedAction, locale)} ·{" "}
                        {explanationLabel(opinion, locale)}
                        <span className="ml-1 inline-flex items-center gap-0.5 font-semibold text-primary">
                          {locale === "vi" ? "Xem phân tích" : "View analysis"}{" "}
                          <ChevronRight aria-hidden="true" />
                        </span>
                      </div>
                    ) : null}
                    <ItemActions
                      item={item}
                      locale={locale}
                      tradingAvailable={tradingAvailable}
                      onTrade={onTrade}
                      onRemove={onRemove}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-3 p-3 md:hidden" data-testid="asset-opinion-cards">
        {items.map((item) => {
          const opinion = item.opinion;
          return (
            <article
              key={item.symbol}
              role={opinion ? "button" : undefined}
              tabIndex={opinion ? 0 : undefined}
              aria-label={
                opinion
                  ? `${locale === "vi" ? "Xem phân tích" : "View analysis"} ${item.symbol} ${item.name}`
                  : undefined
              }
              className={cn(
                "rounded-xl border p-4",
                opinion && "cursor-pointer hover:border-primary/40 hover:bg-primary/5",
              )}
              onClick={(event) => opinion && onSelect(item, event.currentTarget)}
              onKeyDown={(event) =>
                opinion && activateOnKeyboard(event, () => onSelect(item, event.currentTarget))
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <AssetIcon symbol={item.symbol} name={item.name} />
                  <div className="min-w-0">
                    <p className="font-semibold">{item.symbol}</p>
                    <p className="truncate text-xs text-muted-foreground">{item.name}</p>
                  </div>
                </div>
                <span className="font-mono text-sm tabular-nums">
                  {opinion ? formatScore(opinion.quantScore) : "—"}
                </span>
              </div>
              <div className="mt-3">
                {opinion ? (
                  <OpinionState opinion={opinion} locale={locale} />
                ) : (
                  <PendingOpinion locale={locale} label={missingOpinionLabel} />
                )}
              </div>
              {opinion ? (
                <div className="mt-3 text-sm">
                  <p>{actionLabel(opinion.personalizedAction, locale)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {explanationLabel(opinion, locale)}
                  </p>
                  {opinion.evidence.length ? (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {opinion.evidence
                        .slice(0, 3)
                        .map((evidence) =>
                          evidenceValuesBySymbol.get(item.symbol)?.get(evidence.id),
                        )
                        .join(" · ")}
                    </p>
                  ) : null}
                  <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                    {locale === "vi" ? "Chạm để xem phân tích" : "Tap to view analysis"}
                    <ChevronRight aria-hidden="true" />
                  </p>
                </div>
              ) : null}
              <div className="mt-4">
                <ItemActions
                  item={item}
                  locale={locale}
                  tradingAvailable={tradingAvailable}
                  onTrade={onTrade}
                  onRemove={onRemove}
                />
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
