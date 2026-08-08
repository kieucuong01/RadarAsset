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
import type { PortfolioHoldingResponse, PortfolioResponse } from "@/lib/backend/types";
import { buildTransactionPreview } from "@/lib/portfolio-transaction-preview";
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
  onRecorded,
}: {
  holdings: PortfolioHoldingResponse[];
  disabled: boolean;
  onRecorded: (portfolio: PortfolioResponse) => void;
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
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

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
  const options: AssetOption[] = side === "buy" ? buyOptions : heldOptions;

  const handleSideChange = (nextSide: string) => {
    if (nextSide !== "buy" && nextSide !== "sell") return;
    setSide(nextSide);
    setFormError(null);
    const nextOptions: AssetOption[] = nextSide === "buy" ? buyOptions : heldOptions;
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
    if (!preview?.valid) {
      setFormError(preview?.error ?? "Enter a valid quantity and execution price.");
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
          executedAt: `${date}T00:00:00.000Z`,
          note: null,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Unable to save transaction.");
      }

      const portfolio = (await response.json()) as PortfolioResponse;
      onRecorded(portfolio);
      toast.success(
        `${side === "buy" ? "Bought" : "Sold"} ${numericQuantity} ${symbol} successfully.`,
      );
      setQuantity("");
      setPrice("");
      setFee("0");
      setDate(new Date().toISOString().slice(0, 10));
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
        Add Transaction
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
              disabled={holdings.length === 0}
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
                max={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setDate(event.target.value)}
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
                aria-invalid={Boolean(preview && !preview.valid)}
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
                aria-invalid={Boolean(preview && !preview.valid)}
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
                aria-invalid={Boolean(preview && !preview.valid)}
                className="min-h-11"
              />
            </div>
          </div>

          {preview?.valid ? (
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
            <Button type="submit" disabled={saving || !preview?.valid} className="min-h-11">
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
