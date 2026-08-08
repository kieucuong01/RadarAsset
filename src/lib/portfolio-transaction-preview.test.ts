import { describe, expect, it } from "vitest";

import { buildTransactionPreview } from "./portfolio-transaction-preview";

describe("portfolio transaction preview", () => {
  it("projects quantity, total cost, and weighted average for a Buy", () => {
    const preview = buildTransactionPreview({
      side: "buy",
      quantity: 0.5,
      price: 70000,
      fee: 10,
      holding: { qty: 1, cost: 50000 },
    });

    expect(preview).toMatchObject({
      valid: true,
      total: 35010,
      projectedQuantity: 1.5,
      realizedPnL: 0,
    });
    expect(preview.valid && preview.projectedAverageCost).toBeCloseTo(56673.333333333336, 8);
  });

  it("projects net proceeds, realized PnL, and remaining quantity for a Sell", () => {
    const preview = buildTransactionPreview({
      side: "sell",
      quantity: 0.5,
      price: 130,
      fee: 2,
      holding: { qty: 2, cost: 100 },
    });

    expect(preview).toEqual({
      valid: true,
      total: 63,
      projectedQuantity: 1.5,
      projectedAverageCost: 100,
      realizedPnL: 13,
    });
  });

  it("rejects a Sell without a holding and an oversell", () => {
    expect(
      buildTransactionPreview({
        side: "sell",
        quantity: 1,
        price: 100,
        fee: 0,
        holding: null,
      }),
    ).toEqual({ valid: false, error: "Select a currently held asset to sell." });

    expect(
      buildTransactionPreview({
        side: "sell",
        quantity: 3,
        price: 100,
        fee: 0,
        holding: { qty: 2, cost: 100 },
      }),
    ).toEqual({ valid: false, error: "Cannot sell 3; only 2 is available." });
  });

  it("rejects invalid quantity, price, and fee values", () => {
    expect(
      buildTransactionPreview({
        side: "buy",
        quantity: 0,
        price: 100,
        fee: 0,
        holding: null,
      }),
    ).toEqual({ valid: false, error: "Quantity must be greater than 0." });

    expect(
      buildTransactionPreview({
        side: "buy",
        quantity: 1,
        price: Number.NaN,
        fee: 0,
        holding: null,
      }),
    ).toEqual({ valid: false, error: "Price must be greater than 0." });

    expect(
      buildTransactionPreview({
        side: "buy",
        quantity: 1,
        price: 100,
        fee: -1,
        holding: null,
      }),
    ).toEqual({ valid: false, error: "Fee cannot be negative." });
  });
});
