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

type BacktestLegCardProps = {
  leg: DraftBacktestLeg;
  strategies: StrategyCatalogItem[];
  timeframe: "1d" | "1h";
  totalCapital: number;
  baseCurrency: "USD" | "VND";
  dispatch: (action: BuilderAction) => void;
};

function formatMoney(value: number, currency: "USD" | "VND") {
  return new Intl.NumberFormat(currency === "VND" ? "vi-VN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "VND" ? 0 : 2,
  }).format(value);
}

export function BacktestLegCard({
  leg,
  strategies,
  timeframe,
  totalCapital,
  baseCurrency,
  dispatch,
}: BacktestLegCardProps) {
  const notional = (totalCapital * leg.allocationBps) / 10_000;
  const leverageOptions = [1, 1.5, 2].filter((value) => value <= leg.maxLeverage);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2">
              <span>{leg.symbol}</span>
              <Badge variant="secondary">{leg.market}</Badge>
              <Badge variant="outline">{leg.freshness}</Badge>
            </CardTitle>
            <CardDescription className="mt-1 truncate">
              {leg.name} · {leg.currency} · {leg.rowCount.toLocaleString()} bars
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Xóa ${leg.symbol}`}
            onClick={() => dispatch({ type: "assetRemoved", symbol: leg.symbol })}
          >
            <Trash2 />
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field>
              <FieldLabel htmlFor={`${leg.symbol}-weight`}>Trọng số (%)</FieldLabel>
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
              <FieldLabel htmlFor={`${leg.symbol}-notional`}>Vốn phân bổ</FieldLabel>
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
              <FieldDescription>{formatMoney(notional, baseCurrency)}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${leg.symbol}-strategy`}>Chiến lược</FieldLabel>
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
              <FieldLabel htmlFor={`${leg.symbol}-leverage`}>Đòn bẩy</FieldLabel>
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
                        {value.toFixed(1)}×
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>Tối đa {leg.maxLeverage.toFixed(1)}×</FieldDescription>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {leg.strategyParameterSchema.map((parameter) => (
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
                  value={leg.strategyParameters[parameter.name] ?? parameter.default}
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
            ))}
          </div>
        </FieldGroup>
      </CardContent>

      <CardFooter className="justify-between gap-3 text-xs text-muted-foreground">
        <span>Dataset {leg.datasetVersionId}</span>
        <span>{timeframe} · long-only · next-bar open</span>
      </CardFooter>
    </Card>
  );
}
