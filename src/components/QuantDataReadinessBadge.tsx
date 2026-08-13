"use client";

import { useEffect, useMemo, useState } from "react";
import { DatabaseZap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  getQuantDataReadiness,
  quantDataReadinessSummary,
  type QuantDataReadiness,
} from "@/lib/backtest/data-readiness-client";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

type StatusTone = "loading" | "ready" | "backlog" | "blocked" | "error";

const TONE_STYLES: Record<StatusTone, string> = {
  loading: "border-border bg-muted text-muted-foreground",
  ready: "border-bull/30 bg-bull/10 text-bull",
  backlog: "border-chart-4/30 bg-chart-4/10 text-chart-4",
  blocked: "border-destructive/30 bg-destructive/10 text-destructive",
  error: "border-border bg-muted text-muted-foreground",
};

function activeDatasetCount(readiness: QuantDataReadiness) {
  return readiness.activeDatasetsByMarketTimeframe.reduce((total, item) => total + item.count, 0);
}

export function QuantDataReadinessBadge({ className }: { className?: string }) {
  const [readiness, setReadiness] = useState<QuantDataReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    void getQuantDataReadiness((input, init) =>
      fetch(input, { ...init, signal: controller.signal }),
    )
      .then(setReadiness)
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setFailed(true);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const content = useMemo(() => {
    if (loading) {
      return {
        tone: "loading" as const,
        label: t("quant.dataReadiness.loading"),
        detail: t("quant.dataReadiness.loadingDetail"),
      };
    }
    if (failed || !readiness) {
      return {
        tone: "error" as const,
        label: t("quant.dataReadiness.unavailable"),
        detail: t("quant.dataReadiness.unavailableDetail"),
      };
    }

    const summary = quantDataReadinessSummary(readiness);
    const activeCount = activeDatasetCount(readiness);
    if (summary.tone === "blocked") {
      return {
        tone: "blocked" as const,
        label: t("quant.dataReadiness.blocked"),
        detail: t("quant.dataReadiness.blockedDetail"),
      };
    }
    if (summary.tone === "backlog") {
      return {
        tone: "backlog" as const,
        label: t("quant.dataReadiness.activeDatasets", { count: activeCount }),
        detail: t("quant.dataReadiness.backlogDetail", { count: readiness.backlogCount }),
      };
    }
    return {
      tone: "ready" as const,
      label: t("quant.dataReadiness.activeDatasets", { count: activeCount }),
      detail: t("quant.dataReadiness.readyDetail"),
    };
  }, [failed, loading, readiness, t]);

  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 whitespace-nowrap font-mono text-[10px] uppercase tracking-wider",
        TONE_STYLES[content.tone],
        className,
      )}
      title={content.detail}
    >
      <DatabaseZap aria-hidden="true" className="size-3" />
      {content.label}
    </Badge>
  );
}
