"use client";

import { useState } from "react";

import { AdvancedAnalysisSummary } from "@/components/backtest-results/advanced/AdvancedAnalysisSummary";
import { AggregatePortfolioAnalysis } from "@/components/backtest-results/advanced/AggregatePortfolioAnalysis";
import { BacktestLegAnalysis } from "@/components/backtest-results/advanced/BacktestLegAnalysis";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InlineFeedback, type InlineFeedbackState } from "@/components/ui/inline-feedback";
import { normalizeStrategyAssignment } from "@/lib/backtest/assignment-contracts";
import type { BacktestRun } from "@/lib/backtest/client";
import type { BacktestResultModel } from "@/lib/backtest/result-model";
import { advancedAnalysisAvailability } from "@/lib/backtest/result-presentation";
import { useI18n } from "@/lib/i18n/context";

type BacktestAdvancedAnalysisProps = {
  run: BacktestRun;
  model: BacktestResultModel;
  currency: "USD" | "VND";
};

export function BacktestAdvancedAnalysis({ run, model, currency }: BacktestAdvancedAnalysisProps) {
  const [applyingLegId, setApplyingLegId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);
  const availability = advancedAnalysisAvailability(model);
  const { t } = useI18n();

  async function applyStrategy(leg: BacktestResultModel["legs"][number]) {
    setApplyingLegId(leg.id);
    try {
      const input = normalizeStrategyAssignment({
        symbol: leg.symbol,
        strategyCode: leg.strategyCode,
        strategyVersion: leg.strategyVersion,
        strategyParameters: leg.strategyParameters,
        backtestRunId: run.id,
        backtestRunLegId: leg.id,
      });
      const response = await fetch("/api/portfolio/strategy-assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? t("backtest.builder.advanced.applyError"));
      }
      setFeedback({
        tone: "success",
        message: t("backtest.builder.advanced.applySuccess", {
          strategy: leg.strategyCode,
          symbol: leg.symbol,
        }),
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : t("backtest.builder.advanced.applyError"),
      });
    } finally {
      setApplyingLegId(null);
    }
  }

  function downloadQuantStatsReport() {
    if (!model.aggregate.reportHtml) return;
    const url = URL.createObjectURL(new Blob([model.aggregate.reportHtml], { type: "text/html" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `quantstats-${run.id.slice(0, 8)}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <details className="min-w-0 max-w-full rounded-xl border bg-card text-card-foreground shadow">
      <summary className="cursor-pointer px-6 py-5 font-semibold">
        {t("backtestResults.advanced.title")}
      </summary>
      <div className="flex min-w-0 flex-col gap-5 px-6 pb-6">
        {feedback ? <InlineFeedback {...feedback} /> : null}
        <AdvancedAnalysisSummary
          model={model}
          availability={availability}
          onDownloadReport={downloadQuantStatsReport}
        />

        <Tabs defaultValue="aggregate" className="min-w-0">
          <div className="max-w-full overflow-x-auto pb-1">
            <TabsList className="w-max justify-start">
              <TabsTrigger value="aggregate">{t("backtestResults.advanced.aggregate")}</TabsTrigger>
              {model.legs.map((leg) => (
                <TabsTrigger key={leg.id} value={leg.id}>
                  {leg.symbol}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="aggregate" className="min-w-0">
            <AggregatePortfolioAnalysis
              model={model}
              availability={availability}
              currency={currency}
            />
          </TabsContent>

          {model.legs.map((leg) => (
            <TabsContent key={leg.id} value={leg.id} className="min-w-0">
              <BacktestLegAnalysis
                leg={leg}
                currency={currency}
                applying={applyingLegId === leg.id}
                applyDisabled={applyingLegId !== null}
                onApply={() => void applyStrategy(leg)}
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </details>
  );
}
