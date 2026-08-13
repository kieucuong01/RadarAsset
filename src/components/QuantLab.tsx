"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Activity, BookOpen, Brain, ChartScatter, FlaskConical, Sliders } from "lucide-react";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import { QuantDataReadinessBadge } from "@/components/QuantDataReadinessBadge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  initialQuantLabTab,
  normalizeQuantLabTab,
  type BacktestStrategyPreset,
  type QuantLabTab,
} from "@/lib/backtest/preselection";
import { useI18n } from "@/lib/i18n/context";

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

const StrategyLab = dynamic(
  () => import("@/components/StrategyLab").then((module) => module.StrategyLab),
  { ssr: false, loading: () => <WorkbenchSkeleton /> },
);

const FactorLab = dynamic(
  () => import("@/components/FactorLab").then((module) => module.FactorLab),
  { ssr: false, loading: () => <WorkbenchSkeleton /> },
);

export function QuantLab({ initialSymbols = [] }: { initialSymbols?: string[] }) {
  const [tab, setTab] = useState<QuantLabTab>(() => initialQuantLabTab(initialSymbols));
  const [strategyPreset, setStrategyPreset] = useState<BacktestStrategyPreset | null>(null);
  const [strategySymbols, setStrategySymbols] = useState<string[]>([]);
  const { t } = useI18n();

  return (
    <main className="mx-auto min-w-0 max-w-[1500px] px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
            <Activity aria-hidden="true" className="size-4 text-primary" />
            {t("quant.eyebrow")}
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">{t("quant.title")}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">{t("quant.hero.description")}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {tab === "predict" ? null : <QuantDataReadinessBadge />}
          <DataStatusBadge
            status={tab === "predict" ? "UNAVAILABLE" : "SYSTEM"}
            detail={
              tab === "predict"
                ? t("quant.status.predictionUnavailable")
                : t("quant.status.system")
            }
          />
        </div>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(normalizeQuantLabTab(value))}>
        <div className="mb-6 overflow-x-auto pb-1">
          <TabsList className="min-w-max">
            <TabsTrigger value="optimizer">
              <Sliders />
              {t("quant.tabs.optimizer")}
            </TabsTrigger>
            <TabsTrigger value="strategies">
              <BookOpen />
              {t("quant.tabs.strategies")}
            </TabsTrigger>
            <TabsTrigger value="backtest">
              <FlaskConical />
              {t("quant.tabs.backtest")}
            </TabsTrigger>
            <TabsTrigger value="factors">
              <ChartScatter />
              {t("quant.tabs.factors")}
            </TabsTrigger>
            <TabsTrigger value="predict">
              <Brain />
              {t("quant.tabs.predict")}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="optimizer">
          <PortfolioOptimizerWorkbench initialSymbols={initialSymbols} />
        </TabsContent>
        <TabsContent value="strategies">
          <StrategyLab
            onUsePreset={({ preset, symbols }) => {
              setStrategyPreset(preset);
              setStrategySymbols(symbols);
              setTab("backtest");
            }}
          />
        </TabsContent>
        <TabsContent value="backtest">
          <BacktestWorkbench
            initialSymbols={strategySymbols.length > 0 ? strategySymbols : initialSymbols}
            strategyPreset={strategyPreset}
          />
        </TabsContent>
        <TabsContent value="factors">
          <FactorLab />
        </TabsContent>
        <TabsContent value="predict">
          <Card>
            <CardHeader>
              <CardTitle>{t("quant.prediction.title")}</CardTitle>
              <CardDescription>{t("quant.prediction.description")}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {t("quant.prediction.body")}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </main>
  );
}

function WorkbenchSkeleton() {
  const { t } = useI18n();
  return (
    <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]" aria-label={t("quant.loading")}>
      <Skeleton className="h-[520px] rounded-xl" />
      <Skeleton className="h-[520px] rounded-xl" />
    </div>
  );
}
