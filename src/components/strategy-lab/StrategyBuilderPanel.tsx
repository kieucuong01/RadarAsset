"use client";

import type { Dispatch, SetStateAction } from "react";
import { CheckCircle2, Save } from "lucide-react";

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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { STRATEGY_CATALOG, strategyDefinition } from "@/lib/backtest/strategy-catalog";
import {
  customStrategyReadiness,
  describeCustomStrategy,
  type CustomStrategyInput,
} from "@/lib/strategy-lab/custom-strategy";
import { useI18n } from "@/lib/i18n/context";

export type StrategyBuilderState = {
  name: string;
  symbol: string;
  kind: CustomStrategyInput["kind"];
  strategyCode: string;
  strategyParameters: Record<string, number>;
  amount: number;
  currency: "USD" | "VND";
  dayOfMonth: number;
  priceOperator: "crosses_above" | "crosses_below";
  priceValue: number;
  action: "buy" | "sell";
  sizePct: number;
  metric: "pb" | "pe" | "roe";
  fundamentalOperator: "lt" | "lte" | "gt" | "gte";
  fundamentalValue: number;
};

export function StrategyBuilderPanel({
  builder,
  setBuilder,
  selectedDefinition,
  saving,
  editing,
  onSelectCatalog,
  onSave,
}: {
  builder: StrategyBuilderState;
  setBuilder: Dispatch<SetStateAction<StrategyBuilderState>>;
  selectedDefinition: (typeof STRATEGY_CATALOG)[number];
  saving: boolean;
  editing: boolean;
  onSelectCatalog: (strategyCode: string) => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
      <Card>
        <CardHeader>
          <CardTitle>{t("strategyLab.visualBuilder")}</CardTitle>
          <CardDescription>{t("strategyLab.visualBuilderDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="custom-strategy-name">
                  {t("strategyLab.strategyName")}
                </FieldLabel>
                <Input
                  id="custom-strategy-name"
                  value={builder.name}
                  onChange={(event) =>
                    setBuilder((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="custom-strategy-symbol">
                  {t("strategyLab.assetSymbol")}
                </FieldLabel>
                <Input
                  id="custom-strategy-symbol"
                  value={builder.symbol}
                  onChange={(event) =>
                    setBuilder((current) => ({
                      ...current,
                      symbol: event.target.value.toUpperCase(),
                    }))
                  }
                  placeholder="BTC, FPT, XAU"
                />
              </Field>
            </div>
            <Field>
              <FieldLabel>{t("strategyLab.ruleType")}</FieldLabel>
              <ToggleGroup
                type="single"
                value={builder.kind}
                onValueChange={(value) =>
                  value &&
                  setBuilder((current) => ({
                    ...current,
                    kind: value as StrategyBuilderState["kind"],
                  }))
                }
                variant="outline"
                className="flex-wrap justify-start"
              >
                <ToggleGroupItem value="catalog_preset">
                  {t("strategyLab.technicalIndicator")}
                </ToggleGroupItem>
                <ToggleGroupItem value="scheduled_dca">{t("strategyLab.dca")}</ToggleGroupItem>
                <ToggleGroupItem value="price_threshold">
                  {t("strategyLab.priceThreshold")}
                </ToggleGroupItem>
                <ToggleGroupItem value="fundamental_threshold">
                  {t("strategyLab.fundamentalMetric")}
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>
            <RuleFields
              builder={builder}
              setBuilder={setBuilder}
              selectedDefinition={selectedDefinition}
              onSelectCatalog={onSelectCatalog}
            />
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <Button disabled={saving} onClick={onSave}>
            <Save data-icon="inline-start" />
            {editing ? t("strategyLab.saveNewVersion") : t("strategyLab.saveStrategy")}
          </Button>
        </CardFooter>
      </Card>

      <BuilderPreview builder={builder} />
    </div>
  );
}

function ReadinessBadge({
  status,
}: {
  status: ReturnType<typeof customStrategyReadiness>["status"];
}) {
  const { t } = useI18n();
  if (status === "executable") return <Badge>{t("strategyLab.executable")}</Badge>;
  return (
    <Badge variant="outline">
      {status === "data_required" ? t("strategyLab.needsData") : t("strategyLab.needsEngine")}
    </Badge>
  );
}

function BuilderPreview({ builder }: { builder: StrategyBuilderState }) {
  const { t } = useI18n();
  let draft: CustomStrategyInput | null = null;
  try {
    const base = {
      schemaVersion: 1 as const,
      id: "preview",
      name: builder.name || t("strategyLab.unnamedShort"),
      symbol: builder.symbol || "?",
    };
    if (builder.kind === "catalog_preset") {
      const definition = strategyDefinition(builder.strategyCode, "1.0.0");
      draft = {
        ...base,
        kind: "catalog_preset",
        strategyCode: definition.code,
        strategyVersion: definition.version,
        strategyParameters: builder.strategyParameters,
      };
    } else if (builder.kind === "scheduled_dca") {
      draft = {
        ...base,
        kind: "scheduled_dca",
        amount: builder.amount,
        currency: builder.currency,
        frequency: "monthly",
        dayOfMonth: builder.dayOfMonth,
      };
    } else if (builder.kind === "price_threshold") {
      draft = {
        ...base,
        kind: "price_threshold",
        operator: builder.priceOperator,
        value: builder.priceValue,
        currency: builder.currency,
        action: builder.action,
        sizePct: builder.sizePct,
      };
    } else {
      draft = {
        ...base,
        kind: "fundamental_threshold",
        metric: builder.metric,
        operator: builder.fundamentalOperator,
        value: builder.fundamentalValue,
        action: builder.action,
      };
    }
  } catch {
    draft = null;
  }
  const readiness = draft ? customStrategyReadiness(draft) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("strategyLab.normalizedRule")}</CardTitle>
        <CardDescription>{t("strategyLab.normalizedRuleDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {draft && readiness ? (
          <>
            <Alert>
              <CheckCircle2 />
              <AlertTitle>{builder.name || t("strategyLab.unnamed")}</AlertTitle>
              <AlertDescription>{describeCustomStrategy(draft)}</AlertDescription>
            </Alert>
            <div className="flex items-center gap-2">
              <ReadinessBadge status={readiness.status} />
              <span className="text-sm text-muted-foreground">{readiness.detail}</span>
            </div>
          </>
        ) : (
          <Alert>
            <AlertTitle>{t("strategyLab.invalidRule")}</AlertTitle>
            <AlertDescription>{t("strategyLab.invalidRuleDesc")}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function RuleFields({
  builder,
  setBuilder,
  selectedDefinition,
  onSelectCatalog,
}: {
  builder: StrategyBuilderState;
  setBuilder: React.Dispatch<React.SetStateAction<StrategyBuilderState>>;
  selectedDefinition: (typeof STRATEGY_CATALOG)[number];
  onSelectCatalog: (code: string) => void;
}) {
  const { t } = useI18n();
  if (builder.kind === "catalog_preset") {
    return (
      <>
        <Field>
          <FieldLabel htmlFor="catalog-rule">{t("strategyLab.technicalStrategy")}</FieldLabel>
          <Select value={builder.strategyCode} onValueChange={onSelectCatalog}>
            <SelectTrigger id="catalog-rule">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {STRATEGY_CATALOG.map((strategy) => (
                  <SelectItem key={strategy.code} value={strategy.code}>
                    {strategy.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          {selectedDefinition.parameterSchema.map((parameter) => (
            <Field key={parameter.name}>
              <FieldLabel htmlFor={`builder-${parameter.name}`}>{parameter.label}</FieldLabel>
              <Input
                id={`builder-${parameter.name}`}
                type="number"
                min={parameter.min}
                max={parameter.max}
                step={parameter.type === "integer" ? 1 : "any"}
                value={builder.strategyParameters[parameter.name] ?? parameter.default}
                onChange={(event) =>
                  setBuilder((current) => ({
                    ...current,
                    strategyParameters: {
                      ...current.strategyParameters,
                      [parameter.name]: Number(event.target.value),
                    },
                  }))
                }
              />
            </Field>
          ))}
        </div>
      </>
    );
  }
  if (builder.kind === "scheduled_dca") {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        <NumberField
          id="dca-amount"
          label={t("strategyLab.dcaAmount")}
          value={builder.amount}
          min={0.01}
          onChange={(amount) => setBuilder((current) => ({ ...current, amount }))}
        />
        <CurrencyField
          value={builder.currency}
          onChange={(currency) => setBuilder((current) => ({ ...current, currency }))}
        />
        <NumberField
          id="dca-day"
          label={t("strategyLab.dayOfMonth")}
          value={builder.dayOfMonth}
          min={1}
          max={28}
          onChange={(dayOfMonth) => setBuilder((current) => ({ ...current, dayOfMonth }))}
        />
      </div>
    );
  }
  if (builder.kind === "price_threshold") {
    return (
      <>
        <div className="grid gap-4 md:grid-cols-3">
          <SelectField
            id="price-action"
            label={t("strategyLab.action")}
            value={builder.action}
            options={[
              { value: "buy", label: t("common.buy") },
              { value: "sell", label: t("common.sell") },
            ]}
            onChange={(action) =>
              setBuilder((current) => ({ ...current, action: action as "buy" | "sell" }))
            }
          />
          <SelectField
            id="price-operator"
            label={t("strategyLab.whenPrice")}
            value={builder.priceOperator}
            options={[
              { value: "crosses_above", label: t("strategyLab.crossesAbove") },
              { value: "crosses_below", label: t("strategyLab.crossesBelow") },
            ]}
            onChange={(priceOperator) =>
              setBuilder((current) => ({
                ...current,
                priceOperator: priceOperator as StrategyBuilderState["priceOperator"],
              }))
            }
          />
          <NumberField
            id="price-value"
            label={t("strategyLab.priceLevel")}
            value={builder.priceValue}
            min={0.000001}
            onChange={(priceValue) => setBuilder((current) => ({ ...current, priceValue }))}
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <CurrencyField
            value={builder.currency}
            onChange={(currency) => setBuilder((current) => ({ ...current, currency }))}
          />
          <NumberField
            id="price-size"
            label={t("strategyLab.positionPct")}
            value={builder.sizePct}
            min={0.01}
            max={100}
            onChange={(sizePct) => setBuilder((current) => ({ ...current, sizePct }))}
          />
        </div>
      </>
    );
  }
  return (
    <>
      <Alert>
        <AlertTitle>{t("strategyLab.fundamentalNeedsData")}</AlertTitle>
        <AlertDescription>{t("strategyLab.fundamentalNeedsDataDesc")}</AlertDescription>
      </Alert>
      <div className="grid gap-4 md:grid-cols-3">
        <SelectField
          id="fundamental-metric"
          label={t("strategyLab.metric")}
          value={builder.metric}
          options={[
            { value: "pb", label: "P/B" },
            { value: "pe", label: "P/E" },
            { value: "roe", label: "ROE" },
          ]}
          onChange={(metric) =>
            setBuilder((current) => ({
              ...current,
              metric: metric as StrategyBuilderState["metric"],
            }))
          }
        />
        <SelectField
          id="fundamental-operator"
          label={t("strategyLab.condition")}
          value={builder.fundamentalOperator}
          options={[
            { value: "lt", label: t("strategyLab.lessThan") },
            { value: "lte", label: t("strategyLab.lessThanOrEqual") },
            { value: "gt", label: t("strategyLab.greaterThan") },
            { value: "gte", label: t("strategyLab.greaterThanOrEqual") },
          ]}
          onChange={(fundamentalOperator) =>
            setBuilder((current) => ({
              ...current,
              fundamentalOperator:
                fundamentalOperator as StrategyBuilderState["fundamentalOperator"],
            }))
          }
        />
        <NumberField
          id="fundamental-value"
          label={t("strategyLab.threshold")}
          value={builder.fundamentalValue}
          onChange={(fundamentalValue) =>
            setBuilder((current) => ({ ...current, fundamentalValue }))
          }
        />
      </div>
    </>
  );
}

function NumberField({
  id,
  label,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  );
}

function CurrencyField({
  value,
  onChange,
}: {
  value: "USD" | "VND";
  onChange: (value: "USD" | "VND") => void;
}) {
  const { t } = useI18n();
  return (
    <SelectField
      id="rule-currency"
      label={t("strategyLab.currency")}
      value={value}
      options={[
        { value: "USD", label: "USD" },
        { value: "VND", label: "VND" },
      ]}
      onChange={(currency) => onChange(currency as "USD" | "VND")}
    />
  );
}

function SelectField({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
