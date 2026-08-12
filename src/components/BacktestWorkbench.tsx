"use client";

import { useEffect, useState } from "react";
import { Activity, AlertCircle } from "lucide-react";
import { toast } from "sonner";

import { BacktestResults } from "@/components/BacktestResults";
import { BacktestResultsEmpty } from "@/components/backtest-results/BacktestResultsEmpty";
import { PortfolioBacktestBuilder } from "@/components/PortfolioBacktestBuilder";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getBacktestRun, isActiveRun, type BacktestRun } from "@/lib/backtest/client";
import type { BacktestStrategyPreset } from "@/lib/backtest/preselection";
import { backtestOutputState } from "@/lib/backtest/result-presentation";

export function BacktestWorkbench({
  initialSymbols = [],
  strategyPreset = null,
}: {
  initialSymbols?: string[];
  strategyPreset?: BacktestStrategyPreset | null;
}) {
  const [run, setRun] = useState<BacktestRun | null>(null);
  const outputState = backtestOutputState(run?.status ?? null);

  useEffect(() => {
    if (!run || !isActiveRun(run.status)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void getBacktestRun(run.id, fetch, controller.signal)
        .then(setRun)
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === "AbortError") return;
          toast.error("Không thể cập nhật trạng thái portfolio backtest.");
        });
    }, 2_000);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [run]);

  return (
    <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
      <aside
        aria-label="Backtest configuration"
        className="min-w-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-2"
      >
        <PortfolioBacktestBuilder
          onRunCreated={setRun}
          initialSymbols={initialSymbols}
          strategyPreset={strategyPreset}
          layout="sidebar"
        />
      </aside>

      <main aria-label="Backtest output" className="min-w-0 space-y-5">
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
                    {run.legs.length} legs · {run.timeframe} · normalized portfolio simulation
                  </CardDescription>
                </div>
                <Badge variant="secondary">{run.status}</Badge>
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
            <AlertTitle>Backtest failed</AlertTitle>
            <AlertDescription>
              Worker could not finish this run. Check the selected data and try again.
            </AlertDescription>
          </Alert>
        ) : null}

        {run && outputState === "results" ? <BacktestResults run={run} /> : null}
      </main>
    </div>
  );
}
