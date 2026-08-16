import type { Dispatch } from "react";
import { AlertCircle } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BuilderAction, BuilderState } from "@/lib/backtest/builder-state";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

const MARKET_KEYS = ["vn_equity", "crypto_spot", "metal_spot"] as const;
const COST_KEYS = ["commissionBps", "sellTaxBps", "slippageBps", "financingBpsAnnual"] as const;

type PortfolioAssumptionsPanelProps = {
  state: BuilderState;
  dispatch: Dispatch<BuilderAction>;
  isSidebar: boolean;
};

export function PortfolioAssumptionsPanel({
  state,
  dispatch,
  isSidebar,
}: PortfolioAssumptionsPanelProps) {
  const { t } = useI18n();
  const selectedAdjustmentPolicy =
    state.assumptions.dividendMode === "adjusted_prices" ? "total_return" : "raw";
  const adjustmentUnavailableSymbols = state.legs
    .filter((leg) => !leg.availableAdjustments.includes(selectedAdjustmentPolicy))
    .map((leg) => leg.symbol);

  return (
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
            <FieldLabel htmlFor="rebalance-frequency">{t("backtest.builder.rebalance")}</FieldLabel>
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
  );
}
