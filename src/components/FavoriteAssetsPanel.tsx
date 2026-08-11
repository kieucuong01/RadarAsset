"use client";

import Link from "next/link";
import { useEffect, useReducer, useState } from "react";
import { Database, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
import type {
  PortfolioHoldingResponse,
  PortfolioResponse,
  PortfolioTimeframe,
  WatchlistItemResponse,
} from "@/lib/backend/types";
import {
  favoriteActionState,
  favoriteReducer,
  initialFavoriteState,
} from "@/lib/favorite-assets/state";
import { loadFavoriteAssets, removeFavoriteAsset } from "@/lib/watchlist-client";

export function FavoriteAssetsPanel({
  holdings,
  timeframe,
  onRecorded,
}: {
  holdings: PortfolioHoldingResponse[];
  timeframe: PortfolioTimeframe;
  onRecorded: (portfolio: PortfolioResponse) => void;
}) {
  const [items, setItems] = useState<WatchlistItemResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ui, dispatch] = useReducer(favoriteReducer, initialFavoriteState);

  async function refresh() {
    try {
      setItems(await loadFavoriteAssets());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể tải tài sản yêu thích.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!items.some((item) => item.datasetState === "loading")) return;
    const timer = window.setTimeout(() => void refresh(), 5_000);
    return () => window.clearTimeout(timer);
  }, [items]);

  const removeCandidate = items.find((item) => item.id === ui.removeCandidateId) ?? null;

  async function confirmRemove() {
    if (!removeCandidate) return;
    dispatch({ type: "removeStarted", favoriteId: removeCandidate.id });
    try {
      await removeFavoriteAsset(removeCandidate.id);
      await refresh();
      toast.success(`Đã xóa ${removeCandidate.sym} khỏi danh sách yêu thích.`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Không thể xóa tài sản.");
    } finally {
      dispatch({ type: "removeFinished" });
    }
  }

  return (
    <section
      className="rounded-2xl border border-border bg-card"
      aria-labelledby="favorite-assets-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
        <div>
          <h2 id="favorite-assets-heading" className="font-semibold">
            Favorite Assets
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Theo dõi mã độc lập với holdings; dữ liệu sẵn sàng mới được chuyển sang Quant Lab.
          </p>
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus /> Thêm mã
        </Button>
      </div>
      <div className="p-5">
        {loading ? (
          <p className="text-sm text-muted-foreground">Đang tải danh sách yêu thích…</p>
        ) : null}
        {error ? <p className="text-sm text-bear">{error}</p> : null}
        {!loading && !error && items.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <Database className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">Chưa có mã yêu thích</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Thêm mã từ catalog để theo dõi hoặc chuẩn bị backtest.
            </p>
          </div>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const action = favoriteActionState(item);
            const badgeVariant =
              item.datasetState === "ready"
                ? "default"
                : item.datasetState === "loading"
                  ? "secondary"
                  : "outline";
            return (
              <article key={item.id} className="min-w-0 rounded-xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{item.sym}</p>
                    <p className="truncate text-xs text-muted-foreground">{item.name}</p>
                  </div>
                  <Badge variant={badgeVariant}>{action.label}</Badge>
                </div>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold tabular-nums">
                      {item.price.toLocaleString()}
                    </p>
                    <p className={item.chg >= 0 ? "text-xs text-bull" : "text-xs text-bear"}>
                      {item.chg >= 0 ? "+" : ""}
                      {item.chg.toFixed(2)}%
                    </p>
                  </div>
                  <p className="text-right text-xs text-muted-foreground">
                    {item.backtestableTimeframes.length
                      ? item.backtestableTimeframes.join(" · ")
                      : "Waiting for data"}
                  </p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {action.backtestHref ? (
                    <Button asChild size="sm">
                      <Link href={action.backtestHref}>Backtest</Link>
                    </Button>
                  ) : (
                    <Button size="sm" disabled>
                      Backtest
                    </Button>
                  )}
                  <PortfolioTransactionDialog
                    holdings={holdings}
                    disabled={false}
                    timeframe={timeframe}
                    onRecorded={onRecorded}
                    preset={{ side: "buy", symbol: item.sym, price: item.price }}
                    triggerLabel="Buy"
                  />
                  <PortfolioTransactionDialog
                    holdings={holdings}
                    disabled={
                      !holdings.some((holding) => holding.ticker === item.sym && holding.qty > 0)
                    }
                    timeframe={timeframe}
                    onRecorded={onRecorded}
                    preset={{ side: "sell", symbol: item.sym, price: item.price }}
                    triggerLabel="Sell"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Xóa ${item.sym} khỏi yêu thích`}
                    onClick={() => dispatch({ type: "removeRequested", favoriteId: item.id })}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <FavoriteAssetDialog open={dialogOpen} onOpenChange={setDialogOpen} onSaved={setItems} />
      <AlertDialog
        open={Boolean(removeCandidate)}
        onOpenChange={(open) => {
          if (!open && !ui.removingId) dispatch({ type: "removeCancelled" });
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa {removeCandidate?.sym} khỏi yêu thích?</AlertDialogTitle>
            <AlertDialogDescription>
              Chỉ xóa liên kết yêu thích. Holdings, giao dịch và dữ liệu thị trường dùng chung không
              bị xóa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(ui.removingId)}>Hủy</AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(ui.removingId)}
              onClick={() => void confirmRemove()}
            >
              {ui.removingId ? "Đang xóa…" : "Xóa yêu thích"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
