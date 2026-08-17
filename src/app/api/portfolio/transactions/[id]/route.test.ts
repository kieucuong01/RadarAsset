import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  remove: vi.fn(),
  tenant: vi.fn(),
  capability: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/backend/portfolio-repository", () => ({
  updatePortfolioTransaction: mocks.update,
  deletePortfolioTransaction: mocks.remove,
  normalizePortfolioTimeframe: () => "1M",
}));
vi.mock("@/lib/auth/tenant-context", () => ({
  requireTenantContext: mocks.tenant,
  requireTenantCapability: mocks.capability,
}));
vi.mock("@/lib/backend/smart-insights-refresh", () => ({
  enqueueBriefingRefresh: mocks.refresh,
}));

import { DELETE, PATCH } from "./route";

const id = "00000000-0000-4000-8000-000000000001";
const context = { userId: "user-a", organizationId: "org-a", role: "editor" as const };
const routeContext = { params: Promise.resolve({ id }) };

describe("portfolio transaction item API", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.tenant.mockResolvedValue(context);
    mocks.update.mockResolvedValue({ portfolioId: "portfolio-a" });
    mocks.remove.mockResolvedValue({ portfolioId: "portfolio-a" });
    mocks.refresh.mockResolvedValue({ requestVersion: 1 });
  });

  it("patches a tenant-scoped transaction with raw and reporting currency", async () => {
    const response = await PATCH(
      new Request(`http://localhost/api/portfolio/transactions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          symbol: "BTC",
          type: "buy",
          quantity: 1,
          price: 100,
          fee: 0,
          currency: "USD",
          reportingCurrency: "VND",
          executionDate: "2026-08-15",
          timezoneOffsetMinutes: -420,
        }),
      }),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      context,
      id,
      expect.objectContaining({ currency: "USD", reportingCurrency: "VND" }),
    );
  });

  it("deletes and returns the rebuilt portfolio", async () => {
    const response = await DELETE(
      new Request(
        `http://localhost/api/portfolio/transactions/${id}?timeframe=1M&currency=VND`,
        { method: "DELETE" },
      ),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith(context, id, "1M", "VND");
  });

  it("rejects malformed transaction ids", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/portfolio/transactions/nope", { method: "DELETE" }),
      { params: Promise.resolve({ id: "nope" }) },
    );
    expect(response.status).toBe(400);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("rejects an invalid reporting currency", async () => {
    const response = await DELETE(
      new Request(`http://localhost/api/portfolio/transactions/${id}?currency=EUR`, {
        method: "DELETE",
      }),
      routeContext,
    );
    expect(response.status).toBe(400);
  });
});
