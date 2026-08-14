import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loader: vi.fn(),
  requireTenantContext: vi.fn(),
  requireTenantCapability: vi.fn(),
}));
vi.mock("@/lib/backend/smart-insights-macro", () => ({ loadEnergyPulse: mocks.loader }));
vi.mock("@/lib/auth/tenant-context", () => ({
  requireTenantContext: mocks.requireTenantContext,
  requireTenantCapability: mocks.requireTenantCapability,
}));

import { GET } from "./route";

const context = { userId: "user-a", organizationId: "org-a", role: "viewer" as const };

describe("GET /api/smart-insights/macro/energy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireTenantContext.mockResolvedValue(context);
    mocks.loader.mockResolvedValue({ status: "UNAVAILABLE", cards: [], priceSeries: [] });
  });

  it("requires research read and returns the loader response", async () => {
    const response = await GET(new Request("http://localhost/api/smart-insights/macro/energy"));
    expect(response.status).toBe(200);
    expect(mocks.requireTenantCapability).toHaveBeenCalledWith(context, "research", "read");
    expect(mocks.loader).toHaveBeenCalledOnce();
  });
});
