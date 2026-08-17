export type TransactionPreviewInput = {
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fee: number;
  holding: { qty: number; cost: number } | null;
};

export function transactionCurrencyForAsset(input: { assetClass: string; currency: string }) {
  return input.currency.trim().toUpperCase() === "VND" || input.assetClass === "vn_equity"
    ? ("VND" as const)
    : ("USD" as const);
}

export type TransactionPreview =
  | { valid: false; error: string }
  | {
      valid: true;
      total: number;
      projectedQuantity: number;
      projectedAverageCost: number;
      realizedPnL: number;
    };

export function toLocalDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildExecutionDateRequest(executionDate: string, timezoneOffsetMinutes: number) {
  return { executionDate, timezoneOffsetMinutes };
}

export function isSellSelectionDisabled(input: { isBackdated: boolean; holdingsCount: number }) {
  return !input.isBackdated && input.holdingsCount === 0;
}

export function formatTransactionPresetPrice(price: number | null | undefined): string {
  return typeof price === "number" && Number.isFinite(price) && price > 0 ? String(price) : "";
}

export function getTransactionValueError(input: { quantity: number; price: number; fee: number }) {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return "Quantity must be greater than 0.";
  }
  if (!Number.isFinite(input.price) || input.price <= 0) {
    return "Price must be greater than 0.";
  }
  if (!Number.isFinite(input.fee) || input.fee < 0) {
    return "Fee cannot be negative.";
  }
  return null;
}

export function buildTransactionPreview(input: TransactionPreviewInput): TransactionPreview {
  const valueError = getTransactionValueError(input);
  if (valueError) return { valid: false, error: valueError };

  const grossAmount = input.quantity * input.price;
  if (input.side === "buy") {
    const currentQuantity = input.holding?.qty ?? 0;
    const currentCostBasis = currentQuantity * (input.holding?.cost ?? 0);
    const projectedQuantity = currentQuantity + input.quantity;
    const total = grossAmount + input.fee;
    return {
      valid: true,
      total,
      projectedQuantity,
      projectedAverageCost: (currentCostBasis + total) / projectedQuantity,
      realizedPnL: 0,
    };
  }

  if (!input.holding) {
    return { valid: false, error: "Select a currently held asset to sell." };
  }
  if (input.quantity > input.holding.qty) {
    return {
      valid: false,
      error: `Cannot sell ${input.quantity}; only ${input.holding.qty} is available.`,
    };
  }

  const projectedQuantity = input.holding.qty - input.quantity;
  const total = grossAmount - input.fee;
  return {
    valid: true,
    total,
    projectedQuantity,
    projectedAverageCost: projectedQuantity === 0 ? 0 : input.holding.cost,
    realizedPnL: total - input.quantity * input.holding.cost,
  };
}
