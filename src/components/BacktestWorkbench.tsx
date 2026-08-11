"use client";

import { useEffect, useState } from "react";
import { Activity, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { PortfolioBacktestBuilder } from "@/components/PortfolioBacktestBuilder";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getBacktestRun, isActiveRun, type BacktestRun } from "@/lib/backtest/client";

export function BacktestWorkbench({ initialSymbols = [] }: { initialSymbols?: string[] }) {
  const [run, setRun] = useState<BacktestRun | null>(null);

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
    <div className="flex min-w-0 flex-col gap-6">
      <PortfolioBacktestBuilder onRunCreated={setRun} initialSymbols={initialSymbols} />

      {run ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {run.status === "succeeded" ? <CheckCircle2 /> : <Activity />}
                  Run {run.id.slice(0, 8)}
                </CardTitle>
                <CardDescription className="mt-1">
                  {run.legs.length} legs · {run.timeframe} · normalized portfolio simulation
                </CardDescription>
              </div>
              <Badge variant={run.status === "failed" ? "destructive" : "secondary"}>
                {run.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Progress value={run.progress} />
            {run.status === "failed" ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>Backtest thất bại</AlertTitle>
                <AlertDescription>
                  {run.errorMessage ?? "Worker không thể hoàn tất run."}
                </AlertDescription>
              </Alert>
            ) : null}
            {run.status === "succeeded" ? (
              <Alert>
                <CheckCircle2 />
                <AlertTitle>Worker đã hoàn tất</AlertTitle>
                <AlertDescription>
                  Aggregate, per-leg và contribution artifacts sẽ hiển thị ở khu vực kết quả bên
                  dưới.
                </AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
