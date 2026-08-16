import type { Dispatch } from "react";
import { Calculator, Loader2, WalletCards } from "lucide-react";

import { BacktestLegCard } from "@/components/BacktestLegCard";
import { QuantAssetPickerDialog } from "@/components/QuantAssetPickerDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
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
import type { QuantAssetCatalogItem } from "@/lib/backtest/asset-client";
import type { BuilderAction, BuilderState } from "@/lib/backtest/builder-state";
import type { StrategyCatalogItem } from "@/lib/backtest/client";
import {
  OPTIMIZER_METHODS,
  optimizerMethodTranslationKey,
  type OptimizerMethod,
} from "@/lib/backtest/optimizer-methods";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

type PortfolioAllocationPanelProps = {
  state: BuilderState;
  strategies: StrategyCatalogItem[];
  loadingCatalog: boolean;
  isSidebar: boolean;
  optimizerMethod: OptimizerMethod;
  targetReturnPct: number;
  targetVolatilityPct: number;
  markowitzRiskTolerance: number;
  maxWeightPct: number;
  optimizing: boolean;
  investableBps: number;
  allocationTotalBps: number;
  dispatch: Dispatch<BuilderAction>;
  onAssetAdd: (asset: QuantAssetCatalogItem) => void;
  onOptimizerMethodChange: (method: OptimizerMethod) => void;
  onTargetReturnChange: (value: number) => void;
  onTargetVolatilityChange: (value: number) => void;
  onRiskToleranceChange: (value: number) => void;
  onMaxWeightChange: (value: number) => void;
  onOptimize: () => void;
};

export function PortfolioAllocationPanel({
  state,
  strategies,
  loadingCatalog,
  isSidebar,
  optimizerMethod,
  targetReturnPct,
  targetVolatilityPct,
  markowitzRiskTolerance,
  maxWeightPct,
  optimizing,
  investableBps,
  allocationTotalBps,
  dispatch,
  onAssetAdd,
  onOptimizerMethodChange,
  onTargetReturnChange,
  onTargetVolatilityChange,
  onRiskToleranceChange,
  onMaxWeightChange,
  onOptimize,
}: PortfolioAllocationPanelProps) {
  const { t } = useI18n();

  return (
    <Card className={cn(isSidebar && "rounded-2xl border-border/80 shadow-sm")}>
      <CardHeader className={cn(isSidebar && "pb-3")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle
              className={cn(isSidebar && "text-xs uppercase tracking-wider text-muted-foreground")}
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
            onAdd={onAssetAdd}
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
            className={cn("flex flex-wrap items-end gap-3", isSidebar && "flex-col items-stretch")}
          >
            <Field className={cn("w-64", isSidebar && "w-full")}>
              <FieldLabel htmlFor="backtest-optimizer-method">
                {t("backtest.builder.optimizerMethod")}
              </FieldLabel>
              <Select value={optimizerMethod} onValueChange={onOptimizerMethodChange}>
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
                  onChange={(event) => onTargetReturnChange(Number(event.target.value))}
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
                  onChange={(event) => onTargetVolatilityChange(Number(event.target.value))}
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
                  onValueChange={([value]) => onRiskToleranceChange(value)}
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
                onValueChange={([value]) => onMaxWeightChange(value)}
                aria-label={t("backtest.builder.maxWeightAria")}
              />
            </Field>
            <Button
              type="button"
              variant={state.allocationMode === "optimized" ? "secondary" : "outline"}
              disabled={optimizing || state.legs.length === 0 || investableBps === 0}
              onClick={onOptimize}
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
                  <FieldLabel htmlFor="cash-weight">{t("backtest.builder.cashWeight")}</FieldLabel>
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
                  <FieldLabel htmlFor="cash-notional">{t("backtest.builder.cashValue")}</FieldLabel>
                  <Input
                    id="cash-notional"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={Number(
                      ((state.totalCapital * state.assumptions.cashAllocationBps) / 10_000).toFixed(
                        2,
                      ),
                    )}
                    onChange={(event) =>
                      dispatch({
                        type: "cashAllocationEdited",
                        cashAllocationBps:
                          state.totalCapital > 0
                            ? Math.round((Number(event.target.value) / state.totalCapital) * 10_000)
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
  );
}
