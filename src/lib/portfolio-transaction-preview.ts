export type TransactionPreviewInput = {
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fee: number;
  holding: { qty: number; cost: number } | null;
};

export type TransactionPreview =
  | { valid: false; error: string }
  | {
      valid: true;
      total: number;
      projectedQuantity: number;
      projectedAverageCost: number;
      realizedPnL: number;
    };

export function buildTransactionPreview(input: TransactionPreviewInput): TransactionPreview {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return { valid: false, error: "Quantity must be greater than 0." };
  }
  if (!Number.isFinite(input.price) || input.price <= 0) {
    return { valid: false, error: "Price must be greater than 0." };
  }
  if (!Number.isFinite(input.fee) || input.fee < 0) {
    return { valid: false, error: "Fee cannot be negative." };
  }

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
