import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthenticationRequiredError } from "@/lib/auth/errors";

const mocks = vi.hoisted(() => ({
  requireTenantContext: vi.fn(),
  requireTenantCapability: vi.fn(),
  loadBriefingDateCatalog: vi.fn(),
}));

vi.mock("@/lib/auth/tenant-context", () => ({
  requireTenantContext: mocks.requireTenantContext,
  requireTenantCapability: mocks.requireTenantCapability,
}));

vi.mock("@/lib/backend/smart-insights", () => ({
  loadBriefingDateCatalog: mocks.loadBriefingDateCatalog,
}));

import { GET } from "./route";

const context = { userId: "user-a", organizationId: "org-a", role: "editor" as const };

describe("Smart Insights briefing date catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireTenantContext.mockResolvedValue(context);
    mocks.loadBriefingDateCatalog.mockResolvedValue({
      today: "2026-08-17",
      dates: ["2026-08-16", "2026-08-15"],
    });
  });

  it("returns a private tenant-scoped date catalog", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      today: "2026-08-17",
      dates: ["2026-08-16", "2026-08-15"],
    });
    expect(mocks.requireTenantCapability).toHaveBeenCalledWith(context, "research", "read");
    expect(mocks.loadBriefingDateCatalog).toHaveBeenCalledWith(context);
  });

  it("requires an authenticated tenant member", async () => {
    mocks.requireTenantContext.mockRejectedValue(new AuthenticationRequiredError());

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.loadBriefingDateCatalog).not.toHaveBeenCalled();
  });
});
