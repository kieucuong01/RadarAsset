import { Bitcoin, ChartNoAxesCombined, Coins } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { InsightMarket } from "@/lib/backend/smart-insights-types";
import type { RegimeModel } from "@/lib/smart-insights-client";
import { FreshnessBadge } from "./FreshnessBadge";
import { useI18n } from "@/lib/i18n/context";

const icons = { crypto: Bitcoin, macro: ChartNoAxesCombined, gold: Coins };

export function MarketRegimeStrip({
  regimes,
  onSelectMarket,
}: {
  regimes: RegimeModel[];
  onSelectMarket: (market: InsightMarket) => void;
}) {
  const { locale } = useI18n();
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {(["crypto", "macro", "gold"] as const).map((market) => {
        const row = regimes.find((item) => item.market === market);
        const Icon = icons[market];
        return (
          <Card key={market} className="transition-colors hover:border-primary/40">
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2">
                  <Icon className="size-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    {locale === "vi"
                      ? ({ crypto: "Crypto", macro: "Vĩ mô", gold: "Vàng" }[market] ?? market)
                      : market}
                  </p>
                  <p className="font-semibold">
                    {row?.label ?? (locale === "vi" ? "Chưa có dữ liệu" : "Unavailable")}
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="font-mono text-xl font-semibold">{row?.score ?? "—"}</span>
                <FreshnessBadge state={row?.freshness ?? "unavailable"} />
                <Button variant="ghost" size="sm" onClick={() => onSelectMarket(market)}>
                  {locale === "vi" ? "Chi tiết" : "Details"}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
