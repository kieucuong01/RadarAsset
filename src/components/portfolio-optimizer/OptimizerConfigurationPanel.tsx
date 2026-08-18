import { Calculator, Info, Loader2, Pencil, Trash2, X } from "lucide-react";

import { QuantAssetPickerDialog } from "@/components/QuantAssetPickerDialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Slider } from "@/components/ui/slider";
import type { QuantAssetCatalogItem } from "@/lib/backtest/asset-client";
import {
  OPTIMIZER_METHODS,
  optimizerMethodTranslationKey,
  type OptimizerMethod,
} from "@/lib/backtest/optimizer-methods";
import { formatCount, formatNumber, formatRatio } from "@/lib/financial-format";
import { useI18n } from "@/lib/i18n/context";

type OptimizerConfigurationPanelProps = {
  timeframe: "1d";
  from: string;
  to: string;
  method: OptimizerMethod;
  targetReturnPct: number;
  targetVolatilityPct: number;
  markowitzRiskTolerance: number;
  maxWeightPct: number;
  selectedSymbols: string[];
  assets: QuantAssetCatalogItem[];
  loading: boolean;
  editingAssets: boolean;
  onTimeframeChange: (value: "1d") => void;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onMethodChange: (value: OptimizerMethod) => void;
  onTargetReturnChange: (value: number) => void;
  onTargetVolatilityChange: (value: number) => void;
  onRiskToleranceChange: (value: number) => void;
  onMaxWeightChange: (value: number) => void;
  onEditAssets: () => void;
  onAssetAdd: (asset: QuantAssetCatalogItem) => void;
  onAssetRemove: (symbol: string) => void;
  onOptimize: () => void;
};

export function OptimizerConfigurationPanel({
  timeframe,
  from,
  to,
  method,
  targetReturnPct,
  targetVolatilityPct,
  markowitzRiskTolerance,
  maxWeightPct,
  selectedSymbols,
  assets,
  loading,
  editingAssets,
  onTimeframeChange,
  onFromChange,
  onToChange,
  onMethodChange,
  onTargetReturnChange,
  onTargetVolatilityChange,
  onRiskToleranceChange,
  onMaxWeightChange,
  onEditAssets,
  onAssetAdd,
  onAssetRemove,
  onOptimize,
}: OptimizerConfigurationPanelProps) {
  const { t, locale } = useI18n();
  const assetBySymbol = new Map(assets.map((asset) => [asset.symbol, asset]));
  const symbolsToRender =
    selectedSymbols.length > 0 ? selectedSymbols : assets.map((asset) => asset.symbol);

  return (
    <Card className="h-fit lg:sticky lg:top-20">
      <CardHeader>
        <CardTitle>{t("optimizer.title")}</CardTitle>
        <CardDescription>{t("optimizer.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <Field>
              <FieldLabel htmlFor="optimizer-timeframe">{t("optimizer.timeframe")}</FieldLabel>
              <Select value={timeframe} onValueChange={onTimeframeChange}>
                <SelectTrigger id="optimizer-timeframe">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="1d">{t("optimizer.day")}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="optimizer-from">{t("optimizer.from")}</FieldLabel>
                <Input
                  id="optimizer-from"
                  type="date"
                  value={from}
                  onChange={(event) => onFromChange(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="optimizer-to">{t("optimizer.to")}</FieldLabel>
                <Input
                  id="optimizer-to"
                  type="date"
                  value={to}
                  onChange={(event) => onToChange(event.target.value)}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="optimizer-method">{t("optimizer.method")}</FieldLabel>
              <Select value={method} onValueChange={onMethodChange}>
                <SelectTrigger id="optimizer-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {OPTIMIZER_METHODS.map((item) => (
                      <SelectItem key={item} value={item}>
                        {t(optimizerMethodTranslationKey(item, "label"))}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                {t(optimizerMethodTranslationKey(method, "description"))}
              </FieldDescription>
            </Field>
            {method === "target_return" ? (
              <Field>
                <FieldLabel htmlFor="optimizer-target-return">
                  {t("optimizer.targetReturn", { value: formatNumber(targetReturnPct) })}
                </FieldLabel>
                <Input
                  id="optimizer-target-return"
                  type="number"
                  inputMode="decimal"
                  min={-100}
                  max={1000}
                  step={0.5}
                  value={targetReturnPct}
                  onChange={(event) => onTargetReturnChange(Number(event.target.value))}
                />
                <FieldDescription>{t("optimizer.targetReturnDescription")}</FieldDescription>
              </Field>
            ) : null}
            {method === "target_volatility" ? (
              <Field>
                <FieldLabel htmlFor="optimizer-target-volatility">
                  {t("optimizer.targetVolatility", {
                    value: formatNumber(targetVolatilityPct),
                  })}
                </FieldLabel>
                <Input
                  id="optimizer-target-volatility"
                  type="number"
                  inputMode="decimal"
                  min={0.1}
                  max={1000}
                  step={0.5}
                  value={targetVolatilityPct}
                  onChange={(event) => onTargetVolatilityChange(Number(event.target.value))}
                />
                <FieldDescription>{t("optimizer.targetVolatilityDescription")}</FieldDescription>
              </Field>
            ) : null}
            {method === "risk_tolerance" ? (
              <Field>
                <FieldLabel htmlFor="optimizer-risk-tolerance">
                  {t("optimizer.riskTolerance", {
                    value: formatRatio(markowitzRiskTolerance),
                  })}
                </FieldLabel>
                <Slider
                  value={[markowitzRiskTolerance]}
                  min={0.1}
                  max={10}
                  step={0.1}
                  onValueChange={([value]) => onRiskToleranceChange(value)}
                  aria-label={t("optimizer.riskToleranceAria")}
                />
                <FieldDescription>
                  {t(optimizerMethodTranslationKey(method, "description"))}
                </FieldDescription>
              </Field>
            ) : null}
            <Field>
              <FieldLabel>
                {t("optimizer.maxWeight", { value: formatNumber(maxWeightPct) })}
              </FieldLabel>
              <Slider
                value={[maxWeightPct]}
                min={10}
                max={100}
                step={5}
                onValueChange={([value]) => onMaxWeightChange(value)}
                aria-label={t("optimizer.maxWeightAria")}
              />
            </Field>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">
                {t("optimizer.assets", { count: formatCount(symbolsToRender.length) })}
              </span>
              <Button type="button" variant="outline" size="sm" onClick={onEditAssets}>
                {editingAssets ? (
                  <X data-icon="inline-start" />
                ) : (
                  <Pencil data-icon="inline-start" />
                )}
                {t(editingAssets ? "optimizer.closeAssetEditor" : "optimizer.editAssets")}
              </Button>
            </div>
            {editingAssets ? (
              <>
                <Alert className="bg-muted/30">
                  <Info />
                  <AlertTitle>{t("optimizer.assetEditGuideTitle")}</AlertTitle>
                  <AlertDescription>{t("optimizer.assetEditGuide")}</AlertDescription>
                </Alert>
                <QuantAssetPickerDialog
                  timeframe={timeframe}
                  from={from}
                  to={to}
                  selectedSymbols={symbolsToRender}
                  disabled={symbolsToRender.length >= 10}
                  onAdd={onAssetAdd}
                />
              </>
            ) : null}
            {symbolsToRender.map((symbol) => {
              const asset = assetBySymbol.get(symbol);
              return (
                <div
                  key={symbol}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold">{symbol}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {asset ? (
                        <>
                          {locale === "vi"
                            ? asset.market === "vn_equity"
                              ? "Chứng khoán Việt Nam"
                              : asset.market === "crypto_spot"
                                ? "Crypto giao ngay"
                                : asset.market === "metal_spot"
                                  ? "XAU/USD giao ngay"
                                  : asset.market
                            : asset.market}{" "}
                          · {formatCount(asset.rowCount)} {t("optimizer.bars")}
                        </>
                      ) : (
                        t("optimizer.assetPending")
                      )}
                    </span>
                  </span>
                  {editingAssets ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("optimizer.removeAsset", { symbol })}
                      onClick={() => onAssetRemove(symbol)}
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </FieldGroup>
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          disabled={loading || symbolsToRender.length === 0}
          onClick={onOptimize}
        >
          {loading ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : (
            <Calculator data-icon="inline-start" />
          )}
          {t("optimizer.run")}
        </Button>
      </CardFooter>
    </Card>
  );
}
