"use client";

import { useEffect, useState } from "react";
import { Bell, Plus, Star } from "lucide-react";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import { WatchlistAddDialog } from "@/components/WatchlistAddDialog";
import { Button } from "@/components/ui/button";
import type { WatchlistItemResponse } from "@/lib/backend/types";
import { useI18n } from "@/lib/i18n/context";
import { loadFavoriteAssets } from "@/lib/watchlist-client";

const SAMPLE_WATCHLIST: WatchlistItemResponse[] = [
  {
    id: "sample-btc",
    sym: "BTC",
    name: "Bitcoin",
    price: 100,
    chg: 1.2,
    alert: 110,
    sentiment: "bull",
    datasetState: "ready",
    ingestionRequestId: null,
    backtestableTimeframes: ["1d"],
  },
  {
    id: "sample-gold",
    sym: "GOLD",
    name: "Gold",
    price: 100,
    chg: -0.3,
    alert: 105,
    sentiment: "neutral",
    datasetState: "ready",
    ingestionRequestId: null,
    backtestableTimeframes: ["1d"],
  },
];

export function LegacyWatchlist() {
  const { locale, t } = useI18n();
  const [items, setItems] = useState<WatchlistItemResponse[]>(SAMPLE_WATCHLIST);
  const [status, setStatus] = useState<"SYSTEM" | "SAMPLE">("SAMPLE");
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadFavoriteAssets()
      .then((rows) => {
        if (!active) return;
        if (rows.length) {
          setItems(rows);
          setStatus("SYSTEM");
        } else {
          setItems(SAMPLE_WATCHLIST);
          setStatus("SAMPLE");
        }
        setError(null);
      })
      .catch((caught) => {
        if (!active) return;
        setItems(SAMPLE_WATCHLIST);
        setStatus("SAMPLE");
        setError(caught instanceof Error ? caught.message : "Watchlist unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <div className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <Star className="size-4 text-primary" />
              <h2 className="font-semibold">{t("overview.market.watchlist")}</h2>
              <DataStatusBadge status={status} detail={error ?? undefined} />
            </div>
            {status === "SAMPLE" ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {locale === "vi"
                  ? "Giá và cảnh báo bên dưới chỉ dùng để minh họa bố cục."
                  : "Prices and alerts below are illustrative only."}
              </p>
            ) : null}
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus /> {t("overview.market.addAsset")}
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-5 py-2.5 text-left font-medium">
                  {t("overview.market.tableAsset")}
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {t("overview.market.tablePrice")}
                </th>
                <th className="px-3 py-2.5 text-right font-medium">24h</th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {t("overview.market.tableAlert")}
                </th>
                <th className="px-5 py-2.5 text-right font-medium" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-border last:border-0 hover:bg-muted/40"
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="grid size-8 place-items-center rounded-full bg-gradient-primary text-[10px] font-bold text-primary-foreground">
                        {item.sym.slice(0, 2)}
                      </div>
                      <div>
                        <div className="font-semibold leading-tight">{item.sym}</div>
                        <div className="text-xs text-muted-foreground">{item.name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right font-medium tabular-nums">
                    {item.price.toLocaleString()}
                  </td>
                  <td
                    className={
                      item.chg >= 0
                        ? "px-3 py-3 text-right font-semibold tabular-nums text-bull"
                        : "px-3 py-3 text-right font-semibold tabular-nums text-bear"
                    }
                  >
                    {item.chg >= 0 ? "+" : ""}
                    {item.chg.toFixed(2)}%
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {item.alert.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      type="button"
                      disabled
                      className="inline-flex min-h-11 min-w-11 items-center justify-center text-muted-foreground opacity-40"
                      aria-label={`${t("overview.market.tableAlert")} ${item.sym}`}
                    >
                      <Bell className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-border bg-muted/20 px-5 py-3 text-xs text-muted-foreground">
          <span>
            {status === "SYSTEM"
              ? t("overview.market.synced")
              : locale === "vi"
                ? "Dữ liệu mẫu"
                : "Sample data"}
          </span>
          <button
            type="button"
            onClick={() => setItems((current) => [...current].sort((a, b) => b.chg - a.chg))}
            className="font-medium text-primary hover:underline"
          >
            {t("overview.market.sort24h")}
          </button>
        </div>
      </div>
      <WatchlistAddDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSaved={(rows) => {
          setItems(rows.length ? rows : SAMPLE_WATCHLIST);
          setStatus(rows.length ? "SYSTEM" : "SAMPLE");
          setError(null);
        }}
      />
    </>
  );
}
