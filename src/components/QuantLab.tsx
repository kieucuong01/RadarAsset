"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Activity, Brain, ChartScatter, FlaskConical, Sliders } from "lucide-react";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { initialQuantLabTab } from "@/lib/backtest/preselection";

const PortfolioOptimizerWorkbench = dynamic(
  () =>
    import("@/components/PortfolioOptimizerWorkbench").then(
      (module) => module.PortfolioOptimizerWorkbench,
    ),
  { ssr: false, loading: () => <WorkbenchSkeleton /> },
);

const BacktestWorkbench = dynamic(
  () => import("@/components/BacktestWorkbench").then((module) => module.BacktestWorkbench),
  { ssr: false, loading: () => <WorkbenchSkeleton /> },
);

const FactorLab = dynamic(
  () => import("@/components/FactorLab").then((module) => module.FactorLab),
  { ssr: false, loading: () => <WorkbenchSkeleton /> },
);

type TabKey = "optimizer" | "predict" | "backtest" | "factors";

export function QuantLab({ initialSymbols = [] }: { initialSymbols?: string[] }) {
  const [tab, setTab] = useState<TabKey>(() => initialQuantLabTab(initialSymbols));

  return (
    <main className="mx-auto min-w-0 max-w-[1500px] px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
            <Activity aria-hidden="true" className="size-4 text-primary" />
            Quantitative Simulation Workbench
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">Quant Lab</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Tối ưu và backtest danh mục từ immutable market datasets. Kết quả là mô phỏng nghiên
            cứu, không phải khuyến nghị hoặc lệnh tại broker.
          </p>
        </div>
        <DataStatusBadge
          status={tab === "predict" ? "UNAVAILABLE" : "SYSTEM"}
          detail={
            tab === "predict"
              ? "AI Prediction chưa được nối vào provider production."
              : "Dữ liệu và tác vụ được xử lý qua API/worker của hệ thống."
          }
        />
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabKey)}>
        <div className="mb-6 overflow-x-auto pb-1">
          <TabsList className="min-w-max">
            <TabsTrigger value="optimizer">
              <Sliders />
              Portfolio Optimizer
            </TabsTrigger>
            <TabsTrigger value="backtest">
              <FlaskConical />
              Backtest & Risk Engine
            </TabsTrigger>
            <TabsTrigger value="factors">
              <ChartScatter />
              VN Factor Lab
            </TabsTrigger>
            <TabsTrigger value="predict">
              <Brain />
              AI Prediction
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="optimizer">
          <PortfolioOptimizerWorkbench initialSymbols={initialSymbols} />
        </TabsContent>
        <TabsContent value="backtest">
          <BacktestWorkbench initialSymbols={initialSymbols} />
        </TabsContent>
        <TabsContent value="factors">
          <FactorLab />
        </TabsContent>
        <TabsContent value="predict">
          <Card>
            <CardHeader>
              <CardTitle>AI Prediction chưa sẵn sàng</CardTitle>
              <CardDescription>
                Tab này chưa có model/provider production được kiểm chứng nên hệ thống không hiển
                thị dự báo mô phỏng.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Ưu tiên hiện tại là hoàn thiện portfolio backtest, strategy alerts và ingestion dữ
              liệu miễn phí.
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </main>
  );
}

function WorkbenchSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]" aria-label="Đang tải Quant Lab">
      <Skeleton className="h-[520px] rounded-xl" />
      <Skeleton className="h-[520px] rounded-xl" />
    </div>
  );
}
