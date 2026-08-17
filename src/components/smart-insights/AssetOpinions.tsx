"use client";

import { useMemo, useRef, useState } from "react";
import { BrainCircuit, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AssetOpinionDetail } from "./AssetOpinionDetail";
import { AssetOpinionList } from "./AssetOpinionList";
import { PortfolioChangeDigest } from "./PortfolioChangeDigest";
import { FavoriteAssetDialog } from "@/components/FavoriteAssetDialog";
import { PortfolioTransactionDialog } from "@/components/PortfolioTransactionDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import {
  buildAssetOpinionWorkspace,
  type AssetOpinionWorkspaceItem,
} from "@/lib/asset-opinion-workspace";
import type { PortfolioResponse, WatchlistItemResponse } from "@/lib/backend/types";
import type { PortfolioOpinionChange } from "@/lib/asset-opinion-changes";
import type { AssetOpinionModel, BriefingGenerationState } from "@/lib/smart-insights-client";

type Props = {
  opinions: AssetOpinionModel[];
  portfolioState: "available" | "missing";
  locale: "vi" | "en";
  onEvidence: (id: string) => void;
  generationState?: BriefingGenerationState;
  onRefresh?: () => void;
  refreshPending?: boolean;
  watchlist?: WatchlistItemResponse[];
  watchlistAvailable?: boolean;
  watchlistError?: string | null;
  portfolio?: PortfolioResponse | null;
  portfolioAvailable?: boolean;
  onWatchlistSaved?: (items: WatchlistItemResponse[]) => void;
  onRemoveTrackedAsset?: (id: string) => Promise<void>;
  onPortfolioRecorded?: (portfolio: PortfolioResponse) => void;
  portfolioChanges?: PortfolioOpinionChange[];
  portfolioChangesStatus?: "accumulating" | "ready";
  analysisDate?: string;
  today?: string;
  briefingAvailable?: boolean;
};

function EmptyOpinions({
  locale,
  generationState,
  onRefresh,
  refreshPending,
  isToday,
}: Pick<Props, "locale" | "generationState" | "onRefresh" | "refreshPending"> & {
  isToday: boolean;
}) {
  const state = generationState ?? "idle";
  const content = !isToday
    ? {
        title:
          locale === "vi"
            ? "Không có bản phân tích cho ngày đã chọn"
            : "No analysis for the selected date",
        detail:
          locale === "vi"
            ? "Ngày này không còn bản phân tích khả dụng. Hãy chọn ngày khác hoặc quay về hôm nay."
            : "This date is no longer available. Choose another date or return to Today.",
      }
    : state === "generating"
      ? {
          title: locale === "vi" ? "Đang tạo bản phân tích hôm nay" : "Generating today's analysis",
          detail:
            locale === "vi"
              ? "Hệ thống đang kiểm tra dữ liệu danh mục, mã đang theo dõi và BTC/ETH/VNINDEX/VN30/XAU."
              : "The system is checking portfolio, tracked assets, and BTC/ETH/VNINDEX/VN30/XAU data.",
        }
      : state === "failed"
        ? {
            title: locale === "vi" ? "Không thể tạo quan điểm" : "Opinion generation failed",
            detail:
              locale === "vi"
                ? "Dữ liệu hiện có vẫn được giữ nguyên. Bạn có thể thử tạo lại bản phân tích."
                : "Existing data remains unchanged. You can retry the analysis.",
          }
        : state === "ready"
          ? {
              title: locale === "vi" ? "Chưa đủ dữ liệu định lượng" : "Insufficient quant data",
              detail:
                locale === "vi"
                  ? "Không có tài sản nào vượt qua ngưỡng bằng chứng để hệ thống đưa ra quan điểm."
                  : "No asset passed the evidence threshold for an opinion.",
            }
          : {
              title: locale === "vi" ? "Chưa có bản phân tích hôm nay" : "No analysis for today",
              detail:
                locale === "vi"
                  ? "Tạo phân tích cho danh mục, mã đang theo dõi và các tài sản đại diện BTC/ETH/VNINDEX/VN30/XAU."
                  : "Analyze the portfolio, tracked assets, and representative BTC/ETH/VNINDEX/VN30/XAU assets.",
            };

  return (
    <div className="m-4 flex flex-col items-start gap-4 rounded-xl border border-dashed p-5">
      <div className="flex items-start gap-3">
        {state === "generating" && isToday ? (
          <LoaderCircle className="mt-0.5 size-5 shrink-0 animate-spin text-primary" />
        ) : (
          <BrainCircuit className="mt-0.5 size-5 shrink-0 text-primary" />
        )}
        <div>
          <p className="text-sm font-medium">{content.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{content.detail}</p>
        </div>
      </div>
      {isToday && state !== "generating" && onRefresh ? (
        <Button
          size="sm"
          variant={state === "failed" ? "outline" : "default"}
          onClick={onRefresh}
          disabled={refreshPending}
        >
          <RefreshCw className={refreshPending ? "animate-spin" : undefined} />
          {state === "failed"
            ? locale === "vi"
              ? "Thử lại"
              : "Retry"
            : locale === "vi"
              ? "Tạo phân tích AI"
              : "Generate AI analysis"}
        </Button>
      ) : null}
    </div>
  );
}

export function AssetOpinions({
  opinions,
  portfolioState,
  locale,
  onEvidence,
  generationState = opinions.length ? "ready" : "idle",
  onRefresh,
  refreshPending = false,
  watchlist,
  watchlistAvailable = false,
  watchlistError = null,
  portfolio = null,
  portfolioAvailable = false,
  onWatchlistSaved,
  onRemoveTrackedAsset,
  onPortfolioRecorded,
  portfolioChanges = [],
  portfolioChangesStatus = "accumulating",
  analysisDate,
  today,
  briefingAvailable = true,
}: Props) {
  const items = useMemo(
    () =>
      buildAssetOpinionWorkspace({
        opinions,
        watchlist: watchlist ?? [],
        holdings: portfolio?.holdings ?? [],
        watchlistAvailable,
        portfolioAvailable,
      }),
    [opinions, portfolio, portfolioAvailable, watchlist, watchlistAvailable],
  );
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [trade, setTrade] = useState<{
    item: AssetOpinionWorkspaceItem;
    side: "buy" | "sell";
  } | null>(null);
  const [removeCandidate, setRemoveCandidate] = useState<AssetOpinionWorkspaceItem | null>(null);
  const [removing, setRemoving] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const activeOpinion = items.find((item) => item.symbol === activeSymbol)?.opinion ?? null;
  const isToday = !analysisDate || !today || analysisDate === today;
  const missingOpinionLabel = briefingAvailable
    ? isToday
      ? locale === "vi"
        ? "Chưa có quan điểm hôm nay"
        : "No opinion today"
      : locale === "vi"
        ? "Chưa có quan điểm cho ngày đã chọn"
        : "No opinion for selected date"
    : null;

  async function confirmRemove() {
    const candidate = removeCandidate;
    if (!candidate?.watchlistItem || !onRemoveTrackedAsset) return;
    setRemoving(true);
    try {
      await onRemoveTrackedAsset(candidate.watchlistItem.id);
      toast.success(
        locale === "vi"
          ? `Đã xóa ${candidate.symbol} khỏi danh sách theo dõi.`
          : `Removed ${candidate.symbol} from tracked assets.`,
      );
      setRemoveCandidate(null);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : locale === "vi"
            ? "Không thể xóa mã."
            : "Unable to remove asset.",
      );
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-5" aria-labelledby="asset-opinions-title">
      {briefingAvailable ? (
        <PortfolioChangeDigest
          changes={portfolioChanges}
          status={portfolioChangesStatus}
          locale={locale}
          onSelect={(symbol, trigger) => {
            returnFocusRef.current = trigger;
            setActiveSymbol(symbol);
          }}
        />
      ) : null}
      <Card className="min-w-0 overflow-hidden shadow-none">
        <CardHeader className="gap-3 border-b bg-muted/20">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
                <BrainCircuit aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 id="asset-opinions-title" className="font-semibold leading-none tracking-tight">
                  {locale === "vi" ? "Quan điểm AI theo tài sản" : "AI asset opinions"}
                </h2>
                <CardDescription className="mt-1">
                  {locale === "vi"
                    ? "Theo dõi, giao dịch và xem luận điểm định lượng của từng tài sản tại một nơi. Chạm vào dòng có quan điểm để xem phân tích."
                    : "Track, trade, and inspect each asset's quant thesis in one place. Select an opinion row for analysis."}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                {items.length} {locale === "vi" ? "tài sản" : "assets"}
              </Badge>
              {briefingAvailable && isToday && onRefresh ? (
                <Button
                  size="sm"
                  variant={generationState === "failed" ? "outline" : "secondary"}
                  onClick={onRefresh}
                  disabled={refreshPending || generationState === "generating"}
                >
                  <RefreshCw
                    aria-hidden="true"
                    className={
                      refreshPending || generationState === "generating"
                        ? "animate-spin"
                        : undefined
                    }
                  />
                  {generationState === "failed"
                    ? locale === "vi"
                      ? "Thử lại"
                      : "Retry"
                    : locale === "vi"
                      ? "Cập nhật AI"
                      : "Update AI"}
                </Button>
              ) : null}
              <Button
                size="sm"
                onClick={() => setAddOpen(true)}
                disabled={!watchlistAvailable}
                title={
                  !watchlistAvailable
                    ? locale === "vi"
                      ? "Danh sách theo dõi hiện chưa khả dụng"
                      : "Tracked assets unavailable"
                    : undefined
                }
              >
                <Plus aria-hidden="true" /> {locale === "vi" ? "Thêm mã" : "Add symbol"}
              </Button>
            </div>
          </div>
          {watchlistError ? (
            <p className="text-xs text-bear">
              {locale === "vi"
                ? "Không thể tải mã đang theo dõi. Các dữ liệu khác vẫn hoạt động."
                : "Tracked assets could not load. Other data remains available."}
            </p>
          ) : null}
          {isToday && generationState === "generating" ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" />
              {locale === "vi"
                ? "Đang tổng hợp dữ liệu định lượng cho các mã mới…"
                : "Generating quant opinions for new symbols…"}
            </p>
          ) : null}
          {isToday && generationState === "failed" ? (
            <p className="text-xs text-bear">
              {locale === "vi"
                ? "Không thể tạo quan điểm. Dữ liệu hiện có vẫn được giữ nguyên."
                : "Opinion generation failed. Existing data remains unchanged."}
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          {!briefingAvailable ? (
            <EmptyOpinions
              locale={locale}
              generationState={generationState}
              onRefresh={isToday ? onRefresh : undefined}
              refreshPending={refreshPending}
              isToday={isToday}
            />
          ) : null}
          <AssetOpinionList
            items={items}
            locale={locale}
            tradingAvailable={portfolioAvailable && Boolean(portfolio)}
            missingOpinionLabel={missingOpinionLabel}
            onSelect={(item, trigger) => {
              returnFocusRef.current = trigger;
              setActiveSymbol(item.symbol);
            }}
            onTrade={(item, side) => setTrade({ item, side })}
            onRemove={setRemoveCandidate}
          />
        </CardContent>
      </Card>

      {activeOpinion ? (
        <AssetOpinionDetail
          opinion={activeOpinion}
          open
          onOpenChange={(open) => {
            if (!open) {
              const returnFocusTo = returnFocusRef.current;
              setActiveSymbol(null);
              requestAnimationFrame(() => returnFocusTo?.focus());
            }
          }}
          portfolioState={portfolioState}
          locale={locale}
          onEvidence={onEvidence}
        />
      ) : null}

      {addOpen && onWatchlistSaved ? (
        <FavoriteAssetDialog open={addOpen} onOpenChange={setAddOpen} onSaved={onWatchlistSaved} />
      ) : null}
      {trade && onPortfolioRecorded ? (
        <PortfolioTransactionDialog
          open
          onOpenChange={(open) => {
            if (!open) setTrade(null);
          }}
          trigger={null}
          holdings={portfolio?.holdings ?? []}
          disabled={!portfolioAvailable || !portfolio}
          timeframe="1M"
          onRecorded={onPortfolioRecorded}
          preset={{ side: trade.side, symbol: trade.item.symbol, price: trade.item.price }}
          portfolioCurrency={portfolio?.baseCurrency}
        />
      ) : null}

      <AlertDialog
        open={Boolean(removeCandidate)}
        onOpenChange={(open) => {
          if (!open && !removing) setRemoveCandidate(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {locale === "vi"
                ? `Xóa ${removeCandidate?.symbol ?? ""} khỏi danh sách theo dõi?`
                : `Remove ${removeCandidate?.symbol ?? ""} from tracked assets?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {locale === "vi"
                ? "Chỉ xóa mã theo dõi. Holdings, giao dịch và dữ liệu thị trường dùng chung không bị xóa."
                : "Only the tracked link is removed. Holdings, transactions, and shared market data remain unchanged."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>
              {locale === "vi" ? "Hủy" : "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction disabled={removing} onClick={() => void confirmRemove()}>
              {removing
                ? locale === "vi"
                  ? "Đang xóa…"
                  : "Removing…"
                : locale === "vi"
                  ? "Xóa mã"
                  : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
