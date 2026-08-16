import type { Dispatch } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
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

type PortfolioSetupPanelProps = {
  state: BuilderState;
  dispatch: Dispatch<BuilderAction>;
  isSidebar: boolean;
};

export function PortfolioSetupPanel({ state, dispatch, isSidebar }: PortfolioSetupPanelProps) {
  const { t } = useI18n();

  return (
    <Card className={cn(isSidebar && "rounded-2xl border-border/80 shadow-sm")}>
      <CardHeader className={cn(isSidebar && "pb-3")}>
        <CardTitle
          className={cn(isSidebar && "text-xs uppercase tracking-wider text-muted-foreground")}
        >
          {isSidebar ? t("backtest.builder.strategy") : t("backtest.builder.title")}
        </CardTitle>
        {!isSidebar ? <CardDescription>{t("backtest.builder.description")}</CardDescription> : null}
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
              <FieldLabel htmlFor="portfolio-currency">{t("backtest.builder.currency")}</FieldLabel>
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
  );
}
