import { beforeEach, describe, expect, it, vi } from "vitest";

import { PortfolioDomainError } from "@/lib/backend/portfolio";

const mocks = vi.hoisted(() => ({
  createPortfolioTransaction: vi.fn(),
}));

vi.mock("@/lib/backend/db", () => ({
  createPortfolioTransaction: mocks.createPortfolioTransaction,
}));

import { POST } from "./route";

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/portfolio/transactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      symbol: "BTC",
      type: "buy",
      quantity: 1,
      price: 100,
      fee: 0,
      ...body,
    }),
  });
}

describe("POST /api/portfolio/transactions", () => {
  beforeEach(() => {
    mocks.createPortfolioTransaction.mockReset();
    mocks.createPortfolioTransaction.mockResolvedValue({ portfolioId: "portfolio-demo" });
  });

  it("returns 400 and skips persistence for a future execution timestamp", async () => {
    const response = await POST(request({ executedAt: "2099-01-01T00:00:00.000Z" }));

    expect(response.status).toBe(400);
    expect(mocks.createPortfolioTransaction).not.toHaveBeenCalled();
  });

  it("returns 409 for a domain conflict", async () => {
    mocks.createPortfolioTransaction.mockRejectedValue(
      new PortfolioDomainError(
        "Cannot sell 2 BTC; only 1 is available at this transaction time.",
        "INSUFFICIENT_QUANTITY",
      ),
    );

    const response = await POST(request({ type: "sell", quantity: 2 }));
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(payload.error).toContain("only 1 is available");
  });

  it("returns 503 for an unexpected persistence failure", async () => {
    mocks.createPortfolioTransaction.mockRejectedValue(new Error("Database unavailable"));

    const response = await POST(request({}));

    expect(response.status).toBe(503);
  });

  it("returns the refreshed portfolio with status 201", async () => {
    const response = await POST(request({}));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ portfolioId: "portfolio-demo" });
  });
});
