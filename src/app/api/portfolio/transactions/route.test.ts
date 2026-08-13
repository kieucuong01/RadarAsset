import { beforeEach, describe, expect, it, vi } from "vitest";

import { PortfolioDomainError, PortfolioInputError } from "@/lib/backend/portfolio";

const mocks = vi.hoisted(() => ({
  createPortfolioTransaction: vi.fn(),
  requireTenantContext: vi.fn(),
  requireTenantCapability: vi.fn(),
}));

vi.mock("@/lib/backend/db", () => ({
  createPortfolioTransaction: mocks.createPortfolioTransaction,
}));

vi.mock("@/lib/auth/tenant-context", () => ({
  requireTenantContext: mocks.requireTenantContext,
  requireTenantCapability: mocks.requireTenantCapability,
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

function rawRequest(body: string) {
  return new Request("http://localhost/api/portfolio/transactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("POST /api/portfolio/transactions", () => {
  const editorContext = {
    userId: "user-a",
    organizationId: "org-a",
    role: "editor" as const,
  };

  beforeEach(() => {
    vi.useRealTimers();
    mocks.createPortfolioTransaction.mockReset();
    mocks.createPortfolioTransaction.mockResolvedValue({ portfolioId: "portfolio-demo" });
    mocks.requireTenantContext.mockReset();
    mocks.requireTenantContext.mockResolvedValue(editorContext);
    mocks.requireTenantCapability.mockReset();
  });

  it("returns 400 and skips persistence for a future execution timestamp", async () => {
    const response = await POST(request({ executedAt: "2099-01-01T00:00:00.000Z" }));

    expect(response.status).toBe(400);
    expect(mocks.createPortfolioTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    const response = await POST(rawRequest("{"));

    expect(response.status).toBe(400);
    expect(mocks.createPortfolioTransaction).not.toHaveBeenCalled();
  });

  it("accepts the user's current local calendar date before UTC catches up", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T18:00:00.000Z"));

    const response = await POST(
      request({
        executionDate: "2026-08-09",
        timezoneOffsetMinutes: -420,
        timeframe: "1Y",
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.createPortfolioTransaction).toHaveBeenCalledWith(
      editorContext,
      expect.objectContaining({
        executedAt: "2026-08-09T12:00:00.000Z",
        timeframe: "1Y",
      }),
    );
  });

  it("accepts a source signal id for atomic signal-linked execution", async () => {
    const response = await POST(
      request({ sourceSignalId: "00000000-0000-4000-8000-000000000009" }),
    );

    expect(response.status).toBe(201);
    expect(mocks.createPortfolioTransaction).toHaveBeenCalledWith(
      editorContext,
      expect.objectContaining({ sourceSignalId: "00000000-0000-4000-8000-000000000009" }),
    );
  });

  it("rejects a calendar date after the user's local today", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T18:00:00.000Z"));

    const response = await POST(
      request({ executionDate: "2026-08-10", timezoneOffsetMinutes: -420 }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createPortfolioTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid calendar date", async () => {
    const response = await POST(
      request({ executionDate: "2026-99-99", timezoneOffsetMinutes: -420 }),
    );

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

  it("returns 404 for an unknown asset symbol", async () => {
    mocks.createPortfolioTransaction.mockRejectedValue(
      new PortfolioInputError("Asset NOPE not found.", "ASSET_NOT_FOUND"),
    );

    const response = await POST(request({ symbol: "NOPE" }));

    expect(response.status).toBe(404);
  });

  it("returns 503 for an unexpected persistence failure", async () => {
    mocks.createPortfolioTransaction.mockRejectedValue(new Error("Database unavailable"));

    const response = await POST(request({}));

    expect(response.status).toBe(503);
  });

  it("does not misclassify a backend SyntaxError as malformed JSON", async () => {
    mocks.createPortfolioTransaction.mockRejectedValue(new SyntaxError("Unexpected backend data"));

    const response = await POST(request({}));

    expect(response.status).toBe(503);
  });

  it("returns the refreshed portfolio with status 201", async () => {
    const response = await POST(request({}));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ portfolioId: "portfolio-demo" });
  });
});
