"use client";

import { useEffect, useState } from "react";
import { Activity, AlertCircle } from "lucide-react";
import { toast } from "sonner";

import { BacktestResults } from "@/components/BacktestResults";
import { BacktestResultsEmpty } from "@/components/backtest-results/BacktestResultsEmpty";
import { PortfolioBacktestBuilder } from "@/components/PortfolioBacktestBuilder";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  cancelBacktestRun,
  getBacktestRun,
  isActiveRun,
  type BacktestRun,
} from "@/lib/backtest/client";
import type { BacktestStrategyPreset } from "@/lib/backtest/preselection";
import { backtestOutputState } from "@/lib/backtest/result-presentation";
import { useI18n } from "@/lib/i18n/context";

export function BacktestWorkbench({
  initialSymbols = [],
  strategyPreset = null,
}: {
  initialSymbols?: string[];
  strategyPreset?: BacktestStrategyPreset | null;
}) {
  const [run, setRun] = useState<BacktestRun | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const outputState = backtestOutputState(run?.status ?? null);
  const { t } = useI18n();

  useEffect(() => {
    if (!run || !isActiveRun(run.status)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void getBacktestRun(run.id, fetch, controller.signal)
        .then(setRun)
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === "AbortError") return;
          toast.error(t("backtest.updateStatusError"));
        });
    }, 2_000);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [run, t]);

  async function cancelRun() {
    if (!run || run.status === "cancel_requested") return;
    setCancelling(true);
    try {
      setRun(await cancelBacktestRun(run.id));
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : t("backtest.updateStatusError"));
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
      <aside
        aria-label={t("backtest.configAria")}
        className="min-w-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-2"
      >
        <PortfolioBacktestBuilder
          onRunCreated={setRun}
          initialSymbols={initialSymbols}
          strategyPreset={strategyPreset}
          layout="sidebar"
        />
      </aside>

      <main aria-label={t("backtest.outputAria")} className="min-w-0 space-y-5">
        {outputState === "empty" ? <BacktestResultsEmpty /> : null}

        {run && outputState === "active" ? (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Activity />
                    Run {run.id.slice(0, 8)}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {t("backtest.activeRunDescription", {
                      legs: run.legs.length,
                      timeframe: run.timeframe,
                    })}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{run.status}</Badge>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={cancelling || run.status === "cancel_requested"}
                    onClick={() => void cancelRun()}
                  >
                    {t("common.cancel")}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Progress value={run.progress} />
            </CardContent>
          </Card>
        ) : null}

        {run && outputState === "failed" ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>
              {t(
                run.status === "cancelled"
                  ? "backtest.cancelledTitle"
                  : run.status === "timed_out"
                    ? "backtest.timedOutTitle"
                    : "backtest.failedTitle",
              )}
            </AlertTitle>
            <AlertDescription>
              {t(
                run.status === "cancelled"
                  ? "backtest.cancelledDescription"
                  : run.status === "timed_out"
                    ? "backtest.timedOutDescription"
                    : "backtest.failedDescription",
              )}
            </AlertDescription>
          </Alert>
        ) : null}

        {run && outputState === "results" ? <BacktestResults run={run} /> : null}
      </main>
    </div>
  );
}
