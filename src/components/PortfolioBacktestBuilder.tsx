"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AlertCircle, Loader2, Play } from "lucide-react";
import { toast } from "sonner";

import { PortfolioAllocationPanel } from "@/components/portfolio-backtest-builder/PortfolioAllocationPanel";
import { PortfolioAssumptionsPanel } from "@/components/portfolio-backtest-builder/PortfolioAssumptionsPanel";
import { PortfolioSetupPanel } from "@/components/portfolio-backtest-builder/PortfolioSetupPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardFooter } from "@/components/ui/card";
import { getQuantAssets, type QuantAssetCatalogItem } from "@/lib/backtest/asset-client";
import {
  builderValidationReasons,
  createInitialBuilderStateForLocale,
  reduceBuilder,
  strategyInputWithPreset,
  toPortfolioBacktestSubmission,
} from "@/lib/backtest/builder-state";
import {
  getStrategyCatalog,
  submitBacktest,
  type BacktestRun,
  type StrategyCatalogItem,
} from "@/lib/backtest/client";
import { requestOptimizedAllocation } from "@/lib/backtest/optimizer-client";
import type { OptimizerMethod } from "@/lib/backtest/optimizer-methods";
import type { BacktestStrategyPreset } from "@/lib/backtest/preselection";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

type PortfolioBacktestBuilderProps = {
  onRunCreated: (run: BacktestRun) => void;
  initialSymbols?: string[];
  strategyPreset?: BacktestStrategyPreset | null;
  layout?: "stacked" | "sidebar";
};

export function PortfolioBacktestBuilder({
  onRunCreated,
  initialSymbols = [],
  strategyPreset = null,
  layout = "stacked",
}: PortfolioBacktestBuilderProps) {
  const { t, locale } = useI18n();
  const [state, dispatch] = useReducer(reduceBuilder, locale, createInitialBuilderStateForLocale);
  const [strategies, setStrategies] = useState<StrategyCatalogItem[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizerMethod, setOptimizerMethod] = useState<OptimizerMethod>("risk_parity");
  const [targetReturnPct, setTargetReturnPct] = useState(8);
  const [targetVolatilityPct, setTargetVolatilityPct] = useState(20);
  const [markowitzRiskTolerance, setMarkowitzRiskTolerance] = useState(1);
  const [maxWeightPct, setMaxWeightPct] = useState(70);
  const loadedInitialSymbols = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void getStrategyCatalog((input, init) => fetch(input, { ...init, signal: controller.signal }))
      .then(setStrategies)
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        toast.error(t("backtest.builder.catalogError"));
      })
      .finally(() => setLoadingCatalog(false));
    return () => controller.abort();
  }, [t]);

  const initialSymbolKey = initialSymbols.join("|");
  useEffect(() => {
    if (loadedInitialSymbols.current || !initialSymbolKey || strategies.length === 0) return;
    loadedInitialSymbols.current = true;
    const controller = new AbortController();
    const symbols = initialSymbolKey.split("|");
    void Promise.all(
      symbols.map((symbol) =>
        getQuantAssets(
          { q: symbol, timeframe: state.timeframe, from: state.from, to: state.to },
          (input, init) => fetch(input, { ...init, signal: controller.signal }),
        ),
      ),
    )
      .then((catalogs) => {
        catalogs.forEach((catalog, index) => {
          const asset = catalog.items.find((item) => item.symbol === symbols[index]);
          if (!asset?.backtestable) return;
          const selectedPreset = strategyPreset
            ? strategies.find(
                (item) =>
                  item.code === strategyPreset.strategyCode &&
                  item.version === strategyPreset.strategyVersion &&
                  item.supportedMarkets.includes(asset.market) &&
                  item.supportedTimeframes.includes(state.timeframe),
              )
            : null;
          const strategy =
            selectedPreset ??
            strategies.find(
              (item) =>
                item.supportedMarkets.includes(asset.market) &&
                item.supportedTimeframes.includes(state.timeframe),
            );
          if (strategy) {
            dispatch({
              type: "assetAdded",
              asset,
              strategy:
                selectedPreset && strategyPreset
                  ? strategyInputWithPreset(strategy, strategyPreset)
                  : strategy,
            });
          }
        });
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        toast.warning(t("backtest.builder.loadSymbolsError"));
      });
    return () => controller.abort();
  }, [initialSymbolKey, state.from, state.timeframe, state.to, strategies, strategyPreset, t]);

  const selectedKey = state.legs
    .map((leg) => leg.symbol)
    .sort()
    .join("|");
  useEffect(() => {
    if (
      !selectedKey ||
      !/^\d{4}-\d{2}-\d{2}$/.test(state.from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(state.to)
    ) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const symbols = selectedKey.split("|");
      void Promise.all(
        symbols.map((symbol) =>
          getQuantAssets(
            { q: symbol, timeframe: state.timeframe, from: state.from, to: state.to },
            (input, init) => fetch(input, { ...init, signal: controller.signal }),
          ),
        ),
      )
        .then((catalogs) => {
          catalogs.forEach((catalog, index) => {
            const exact = catalog.items.find((item) => item.symbol === symbols[index]);
            if (exact) dispatch({ type: "assetRefreshed", asset: exact });
          });
        })
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === "AbortError") return;
          toast.warning(t("backtest.builder.refreshDatasetError"));
        });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [selectedKey, state.from, state.timeframe, state.to, t]);

  const reasons = useMemo(() => builderValidationReasons(state, locale), [locale, state]);
  const allocationTotalBps =
    state.assumptions.cashAllocationBps +
    state.legs.reduce((total, leg) => total + leg.allocationBps, 0);
  const investableBps = 10_000 - state.assumptions.cashAllocationBps;
  const isSidebar = layout === "sidebar";

  function defaultStrategyFor(market: string) {
    const selectedPreset = strategyPreset
      ? strategies.find(
          (strategy) =>
            strategy.code === strategyPreset.strategyCode &&
            strategy.version === strategyPreset.strategyVersion &&
            strategy.supportedMarkets.includes(market) &&
            strategy.supportedTimeframes.includes(state.timeframe),
        )
      : null;
    if (selectedPreset && strategyPreset) {
      return strategyInputWithPreset(selectedPreset, strategyPreset);
    }
    return (
      strategies.find(
        (strategy) =>
          strategy.supportedMarkets.includes(market) &&
          strategy.supportedTimeframes.includes(state.timeframe),
      ) ?? null
    );
  }

  function addAsset(asset: QuantAssetCatalogItem) {
    const strategy = defaultStrategyFor(asset.market);
    if (!strategy) {
      toast.error(
        t("backtest.builder.unsupportedStrategy", {
          symbol: asset.symbol,
          timeframe: state.timeframe,
        }),
      );
      return;
    }
    dispatch({ type: "assetAdded", asset, strategy });
  }

  async function optimizeAllocation() {
    if (state.legs.length === 0) return;
    setOptimizing(true);
    try {
      const minimumCap = Math.ceil(investableBps / state.legs.length);
      const requestedCap = Math.round(maxWeightPct * 100);
      const proposal = await requestOptimizedAllocation({
        symbols: state.legs.map((leg) => leg.symbol),
        method: optimizerMethod,
        timeframe: state.timeframe,
        from: state.from,
        to: state.to,
        maxWeightBps: Math.min(10_000, Math.max(minimumCap, requestedCap)),
        totalWeightBps: investableBps,
        ...(optimizerMethod === "target_return" ? { targetReturnPct } : {}),
        ...(optimizerMethod === "target_volatility" ? { targetVolatilityPct } : {}),
        ...(optimizerMethod === "risk_tolerance" ? { riskTolerance: markowitzRiskTolerance } : {}),
        dividendMode: state.assumptions.dividendMode,
      });
      dispatch({ type: "optimizerApplied", proposal });
      toast.success(t("backtest.builder.optimizerApplied"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("backtest.builder.optimizerError"));
    } finally {
      setOptimizing(false);
    }
  }

  async function submitPortfolio() {
    setSubmitting(true);
    try {
      const run = await submitBacktest(toPortfolioBacktestSubmission(state, locale));
      onRunCreated(run);
      toast.success(t("backtest.builder.queued"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("backtest.builder.createError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-5", isSidebar && "gap-4")}>
      <PortfolioSetupPanel state={state} dispatch={dispatch} isSidebar={isSidebar} />
      <PortfolioAllocationPanel
        state={state}
        strategies={strategies}
        loadingCatalog={loadingCatalog}
        isSidebar={isSidebar}
        optimizerMethod={optimizerMethod}
        targetReturnPct={targetReturnPct}
        targetVolatilityPct={targetVolatilityPct}
        markowitzRiskTolerance={markowitzRiskTolerance}
        maxWeightPct={maxWeightPct}
        optimizing={optimizing}
        investableBps={investableBps}
        allocationTotalBps={allocationTotalBps}
        dispatch={dispatch}
        onAssetAdd={addAsset}
        onOptimizerMethodChange={setOptimizerMethod}
        onTargetReturnChange={setTargetReturnPct}
        onTargetVolatilityChange={setTargetVolatilityPct}
        onRiskToleranceChange={setMarkowitzRiskTolerance}
        onMaxWeightChange={setMaxWeightPct}
        onOptimize={() => void optimizeAllocation()}
      />
      <PortfolioAssumptionsPanel state={state} dispatch={dispatch} isSidebar={isSidebar} />

      {reasons.length > 0 ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>{t("backtest.builder.invalidTitle")}</AlertTitle>
          <AlertDescription>
            <ul className="ml-4 list-disc">
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className={cn(isSidebar && "rounded-2xl border-border/80 bg-transparent shadow-none")}>
        <CardFooter
          className={cn(
            "flex-col justify-between gap-3 pt-6 sm:flex-row",
            isSidebar && "items-stretch p-0 sm:flex-col",
          )}
        >
          {!isSidebar ? (
            <p className="text-sm text-muted-foreground">{t("backtest.builder.footer")}</p>
          ) : null}
          <Button
            type="button"
            size="lg"
            className={cn(isSidebar && "h-14 w-full rounded-2xl text-base font-semibold")}
            disabled={submitting || reasons.length > 0}
            onClick={() => void submitPortfolio()}
          >
            {submitting ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <Play data-icon="inline-start" />
            )}
            {t("backtest.builder.run")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
