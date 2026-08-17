"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { I18nContext } from "@/lib/i18n/context";
import { useContext } from "react";
import type { FreshnessState } from "@/lib/backend/smart-insights-types";

const styles: Record<FreshnessState, string> = {
  fresh: "border-bull/30 bg-bull/10 text-bull",
  stale: "border-chart-4/30 bg-chart-4/10 text-chart-4",
  conflicting: "border-bear/30 bg-bear/10 text-bear",
  partial: "border-primary/30 bg-primary/10 text-primary",
  unavailable: "border-border bg-muted text-muted-foreground",
};

const labels: Record<FreshnessState, { vi: string; en: string }> = {
  fresh: { vi: "Mới", en: "Fresh" },
  stale: { vi: "Cũ", en: "Stale" },
  conflicting: { vi: "Mâu thuẫn", en: "Conflicting" },
  partial: { vi: "Một phần", en: "Partial" },
  unavailable: { vi: "Chưa có", en: "Unavailable" },
};

export function FreshnessBadge({ state }: { state: FreshnessState }) {
  const locale = useContext(I18nContext)?.locale ?? "vi";
  return (
    <Badge
      variant="outline"
      className={cn("font-mono text-[10px] uppercase tracking-wider", styles[state])}
    >
      {labels[state][locale]}
    </Badge>
  );
}
