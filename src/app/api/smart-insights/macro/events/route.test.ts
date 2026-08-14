import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loader: vi.fn(),
  requireTenantContext: vi.fn(),
  requireTenantCapability: vi.fn(),
}));
vi.mock("@/lib/backend/smart-insights-macro", () => ({ loadMacroEventRisk: mocks.loader }));
vi.mock("@/lib/auth/tenant-context", () => ({
  requireTenantContext: mocks.requireTenantContext,
  requireTenantCapability: mocks.requireTenantCapability,
}));

import { GET } from "./route";

const context = { userId: "user-a", organizationId: "org-a", role: "viewer" as const };

describe("GET /api/smart-insights/macro/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireTenantContext.mockResolvedValue(context);
    mocks.loader.mockResolvedValue({ status: "UNAVAILABLE", score: null, events: [] });
  });

  it("requires research read and forwards a bounded window", async () => {
    const response = await GET(
      new Request("http://localhost/api/smart-insights/macro/events?from=2026-08-01&to=2026-08-14"),
    );
    expect(response.status).toBe(200);
    expect(mocks.requireTenantCapability).toHaveBeenCalledWith(context, "research", "read");
    expect(mocks.loader).toHaveBeenCalledOnce();
  });

  it("rejects windows over 31 days", async () => {
    const response = await GET(
      new Request("http://localhost/api/smart-insights/macro/events?from=2026-01-01&to=2026-08-14"),
    );
    expect(response.status).toBe(400);
    expect(mocks.loader).not.toHaveBeenCalled();
  });
});
