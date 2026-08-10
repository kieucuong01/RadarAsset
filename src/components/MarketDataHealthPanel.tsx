"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { MarketDataHealthItem, MarketDataTimeframe } from "@/lib/backend/types";
import { getMarketDataHealth, marketDataStatusMeta } from "@/lib/market-data/client";

const ASSET_ORDER = ["FPT", "BTC", "XAU"] as const;

function coverageLabel(value: string | null) {
  if (!value) return "No active coverage";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function MarketDataHealthPanel({ timeframe }: { timeframe: MarketDataTimeframe }) {
  const [items, setItems] = useState<MarketDataHealthItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void getMarketDataHealth(fetch, controller.signal)
      .then((data) => {
        if (!active) return;
        setItems(data);
        setFailed(false);
      })
      .catch((error: unknown) => {
        if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
        setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const selected = ASSET_ORDER.map((symbol) =>
    items.find((item) => item.symbol === symbol && item.timeframe === timeframe),
  ).filter((item): item is MarketDataHealthItem => Boolean(item));

  return (
    <Card className="shadow-none" aria-live="polite">
      <CardHeader className="p-4 pb-3">
        <CardTitle className="text-sm">Market data health</CardTitle>
        <CardDescription className="text-xs">
          Active immutable snapshots · research only · {timeframe}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 p-4 pt-0">
        {loading ? (
          ASSET_ORDER.map((symbol) => <Skeleton key={symbol} className="h-16 w-full" />)
        ) : failed ? (
          <Alert>
            <AlertTitle>Data health unavailable</AlertTitle>
            <AlertDescription>
              Không thể tải trạng thái nguồn dữ liệu. Backtest controls vẫn hoạt động độc lập.
            </AlertDescription>
          </Alert>
        ) : (
          selected.map((item) => {
            const status = marketDataStatusMeta(item.freshness);
            const provider = item.providerName ?? "No active provider";
            const upstream =
              item.upstreamProvider && item.upstreamProvider !== item.providerCode
                ? ` · upstream ${item.upstreamProvider}`
                : "";
            return (
              <div
                key={item.symbol}
                className="flex min-w-0 items-start justify-between gap-3 rounded-lg border bg-muted/20 p-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{item.symbol}</div>
                  <div
                    className="truncate text-xs text-muted-foreground"
                    title={`${provider}${upstream}`}
                  >
                    {provider}
                    {upstream}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {coverageLabel(item.coverageEnd)} UTC · v{item.version ?? "—"} ·{" "}
                    {item.rowCount.toLocaleString()} rows
                  </div>
                  {item.lastErrorCode ? (
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                      Last run: {item.lastErrorCode}
                    </div>
                  ) : null}
                </div>
                <Badge variant={status.variant} className="shrink-0">
                  {status.label}
                </Badge>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
