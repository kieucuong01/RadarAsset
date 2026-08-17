"use client";

import { Trash2 } from "lucide-react";

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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BuilderAction, DraftBacktestLeg } from "@/lib/backtest/builder-state";
import type { StrategyCatalogItem } from "@/lib/backtest/client";
import { formatCount, formatMoney, formatNumber } from "@/lib/financial-format";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

type BacktestLegCardProps = {
  leg: DraftBacktestLeg;
  strategies: StrategyCatalogItem[];
  timeframe: "1d";
  totalCapital: number;
  baseCurrency: "USD" | "VND";
  compact?: boolean;
  dispatch: (action: BuilderAction) => void;
};

export function BacktestLegCard({
  leg,
  strategies,
  timeframe,
  totalCapital,
  baseCurrency,
  compact = false,
  dispatch,
}: BacktestLegCardProps) {
  const notional = (totalCapital * leg.allocationBps) / 10_000;
  const leverageOptions = [1, 1.5, 2].filter((value) => value <= leg.maxLeverage);
  const { t, locale } = useI18n();

  return (
    <Card className={cn(compact && "rounded-2xl border-border/80 shadow-sm")}>
      <CardHeader className={cn(compact && "pb-3")}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2">
              <span
                className={cn(compact && "font-mono text-xs uppercase tracking-wider text-primary")}
              >
                {compact
                  ? locale === "vi"
                    ? `Nhánh #${leg.symbol}`
                    : `Leg #${leg.symbol}`
                  : leg.symbol}
              </span>
              {!compact ? (
                <Badge variant="secondary">
                  {locale === "vi"
                    ? leg.market === "vn_equity"
                      ? "Chứng khoán Việt Nam"
                      : leg.market === "crypto_spot"
                        ? "Crypto giao ngay"
                        : leg.market === "metal_spot"
                          ? "XAU/USD giao ngay"
                          : leg.market
                    : leg.market}
                </Badge>
              ) : null}
              <Badge variant="outline">
                {locale === "vi"
                  ? leg.freshness === "fresh"
                    ? "Mới"
                    : leg.freshness === "stale"
                      ? "Cũ"
                      : leg.freshness === "unavailable"
                        ? "Chưa có"
                        : "Dữ liệu mẫu"
                  : leg.freshness}
              </Badge>
            </CardTitle>
            <CardDescription className={cn("mt-1", compact ? "line-clamp-2" : "truncate")}>
              {leg.name} · {leg.currency} · {formatCount(leg.rowCount)} {t("backtest.builder.bars")}
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("backtest.builder.leg.remove", { symbol: leg.symbol })}
            onClick={() => dispatch({ type: "assetRemoved", symbol: leg.symbol })}
          >
            <Trash2 />
          </Button>
        </div>
      </CardHeader>

      <CardContent className={cn(compact && "pb-4")}>
        <FieldGroup>
          <div
            className={cn(
              "grid gap-4 sm:grid-cols-2 lg:grid-cols-4",
              compact && "grid-cols-1 sm:grid-cols-1 lg:grid-cols-1",
            )}
          >
            <Field>
              <FieldLabel htmlFor={`${leg.symbol}-weight`}>
                {t("backtest.builder.leg.weight")}
              </FieldLabel>
              <Input
                id={`${leg.symbol}-weight`}
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step={0.01}
                value={leg.allocationBps / 100}
                onChange={(event) =>
                  dispatch({
                    type: "allocationEdited",
                    symbol: leg.symbol,
                    allocationBps: Math.round(Number(event.target.value) * 100),
                  })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${leg.symbol}-notional`}>
                {t("backtest.builder.leg.notional")}
              </FieldLabel>
              <Input
                id={`${leg.symbol}-notional`}
                type="number"
                inputMode="decimal"
                min={0}
                step={baseCurrency === "VND" ? 1000 : 1}
                value={Number.isFinite(notional) ? Number(notional.toFixed(2)) : 0}
                onChange={(event) =>
                  dispatch({
                    type: "allocationEdited",
                    symbol: leg.symbol,
                    allocationBps:
                      totalCapital > 0
                        ? Math.round((Number(event.target.value) / totalCapital) * 10_000)
                        : 0,
                  })
                }
              />
              <FieldDescription>
                {formatMoney(notional, { locale, currency: baseCurrency })}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${leg.symbol}-strategy`}>
                {t("backtest.builder.leg.strategy")}
              </FieldLabel>
              <Select
                value={`${leg.strategyCode}@${leg.strategyVersion}`}
                onValueChange={(value) => {
                  const strategy = strategies.find(
                    (item) => `${item.code}@${item.version}` === value,
                  );
                  if (strategy) dispatch({ type: "strategyChanged", symbol: leg.symbol, strategy });
                }}
              >
                <SelectTrigger id={`${leg.symbol}-strategy`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {strategies.map((strategy) => (
                      <SelectItem
                        key={`${strategy.code}@${strategy.version}`}
                        value={`${strategy.code}@${strategy.version}`}
                        disabled={
                          !strategy.supportedMarkets.includes(leg.market) ||
                          !strategy.supportedTimeframes.includes(timeframe)
                        }
                      >
                        {strategy.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${leg.symbol}-leverage`}>
                {t("backtest.builder.leg.leverage")}
              </FieldLabel>
              <Select
                value={String(leg.leverage)}
                onValueChange={(value) =>
                  dispatch({ type: "leverageEdited", symbol: leg.symbol, leverage: Number(value) })
                }
              >
                <SelectTrigger id={`${leg.symbol}-leverage`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {leverageOptions.map((value) => (
                      <SelectItem key={value} value={String(value)}>
                        {formatNumber(value, {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        })}
                        ×
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                {t("backtest.builder.leg.maxLeverage", {
                  value: formatNumber(leg.maxLeverage, {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  }),
                })}
              </FieldDescription>
            </Field>
          </div>

          <div
            className={cn(
              "grid gap-4 sm:grid-cols-2 lg:grid-cols-3",
              compact && "grid-cols-1 sm:grid-cols-1 lg:grid-cols-1",
            )}
          >
            {leg.strategyParameterSchema.map((parameter) => {
              const configuredValue = leg.strategyParameters[parameter.name];
              return (
                <Field key={parameter.name}>
                  <FieldLabel htmlFor={`${leg.symbol}-${parameter.name}`}>
                    {parameter.label}
                  </FieldLabel>
                  <Input
                    id={`${leg.symbol}-${parameter.name}`}
                    type="number"
                    inputMode="decimal"
                    min={parameter.min}
                    max={parameter.max}
                    step={parameter.type === "integer" ? 1 : 0.01}
                    value={
                      typeof configuredValue === "number" ? configuredValue : parameter.default
                    }
                    onChange={(event) =>
                      dispatch({
                        type: "strategyParameterEdited",
                        symbol: leg.symbol,
                        parameter: parameter.name,
                        value: Number(event.target.value),
                      })
                    }
                  />
                </Field>
              );
            })}
          </div>
        </FieldGroup>
      </CardContent>

      <CardFooter className="justify-between gap-3 text-xs text-muted-foreground">
        <span>
          {locale === "vi" ? "Bộ dữ liệu" : "Dataset"} {leg.datasetVersionId}
        </span>
        <span>
          {timeframe} ·{" "}
          {locale === "vi"
            ? "chỉ mua · khớp giá mở cửa phiên kế tiếp"
            : "long-only · next-bar open"}
        </span>
      </CardFooter>
    </Card>
  );
}
