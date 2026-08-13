"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Database, History, RefreshCw } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getQuantDataReadiness,
  quantDataOperationsHealth,
  type QuantDataReadiness,
} from "@/lib/backtest/data-readiness-client";
import { useI18n } from "@/lib/i18n/context";

function dateLabel(value: string | null, locale: "vi" | "en") {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function MarketDataHealthPanel() {
  const [readiness, setReadiness] = useState<QuantDataReadiness | null>(null);
  const [failed, setFailed] = useState(false);
  const { t, locale } = useI18n();
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US"),
    [locale],
  );

  useEffect(() => {
    const controller = new AbortController();
    void getQuantDataReadiness((input, init) =>
      fetch(input, { ...init, signal: controller.signal }),
    )
      .then((value) => {
        setReadiness(value);
        setFailed(false);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
  }, []);

  const health = useMemo(
    () => (readiness ? quantDataOperationsHealth(readiness) : null),
    [readiness],
  );

  if (failed) {
    return (
      <Alert variant="destructive" className="mb-6">
        <AlertTriangle aria-hidden="true" />
        <AlertTitle>{t("quant.dataHealth.unavailable")}</AlertTitle>
        <AlertDescription>{t("quant.dataHealth.unavailableDetail")}</AlertDescription>
      </Alert>
    );
  }
  if (!readiness || !health) return <Skeleton className="mb-6 h-32 w-full" />;

  const metrics = [
    {
      label: t("quant.dataHealth.coverage"),
      value: `${readiness.expectedDatasetCount - readiness.missingDatasetCount}/${readiness.expectedDatasetCount}`,
      detail: t("quant.dataHealth.missingDatasets", { count: readiness.missingDatasetCount }),
      icon: Database,
    },
    {
      label: t("quant.dataHealth.stale"),
      value: numberFormatter.format(readiness.staleDatasetCount),
      detail: t("quant.dataHealth.missingBars", { count: readiness.missingBarCount }),
      icon: History,
    },
    {
      label: t("quant.dataHealth.backlog"),
      value: numberFormatter.format(readiness.backlogCount),
      detail: readiness.oldestBacklogAt
        ? t("quant.dataHealth.oldestBacklog", {
            date: dateLabel(readiness.oldestBacklogAt, locale),
          })
        : t("quant.dataHealth.noBacklog"),
      icon: RefreshCw,
    },
    {
      label: t("quant.dataHealth.providerFailures"),
      value: numberFormatter.format(health.providerFailureCount),
      detail: t("quant.dataHealth.lastScheduler", {
        date: dateLabel(readiness.lastSchedulerSuccessAt, locale),
      }),
      icon: health.tone === "healthy" ? CheckCircle2 : AlertTriangle,
    },
  ];

  return (
    <Card className="mb-6 shadow-none" aria-live="polite">
      <CardHeader className="flex-row items-start justify-between gap-4 pb-3">
        <div>
          <CardTitle className="text-sm">{t("quant.dataHealth.title")}</CardTitle>
          <CardDescription className="text-xs">{t("quant.dataHealth.description")}</CardDescription>
        </div>
        <Badge variant={health.tone === "healthy" ? "default" : "destructive"}>
          {health.tone === "healthy"
            ? t("quant.dataHealth.healthy")
            : health.tone === "failed"
              ? t("quant.dataHealth.failed")
              : t("quant.dataHealth.degraded", { count: health.issueCount })}
        </Badge>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div key={metric.label} className="rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Icon aria-hidden="true" className="size-3.5" />
                {metric.label}
              </div>
              <div className="mt-1 font-mono text-lg font-semibold">{metric.value}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{metric.detail}</div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
