import { describe, expect, it, vi } from "vitest";

import { rebuildPortfolioPositions } from "./portfolio-repository";

function asset(symbol: string) {
  return {
    id: `asset-${symbol.toLowerCase()}`,
    symbol,
    name: symbol,
    assetClass: symbol === "BTC" ? "crypto" : "equity",
    currency: symbol === "BTC" ? "USD" : "VND",
  };
}

function row(overrides: Record<string, unknown>) {
  const rowAsset = asset("BTC");
  return {
    id: "tx-1",
    portfolioId: "portfolio-a",
    assetId: rowAsset.id,
    sourceSignalId: null,
    type: "buy",
    quantity: 1,
    price: 100,
    fee: 0,
    currency: "USD",
    fxRateToVnd: 26_000,
    fxEffectiveDate: new Date("2026-08-14T00:00:00.000Z"),
    fxSource: "vietcombank",
    fxFallback: false,
    note: null,
    executedAt: new Date("2026-08-15T00:00:00.000Z"),
    createdAt: new Date("2026-08-15T00:00:00.000Z"),
    asset: rowAsset,
    ...overrides,
  };
}

describe("portfolio repository replay", () => {
  it("normalizes USD and VND trades into one persisted VND position ledger", async () => {
    const fpt = asset("FPT");
    const tx = {
      portfolioTransaction: {
        findMany: vi.fn().mockResolvedValue([
          row({}),
          row({
            id: "tx-2",
            assetId: fpt.id,
            asset: fpt,
            price: 2_600_000,
            currency: "VND",
          }),
        ]),
      },
      portfolioPosition: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };

    await rebuildPortfolioPositions(tx as never, "portfolio-a");

    expect(tx.portfolioPosition.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ assetId: "asset-btc", averageCost: 2_600_000 }),
        expect.objectContaining({ assetId: "asset-fpt", averageCost: 2_600_000 }),
      ]),
    });
  });

  it("fails before replacing positions when replay exposes an invalid later sell", async () => {
    const tx = {
      portfolioTransaction: {
        findMany: vi.fn().mockResolvedValue([row({ type: "sell" })]),
      },
      portfolioPosition: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
    };

    await expect(rebuildPortfolioPositions(tx as never, "portfolio-a")).rejects.toThrow(
      "Cannot sell",
    );
    expect(tx.portfolioPosition.deleteMany).not.toHaveBeenCalled();
  });
});
