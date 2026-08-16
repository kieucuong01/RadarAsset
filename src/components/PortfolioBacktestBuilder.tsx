"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AlertCircle, Calculator, Loader2, Play, WalletCards } from "lucide-react";
import { toast } from "sonner";

import { BacktestLegCard } from "@/components/BacktestLegCard";
import { QuantAssetPickerDialog } from "@/components/QuantAssetPickerDialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getQuantAssets } from "@/lib/backtest/asset-client";
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
import {
  OPTIMIZER_METHODS,
  optimizerMethodTranslationKey,
  type OptimizerMethod,
} from "@/lib/backtest/optimizer-methods";
import type { BacktestStrategyPreset } from "@/lib/backtest/preselection";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

type PortfolioBacktestBuilderProps = {
  onRunCreated: (run: BacktestRun) => void;
  initialSymbols?: string[];
  strategyPreset?: BacktestStrategyPreset | null;
  layout?: "stacked" | "sidebar";
};

const MARKET_KEYS = ["vn_equity", "crypto_spot", "metal_spot"] as const;
const COST_KEYS = ["commissionBps", "sellTaxBps", "slippageBps", "financingBpsAnnual"] as const;

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
  const selectedAdjustmentPolicy =
    state.assumptions.dividendMode === "adjusted_prices" ? "total_return" : "raw";
  const adjustmentUnavailableSymbols = state.legs
    .filter((leg) => !leg.availableAdjustments.includes(selectedAdjustmentPolicy))
    .map((leg) => leg.symbol);

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
      <Card className={cn(isSidebar && "rounded-2xl border-border/80 shadow-sm")}>
        <CardHeader className={cn(isSidebar && "pb-3")}>
          <CardTitle
            className={cn(isSidebar && "text-xs uppercase tracking-wider text-muted-foreground")}
          >
            {isSidebar ? t("backtest.builder.strategy") : t("backtest.builder.title")}
          </CardTitle>
          {!isSidebar ? (
            <CardDescription>{t("backtest.builder.description")}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className={cn(isSidebar && "pb-5")}>
          <FieldGroup>
            <div
              className={cn(
                "grid gap-4 sm:grid-cols-2 lg:grid-cols-5",
                isSidebar && "grid-cols-1 sm:grid-cols-1 lg:grid-cols-1",
              )}
            >
              <Field>
                <FieldLabel htmlFor="portfolio-capital">
                  {t("backtest.builder.totalCapital")}
                </FieldLabel>
                <Input
                  id="portfolio-capital"
                  type="number"
                  inputMode="decimal"
                  min={1}
                  value={state.totalCapital}
                  onChange={(event) =>
                    dispatch({
                      type: "totalCapitalEdited",
                      totalCapital: Number(event.target.value),
                    })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="portfolio-currency">
                  {t("backtest.builder.currency")}
                </FieldLabel>
                <Select
                  value={state.assumptions.baseCurrency}
                  onValueChange={(value: "USD" | "VND") =>
                    dispatch({ type: "assumptionEdited", key: "baseCurrency", value })
                  }
                >
                  <SelectTrigger id="portfolio-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="VND">VND</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="portfolio-timeframe">
                  {t("backtest.builder.timeframe")}
                </FieldLabel>
                <Select
                  value={state.timeframe}
                  onValueChange={(value: "1d" | "1h") =>
                    dispatch({ type: "timeframeChanged", timeframe: value })
                  }
                >
                  <SelectTrigger id="portfolio-timeframe">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="1d">{t("backtest.builder.day")}</SelectItem>
                      <SelectItem value="1h">{t("backtest.builder.hour")}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="portfolio-from">{t("backtest.builder.from")}</FieldLabel>
                <Input
                  id="portfolio-from"
                  type="date"
                  value={state.from}
                  onChange={(event) =>
                    dispatch({ type: "rangeChanged", from: event.target.value, to: state.to })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="portfolio-to">{t("backtest.builder.to")}</FieldLabel>
                <Input
                  id="portfolio-to"
                  type="date"
                  value={state.to}
                  onChange={(event) =>
                    dispatch({ type: "rangeChanged", from: state.from, to: event.target.value })
                  }
                />
              </Field>
            </div>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card className={cn(isSidebar && "rounded-2xl border-border/80 shadow-sm")}>
        <CardHeader className={cn(isSidebar && "pb-3")}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle
                className={cn(
                  isSidebar && "text-xs uppercase tracking-wider text-muted-foreground",
                )}
              >
                {isSidebar ? t("backtest.builder.legs") : t("backtest.builder.allocation")}
              </CardTitle>
              {!isSidebar ? (
                <CardDescription className="mt-1">
                  {t("backtest.builder.allocationDescription")}
                </CardDescription>
              ) : null}
            </div>
            <QuantAssetPickerDialog
              timeframe={state.timeframe}
              from={state.from}
              to={state.to}
              selectedSymbols={state.legs.map((leg) => leg.symbol)}
              disabled={loadingCatalog || strategies.length === 0 || state.legs.length >= 10}
              onAdd={(asset) => {
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
              }}
            />
          </div>
        </CardHeader>
        <CardContent className={cn("flex flex-col gap-5", isSidebar && "gap-4")}>
          <div
            className={cn(
              "flex flex-wrap items-end justify-between gap-4",
              isSidebar && "flex-col items-stretch",
            )}
          >
            <Field>
              <FieldLabel>{t("backtest.builder.mode")}</FieldLabel>
              <ToggleGroup
                type="single"
                value={state.allocationMode === "optimized" ? "" : state.allocationMode}
                onValueChange={(value) => {
                  if (value === "equal" || value === "custom") {
                    dispatch({ type: "allocationModeChanged", allocationMode: value });
                  }
                }}
                variant="outline"
              >
                <ToggleGroupItem value="equal">{t("backtest.builder.equal")}</ToggleGroupItem>
                <ToggleGroupItem value="custom">{t("backtest.builder.custom")}</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            <div
              className={cn(
                "flex flex-wrap items-end gap-3",
                isSidebar && "flex-col items-stretch",
              )}
            >
              <Field className={cn("w-64", isSidebar && "w-full")}>
                <FieldLabel htmlFor="backtest-optimizer-method">
                  {t("backtest.builder.optimizerMethod")}
                </FieldLabel>
                <Select
                  value={optimizerMethod}
                  onValueChange={(value: OptimizerMethod) => setOptimizerMethod(value)}
                >
                  <SelectTrigger id="backtest-optimizer-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {OPTIMIZER_METHODS.map((method) => (
                        <SelectItem key={method} value={method}>
                          {t(optimizerMethodTranslationKey(method, "label"))}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {t(optimizerMethodTranslationKey(optimizerMethod, "description"))}
                </FieldDescription>
              </Field>
              {optimizerMethod === "target_return" ? (
                <Field className={cn("w-40", isSidebar && "w-full")}>
                  <FieldLabel htmlFor="backtest-target-return">
                    {t("backtest.builder.targetReturn")}
                  </FieldLabel>
                  <Input
                    id="backtest-target-return"
                    type="number"
                    inputMode="decimal"
                    min={-100}
                    max={1000}
                    step={0.5}
                    value={targetReturnPct}
                    onChange={(event) => setTargetReturnPct(Number(event.target.value))}
                  />
                </Field>
              ) : null}
              {optimizerMethod === "target_volatility" ? (
                <Field className={cn("w-40", isSidebar && "w-full")}>
                  <FieldLabel htmlFor="backtest-target-volatility">
                    {t("backtest.builder.targetVolatility")}
                  </FieldLabel>
                  <Input
                    id="backtest-target-volatility"
                    type="number"
                    inputMode="decimal"
                    min={0.1}
                    max={1000}
                    step={0.5}
                    value={targetVolatilityPct}
                    onChange={(event) => setTargetVolatilityPct(Number(event.target.value))}
                  />
                </Field>
              ) : null}
              {optimizerMethod === "risk_tolerance" ? (
                <Field className={cn("w-40", isSidebar && "w-full")}>
                  <FieldLabel>
                    {t("backtest.builder.riskTolerance", { value: markowitzRiskTolerance })}
                  </FieldLabel>
                  <Slider
                    value={[markowitzRiskTolerance]}
                    min={0.1}
                    max={10}
                    step={0.1}
                    onValueChange={([value]) => setMarkowitzRiskTolerance(value)}
                    aria-label={t("backtest.builder.riskToleranceAria")}
                  />
                </Field>
              ) : null}
              <Field className={cn("w-40", isSidebar && "w-full")}>
                <FieldLabel>{t("backtest.builder.maxWeight", { value: maxWeightPct })}</FieldLabel>
                <Slider
                  value={[maxWeightPct]}
                  min={10}
                  max={100}
                  step={5}
                  onValueChange={([value]) => setMaxWeightPct(value)}
                  aria-label={t("backtest.builder.maxWeightAria")}
                />
              </Field>
              <Button
                type="button"
                variant={state.allocationMode === "optimized" ? "secondary" : "outline"}
                disabled={optimizing || state.legs.length === 0 || investableBps === 0}
                onClick={() => void optimizeAllocation()}
              >
                {optimizing ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : (
                  <Calculator data-icon="inline-start" />
                )}
                {t("backtest.builder.optimize")}
              </Button>
            </div>
          </div>

          <div
            className={cn(
              "grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]",
              isSidebar && "lg:grid-cols-1",
            )}
          >
            <div className="flex min-w-0 flex-col gap-4">
              {state.legs.length === 0 ? (
                <Alert>
                  <WalletCards />
                  <AlertTitle>{t("backtest.builder.emptyTitle")}</AlertTitle>
                  <AlertDescription>{t("backtest.builder.emptyDescription")}</AlertDescription>
                </Alert>
              ) : null}
              {state.legs.map((leg) => (
                <BacktestLegCard
                  key={leg.symbol}
                  leg={leg}
                  strategies={strategies}
                  timeframe={state.timeframe}
                  totalCapital={state.totalCapital}
                  baseCurrency={state.assumptions.baseCurrency}
                  compact={isSidebar}
                  dispatch={dispatch}
                />
              ))}
            </div>

            <Card
              className={cn(
                "h-fit lg:sticky lg:top-20",
                isSidebar && "rounded-xl shadow-none lg:static",
              )}
            >
              <CardHeader className={cn(isSidebar && "pb-3")}>
                <CardTitle className={cn(isSidebar && "text-sm")}>
                  {t("backtest.builder.cash")}
                </CardTitle>
                {!isSidebar ? (
                  <CardDescription>{t("backtest.builder.cashDescription")}</CardDescription>
                ) : null}
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="cash-weight">
                      {t("backtest.builder.cashWeight")}
                    </FieldLabel>
                    <Input
                      id="cash-weight"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      step={0.01}
                      value={state.assumptions.cashAllocationBps / 100}
                      onChange={(event) =>
                        dispatch({
                          type: "cashAllocationEdited",
                          cashAllocationBps: Math.round(Number(event.target.value) * 100),
                        })
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="cash-notional">
                      {t("backtest.builder.cashValue")}
                    </FieldLabel>
                    <Input
                      id="cash-notional"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      value={Number(
                        (
                          (state.totalCapital * state.assumptions.cashAllocationBps) /
                          10_000
                        ).toFixed(2),
                      )}
                      onChange={(event) =>
                        dispatch({
                          type: "cashAllocationEdited",
                          cashAllocationBps:
                            state.totalCapital > 0
                              ? Math.round(
                                  (Number(event.target.value) / state.totalCapital) * 10_000,
                                )
                              : 0,
                        })
                      }
                    />
                  </Field>
                </FieldGroup>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span>{t("backtest.builder.totalWeight")}</span>
              <Badge variant={allocationTotalBps === 10_000 ? "secondary" : "destructive"}>
                {(allocationTotalBps / 100).toFixed(2)}%
              </Badge>
            </div>
            <Progress value={Math.min(100, allocationTotalBps / 100)} />
            {state.optimizerProposal ? (
              <p className="text-xs text-muted-foreground">
                {t("backtest.builder.optimizedBy")}{" "}
                {t(optimizerMethodTranslationKey(state.optimizerProposal.method, "label"))} ·{" "}
                {state.optimizerProposal.source.library} {state.optimizerProposal.source.version}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className={cn(isSidebar && "rounded-2xl border-border/80 shadow-sm")}>
        <CardHeader className={cn(isSidebar && "pb-3")}>
          <CardTitle
            className={cn(isSidebar && "text-xs uppercase tracking-wider text-muted-foreground")}
          >
            {t("backtest.builder.assumptions")}
          </CardTitle>
          {!isSidebar ? (
            <CardDescription>{t("backtest.builder.assumptionsDescription")}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className={cn("flex flex-col gap-5", isSidebar && "gap-4")}>
          <div
            className={cn(
              "grid gap-4 sm:grid-cols-2 lg:grid-cols-4",
              isSidebar && "grid-cols-1 sm:grid-cols-1 lg:grid-cols-1",
            )}
          >
            <Field>
              <FieldLabel htmlFor="rebalance-frequency">
                {t("backtest.builder.rebalance")}
              </FieldLabel>
              <Select
                value={state.assumptions.rebalanceFrequency}
                onValueChange={(value: "none" | "monthly" | "quarterly" | "yearly") =>
                  dispatch({ type: "assumptionEdited", key: "rebalanceFrequency", value })
                }
              >
                <SelectTrigger id="rebalance-frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">{t("backtest.builder.none")}</SelectItem>
                    <SelectItem value="monthly">{t("backtest.builder.monthly")}</SelectItem>
                    <SelectItem value="quarterly">{t("backtest.builder.quarterly")}</SelectItem>
                    <SelectItem value="yearly">{t("backtest.builder.yearly")}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                {state.assumptions.dividendMode === "adjusted_prices"
                  ? t("backtest.builder.adjustedPolicyDescription")
                  : t("backtest.builder.rawPolicyDescription")}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="monthly-contribution">
                {t("backtest.builder.monthlyContribution")}
              </FieldLabel>
              <Input
                id="monthly-contribution"
                type="number"
                inputMode="decimal"
                min={0}
                value={state.assumptions.monthlyContribution}
                onChange={(event) =>
                  dispatch({
                    type: "assumptionEdited",
                    key: "monthlyContribution",
                    value: Number(event.target.value),
                  })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="dividend-mode">{t("backtest.builder.dividend")}</FieldLabel>
              <Select
                value={state.assumptions.dividendMode}
                onValueChange={(value: "exclude" | "adjusted_prices") =>
                  dispatch({ type: "assumptionEdited", key: "dividendMode", value })
                }
              >
                <SelectTrigger id="dividend-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="exclude">{t("backtest.builder.excludeDividend")}</SelectItem>
                    <SelectItem value="adjusted_prices">
                      {t("backtest.builder.adjustedPrices")}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{t("backtest.builder.fxPolicy")}</FieldLabel>
              <Input value="Normalized returns" readOnly aria-readonly="true" />
              <FieldDescription>{t("backtest.builder.fxDescription")}</FieldDescription>
            </Field>
          </div>

          <Alert>
            <AlertCircle />
            <AlertTitle>{t("backtest.builder.noFakeTitle")}</AlertTitle>
            <AlertDescription>
              {t("backtest.builder.noFakeDescription")} {t("backtest.builder.survivorshipNotice")}
            </AlertDescription>
          </Alert>
          {adjustmentUnavailableSymbols.length > 0 ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>{t("backtest.builder.adjustmentUnavailableTitle")}</AlertTitle>
              <AlertDescription>
                {t("backtest.builder.adjustmentUnavailableDescription", {
                  symbols: adjustmentUnavailableSymbols.join(", "),
                })}
              </AlertDescription>
            </Alert>
          ) : null}

          <Accordion type="multiple" className="w-full">
            {MARKET_KEYS.map((market) => (
              <AccordionItem key={market} value={market}>
                <AccordionTrigger>{t(`backtest.builder.markets.${market}`)}</AccordionTrigger>
                <AccordionContent>
                  <FieldSet>
                    <FieldLegend variant="label">{t("backtest.builder.costModel")}</FieldLegend>
                    <div
                      className={cn(
                        "grid gap-4 sm:grid-cols-2 lg:grid-cols-4",
                        isSidebar && "grid-cols-1 sm:grid-cols-1 lg:grid-cols-1",
                      )}
                    >
                      {COST_KEYS.map((key) => (
                        <Field key={key}>
                          <FieldLabel htmlFor={`${market}-${key}`}>
                            {t(`backtest.builder.costs.${key}`)}
                          </FieldLabel>
                          <Input
                            id={`${market}-${key}`}
                            type="number"
                            inputMode="decimal"
                            min={0}
                            value={state.assumptions.marketCosts[market][key]}
                            onChange={(event) =>
                              dispatch({
                                type: "marketCostEdited",
                                market,
                                key,
                                value: Number(event.target.value),
                              })
                            }
                          />
                        </Field>
                      ))}
                    </div>
                  </FieldSet>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

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
