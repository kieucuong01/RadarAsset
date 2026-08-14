import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadCryptoMarketPulse: vi.fn(),
  requireTenantContext: vi.fn(),
  requireTenantCapability: vi.fn(),
}));

vi.mock("@/lib/backend/crypto-market-pulse", () => ({
  loadCryptoMarketPulse: mocks.loadCryptoMarketPulse,
}));

vi.mock("@/lib/auth/tenant-context", () => ({
  requireTenantContext: mocks.requireTenantContext,
  requireTenantCapability: mocks.requireTenantCapability,
}));

import { GET } from "./route";

const context = { userId: "user-a", organizationId: "org-a", role: "viewer" as const };
const payload = {
  generatedAt: "2026-08-14T12:00:00.000Z",
  fearGreed: {
    status: "unavailable",
    sourceCode: "alternative-fng",
    sourceUrl: "https://alternative.me/crypto/fear-and-greed-index/",
    latest: null,
    series: [],
  },
  etfFlows: { status: "unavailable", sourceCodes: [], series: [], summaries: [] },
  fundFlows: {
    status: "unavailable",
    sourceCode: "coinshares-weekly",
    sourceUrl: "https://coinshares.com/corp/resources/market-activity/",
    series: [],
    latestBreakdown: [],
  },
};

describe("GET /api/smart-insights/crypto-market-pulse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireTenantContext.mockResolvedValue(context);
    mocks.loadCryptoMarketPulse.mockResolvedValue(payload);
  });

  it("requires research read and returns the bounded read model", async () => {
    const response = await GET();

    expect(mocks.requireTenantCapability).toHaveBeenCalledWith(context, "research", "read");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(payload);
  });

  it("returns 503 when the read model is unavailable", async () => {
    mocks.loadCryptoMarketPulse.mockRejectedValue(new Error("Database unavailable"));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Database unavailable" });
  });
});
