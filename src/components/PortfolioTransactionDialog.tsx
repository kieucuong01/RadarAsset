"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { LoaderCircle, Plus } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type {
  PortfolioHoldingResponse,
  PortfolioResponse,
  PortfolioTimeframe,
} from "@/lib/backend/types";
import {
  buildExecutionDateRequest,
  buildTransactionPreview,
  formatTransactionPresetPrice,
  getTransactionValueError,
  isSellSelectionDisabled,
  toLocalDateInputValue,
} from "@/lib/portfolio-transaction-preview";
import { useI18n } from "@/lib/i18n/context";
import {
  defaultCurrency,
  formatMetricValue,
  formatMoney,
  formatPrice,
} from "@/lib/financial-format";
import { cn } from "@/lib/utils";

type AssetOption = {
  id: string;
  symbol: string;
  name: string;
  assetClass: string;
  currency: string;
};

type Side = "buy" | "sell";

export function PortfolioTransactionDialog({
  holdings,
  disabled,
  timeframe,
  onRecorded,
  preset,
  onSignalExecuted,
  triggerLabel,
  portfolioCurrency,
  open: controlledOpen,
  onOpenChange,
  trigger,
}: {
  holdings: PortfolioHoldingResponse[];
  disabled: boolean;
  timeframe: PortfolioTimeframe;
  onRecorded: (portfolio: PortfolioResponse) => void;
  preset?: {
    side: Side;
    symbol: string;
    price?: number | null;
    signalId?: string;
    assignmentId?: string;
  };
  onSignalExecuted?: (signalId: string) => void;
  triggerLabel?: string;
  portfolioCurrency?: string | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode | null;
}) {
  const { t, locale } = useI18n();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [saving, setSaving] = useState(false);
  const [assets, setAssets] = useState<AssetOption[] | null>(null);
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [side, setSide] = useState<Side>("buy");
  const [symbol, setSymbol] = useState("BTC");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("0");
  const [date, setDate] = useState(() => toLocalDateInputValue(new Date()));

  useEffect(() => {
    if (!open || !preset) return;
    setSide(preset.side);
    setSymbol(preset.symbol);
    setPrice(formatTransactionPresetPrice(preset.price));
    setQuantity((current) => current || "1");
    setFormError(null);
  }, [open, preset]);

  useEffect(() => {
    if (!open || assets !== null) return;
    const controller = new AbortController();

    void fetch("/api/assets", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(t("transactionsDialog.loadAssetsError"));
        return (await response.json()) as AssetOption[];
      })
      .then((items) => {
        setAssets(items);
        setAssetsError(null);
        setSymbol((currentSymbol) =>
          items.some((item) => item.symbol === currentSymbol)
            ? currentSymbol
            : (items[0]?.symbol ?? currentSymbol),
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setAssets([]);
        setAssetsError(
          error instanceof Error ? error.message : t("transactionsDialog.loadAssetsError"),
        );
      });

    return () => controller.abort();
  }, [assets, open, t]);

  const selectedHolding = holdings.find((holding) => holding.ticker === symbol) ?? null;
  const selectedAsset = assets?.find((asset) => asset.symbol === symbol) ?? null;
  const currency =
    selectedAsset?.currency?.trim() ||
    selectedHolding?.currency?.trim() ||
    portfolioCurrency?.trim() ||
    defaultCurrency(locale);
  const numericQuantity = Number(quantity);
  const numericPrice = Number(price);
  const numericFee = Number(fee);
  const today = toLocalDateInputValue(new Date());
  const isBackdated = Boolean(date && date < today);
  const valueError =
    quantity && price
      ? getTransactionValueError({
          quantity: numericQuantity,
          price: numericPrice,
          fee: numericFee,
        })
      : null;
  const preview =
    quantity && price
      ? buildTransactionPreview({
          side,
          quantity: numericQuantity,
          price: numericPrice,
          fee: numericFee,
          holding: selectedHolding
            ? { qty: selectedHolding.qty, cost: selectedHolding.cost }
            : null,
        })
      : null;
  const heldOptions: AssetOption[] = holdings.map((holding) => ({
    id: holding.assetId,
    symbol: holding.ticker,
    name: holding.name,
    assetClass: holding.category,
    currency: portfolioCurrency?.trim() || defaultCurrency(locale),
  }));
  const buyOptions: AssetOption[] = assets ?? heldOptions;
  const options: AssetOption[] = side === "buy" || isBackdated ? buyOptions : heldOptions;
  const backdatedTotal =
    side === "buy"
      ? numericQuantity * numericPrice + numericFee
      : numericQuantity * numericPrice - numericFee;
  const canSubmit = isBackdated
    ? Boolean(quantity && price && !valueError)
    : Boolean(preview?.valid);
  const previewError = preview && !preview.valid ? preview.error : null;
  const isInputInvalid = isBackdated ? Boolean(valueError) : Boolean(preview && !preview.valid);

  const handleSideChange = (nextSide: string) => {
    if (nextSide !== "buy" && nextSide !== "sell") return;
    setSide(nextSide);
    setFormError(null);
    const nextOptions: AssetOption[] = nextSide === "buy" || isBackdated ? buyOptions : heldOptions;
    const hasSelected = nextOptions.some((item) => item.symbol === symbol);
    if (!hasSelected && nextOptions[0]) {
      setSymbol(nextOptions[0].symbol);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (saving) return;
    if (controlledOpen === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
    if (!nextOpen) setFormError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      setFormError(valueError ?? previewError ?? t("transactionsDialog.validInput"));
      return;
    }
    if (!symbol || !date) {
      setFormError(t("transactionsDialog.selectAssetDate"));
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const response = await fetch("/api/portfolio/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol,
          type: side,
          quantity: numericQuantity,
          price: numericPrice,
          fee: numericFee,
          ...buildExecutionDateRequest(date, new Date().getTimezoneOffset()),
          timeframe,
          note: null,
          sourceSignalId: preset?.signalId,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? t("transactionsDialog.saveError"));
      }

      const portfolio = (await response.json()) as PortfolioResponse;
      onRecorded(portfolio);
      if (preset?.signalId) onSignalExecuted?.(preset.signalId);
      toast.success(
        t("transactionsDialog.toastSuccess", {
          side: side === "buy" ? t("common.buy") : t("common.sell"),
          quantity: numericQuantity,
          symbol,
        }),
      );
      setQuantity("");
      setPrice("");
      setFee("0");
      setDate(toLocalDateInputValue(new Date()));
      handleOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("transactionsDialog.saveError");
      setFormError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger === null ? null : (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button size="sm" disabled={disabled}>
              <Plus data-icon="inline-start" />
              {triggerLabel ??
                (preset ? t("transactionsDialog.reviewSignal") : t("transactionsDialog.add"))}
            </Button>
          )}
        </DialogTrigger>
      )}

      <DialogContent className="max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("transactionsDialog.title")}</DialogTitle>
          <DialogDescription>{t("transactionsDialog.description")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-5">
          <ToggleGroup
            type="single"
            value={side}
            onValueChange={handleSideChange}
            variant="outline"
            className="grid grid-cols-2"
            aria-label={t("transactionsDialog.sideAria")}
          >
            <ToggleGroupItem
              value="buy"
              className={cn("min-h-11", side === "buy" && "border-bull/40 text-bull")}
            >
              {t("common.buy")}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="sell"
              disabled={isSellSelectionDisabled({
                isBackdated,
                holdingsCount: holdings.length,
              })}
              className={cn("min-h-11", side === "sell" && "border-bear/40 text-bear")}
            >
              {t("common.sell")}
            </ToggleGroupItem>
          </ToggleGroup>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="tx-asset">{t("transactionsDialog.asset")}</Label>
              <select
                id="tx-asset"
                value={symbol}
                onChange={(event) => {
                  setSymbol(event.target.value);
                  setFormError(null);
                }}
                disabled={saving || options.length === 0}
                className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
              >
                {options.map((asset) => (
                  <option key={asset.id} value={asset.symbol}>
                    {asset.symbol} — {asset.name}
                  </option>
                ))}
              </select>
              {assetsError && side === "buy" ? (
                <p className="text-xs text-bear">
                  {assetsError} {t("transactionsDialog.showingHeld")}
                </p>
              ) : null}
              {side === "sell" && selectedHolding ? (
                <p className="text-xs text-muted-foreground">
                  {t("transactionsDialog.available")}:{" "}
                  {formatMetricValue(selectedHolding.qty, {
                    locale,
                    unit: selectedHolding.ticker,
                  })}{" "}
                  @ {t("transactionsDialog.averageCost")}{" "}
                  {formatPrice(selectedHolding.cost, {
                    locale,
                    currency,
                  })}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="tx-date">{t("transactionsDialog.executionDate")}</Label>
              <Input
                id="tx-date"
                type="date"
                value={date}
                max={today}
                onChange={(event) => {
                  const nextDate = event.target.value;
                  setDate(nextDate);
                  if (
                    side === "sell" &&
                    nextDate === today &&
                    !heldOptions.some((item) => item.symbol === symbol) &&
                    heldOptions[0]
                  ) {
                    setSymbol(heldOptions[0].symbol);
                  }
                  setFormError(null);
                }}
                disabled={saving}
                className="min-h-11"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="tx-quantity">{t("common.quantity")}</Label>
              <Input
                id="tx-quantity"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                disabled={saving}
                aria-invalid={isInputInvalid}
                placeholder="0.25"
                className="min-h-11"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="tx-price">{t("transactionsDialog.executionPrice")}</Label>
              <Input
                id="tx-price"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                disabled={saving}
                aria-invalid={isInputInvalid}
                placeholder={selectedHolding ? String(selectedHolding.price) : "67000"}
                className="min-h-11"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="tx-fee">
                {t("common.fee")} ({currency})
              </Label>
              <Input
                id="tx-fee"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={fee}
                onChange={(event) => setFee(event.target.value)}
                disabled={saving}
                aria-invalid={isInputInvalid}
                className="min-h-11"
              />
            </div>
          </div>

          {isBackdated && quantity && price && !valueError ? (
            <div className="flex flex-col gap-3">
              <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm">
                <PreviewRow
                  label={
                    side === "buy"
                      ? t("transactionsDialog.totalCost")
                      : t("transactionsDialog.netProceeds")
                  }
                  value={formatMoney(backdatedTotal, { locale, currency })}
                />
              </div>
              <Alert>
                <AlertDescription>{t("transactionsDialog.backdatedTrade")}</AlertDescription>
              </Alert>
            </div>
          ) : isBackdated && valueError ? (
            <Alert variant="destructive">
              <AlertDescription>{valueError}</AlertDescription>
            </Alert>
          ) : preview?.valid ? (
            <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-4 text-sm sm:grid-cols-2">
              <PreviewRow
                label={
                  side === "buy"
                    ? t("transactionsDialog.totalCost")
                    : t("transactionsDialog.netProceeds")
                }
                value={formatMoney(preview.total, { locale, currency })}
              />
              <PreviewRow
                label={t("transactionsDialog.projectedQuantity")}
                value={formatMetricValue(preview.projectedQuantity, { locale, unit: symbol })}
              />
              {side === "buy" ? (
                <PreviewRow
                  label={t("transactionsDialog.projectedAverageCost")}
                  value={formatPrice(preview.projectedAverageCost, { locale, currency })}
                />
              ) : (
                <PreviewRow
                  label={t("transactionsDialog.estimatedRealizedPnl")}
                  value={formatMoney(preview.realizedPnL, { locale, currency })}
                  tone={preview.realizedPnL >= 0 ? "bull" : "bear"}
                />
              )}
              {side === "sell" ? (
                <PreviewRow
                  label={t("transactionsDialog.remainingAverageCost")}
                  value={
                    preview.projectedQuantity === 0
                      ? t("transactionsDialog.positionClosed")
                      : formatPrice(preview.projectedAverageCost, { locale, currency })
                  }
                />
              ) : null}
            </div>
          ) : preview ? (
            <Alert variant="destructive">
              <AlertDescription>{preview.error}</AlertDescription>
            </Alert>
          ) : null}

          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={saving}
              className="min-h-11"
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={saving || !canSubmit} className="min-h-11">
              {saving ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
              {saving
                ? t("common.saving")
                : t("transactionsDialog.saveSide", {
                    side: side === "buy" ? t("common.buy") : t("common.sell"),
                  })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PreviewRow({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "bull" | "bear";
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "truncate font-semibold tabular-nums",
          tone === "bull" && "text-bull",
          tone === "bear" && "text-bear",
        )}
      >
        {value}
      </span>
    </div>
  );
}
