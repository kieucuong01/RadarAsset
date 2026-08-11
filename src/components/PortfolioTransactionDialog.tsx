"use client";

import { useEffect, useState, type FormEvent } from "react";
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
  getTransactionValueError,
  isSellSelectionDisabled,
  toLocalDateInputValue,
} from "@/lib/portfolio-transaction-preview";
import { cn } from "@/lib/utils";

type AssetOption = {
  id: string;
  symbol: string;
  name: string;
  assetClass: string;
  currency: string;
};

type Side = "buy" | "sell";

function formatCurrency(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function PortfolioTransactionDialog({
  holdings,
  disabled,
  timeframe,
  onRecorded,
  preset,
  onSignalExecuted,
}: {
  holdings: PortfolioHoldingResponse[];
  disabled: boolean;
  timeframe: PortfolioTimeframe;
  onRecorded: (portfolio: PortfolioResponse) => void;
  preset?: { side: Side; symbol: string; price: number; signalId: string; assignmentId: string };
  onSignalExecuted?: (signalId: string) => void;
}) {
  const [open, setOpen] = useState(false);
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
    setPrice(String(preset.price));
    setQuantity((current) => current || "1");
    setFormError(null);
  }, [open, preset]);

  useEffect(() => {
    if (!open || assets !== null) return;
    const controller = new AbortController();

    void fetch("/api/assets", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load supported assets.");
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
        setAssetsError(error instanceof Error ? error.message : "Unable to load supported assets.");
      });

    return () => controller.abort();
  }, [assets, open]);

  const selectedHolding = holdings.find((holding) => holding.ticker === symbol) ?? null;
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
    currency: "USD",
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
    setOpen(nextOpen);
    if (!nextOpen) setFormError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      setFormError(valueError ?? previewError ?? "Enter a valid quantity and execution price.");
      return;
    }
    if (!symbol || !date) {
      setFormError("Select an asset and execution date.");
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
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Unable to save transaction.");
      }

      const portfolio = (await response.json()) as PortfolioResponse;
      onRecorded(portfolio);
      if (preset?.signalId) {
        const signalResponse = await fetch(
          `/api/portfolio/strategy-assignments/${preset.assignmentId}/signals/${preset.signalId}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ status: "executed" }),
          },
        );
        if (signalResponse.ok) onSignalExecuted?.(preset.signalId);
      }
      toast.success(
        `${side === "buy" ? "Bought" : "Sold"} ${numericQuantity} ${symbol} successfully.`,
      );
      setQuantity("");
      setPrice("");
      setFee("0");
      setDate(toLocalDateInputValue(new Date()));
      setOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save transaction.";
      setFormError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button size="sm" onClick={() => setOpen(true)} disabled={disabled}>
        <Plus data-icon="inline-start" />
        {preset ? "Review signal" : "Add Transaction"}
      </Button>

      <DialogContent className="max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add Transaction</DialogTitle>
          <DialogDescription>
            Record a manual Buy or Sell. This tracker does not manage a cash balance.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-5">
          <ToggleGroup
            type="single"
            value={side}
            onValueChange={handleSideChange}
            variant="outline"
            className="grid grid-cols-2"
            aria-label="Transaction side"
          >
            <ToggleGroupItem
              value="buy"
              className={cn("min-h-11", side === "buy" && "border-bull/40 text-bull")}
            >
              Buy
            </ToggleGroupItem>
            <ToggleGroupItem
              value="sell"
              disabled={isSellSelectionDisabled({
                isBackdated,
                holdingsCount: holdings.length,
              })}
              className={cn("min-h-11", side === "sell" && "border-bear/40 text-bear")}
            >
              Sell
            </ToggleGroupItem>
          </ToggleGroup>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="tx-asset">Asset</Label>
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
                <p className="text-xs text-bear">{assetsError} Showing currently held assets.</p>
              ) : null}
              {side === "sell" && selectedHolding ? (
                <p className="text-xs text-muted-foreground">
                  Available: {selectedHolding.qty.toLocaleString()} at average cost{" "}
                  {formatCurrency(selectedHolding.cost)}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="tx-date">Execution date</Label>
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
              <Label htmlFor="tx-quantity">Quantity</Label>
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
              <Label htmlFor="tx-price">Execution price (USD)</Label>
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
              <Label htmlFor="tx-fee">Fee (USD)</Label>
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
                  label={side === "buy" ? "Total cost" : "Net proceeds"}
                  value={formatCurrency(backdatedTotal)}
                />
              </div>
              <Alert>
                <AlertDescription>
                  Backdated trade: final quantity, average cost and realized PnL will be replayed
                  from the full ledger after saving.
                </AlertDescription>
              </Alert>
            </div>
          ) : isBackdated && valueError ? (
            <Alert variant="destructive">
              <AlertDescription>{valueError}</AlertDescription>
            </Alert>
          ) : preview?.valid ? (
            <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-4 text-sm sm:grid-cols-2">
              <PreviewRow
                label={side === "buy" ? "Total cost" : "Net proceeds"}
                value={formatCurrency(preview.total)}
              />
              <PreviewRow
                label="Projected quantity"
                value={preview.projectedQuantity.toLocaleString("en-US", {
                  maximumFractionDigits: 8,
                })}
              />
              {side === "buy" ? (
                <PreviewRow
                  label="Projected average cost"
                  value={formatCurrency(preview.projectedAverageCost)}
                />
              ) : (
                <PreviewRow
                  label="Estimated realized PnL"
                  value={formatCurrency(preview.realizedPnL)}
                  tone={preview.realizedPnL >= 0 ? "bull" : "bear"}
                />
              )}
              {side === "sell" ? (
                <PreviewRow
                  label="Remaining average cost"
                  value={
                    preview.projectedQuantity === 0
                      ? "Position closed"
                      : formatCurrency(preview.projectedAverageCost)
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
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !canSubmit} className="min-h-11">
              {saving ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
              {saving ? "Saving…" : `Save ${side === "buy" ? "Buy" : "Sell"}`}
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
