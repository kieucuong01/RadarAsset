import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireTenantContext: vi.fn(),
  requireTenantCapability: vi.fn(),
  loadBriefingEnvelope: vi.fn(),
  loadBriefingRefreshState: vi.fn(),
  enqueueBriefingRefresh: vi.fn(),
}));

vi.mock("@/lib/auth/tenant-context", () => ({
  requireTenantContext: mocks.requireTenantContext,
  requireTenantCapability: mocks.requireTenantCapability,
}));

vi.mock("@/lib/backend/smart-insights", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend/smart-insights")>()),
  loadBriefingEnvelope: mocks.loadBriefingEnvelope,
}));

vi.mock("@/lib/backend/smart-insights-refresh", () => ({
  loadBriefingRefreshState: mocks.loadBriefingRefreshState,
  enqueueBriefingRefresh: mocks.enqueueBriefingRefresh,
}));

import { GET, POST } from "./route";

const context = { userId: "user-a", organizationId: "org-a", role: "editor" as const };

describe("Smart Insights briefing lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireTenantContext.mockResolvedValue(context);
    mocks.loadBriefingEnvelope.mockResolvedValue(null);
    mocks.loadBriefingRefreshState.mockResolvedValue({
      state: "idle",
      requestedAt: null,
      finishedAt: null,
      errorCode: null,
    });
    mocks.enqueueBriefingRefresh.mockResolvedValue({ requestVersion: 1 });
  });

  it("returns 202 while the first briefing is generating", async () => {
    mocks.loadBriefingRefreshState.mockResolvedValue({
      state: "generating",
      requestedAt: "2026-08-15T04:00:00.000Z",
      finishedAt: null,
      errorCode: null,
    });

    const response = await GET(new Request("http://localhost/api/smart-insights/briefing"));

    expect(response.status).toBe(202);
    expect(response.headers.get("x-smart-insights-briefing-state")).toBe("generating");
    await expect(response.json()).resolves.toMatchObject({ state: "generating" });
  });

  it("returns a sanitized 503 when generation exhausted retries", async () => {
    mocks.loadBriefingRefreshState.mockResolvedValue({
      state: "failed",
      requestedAt: "2026-08-15T04:00:00.000Z",
      finishedAt: "2026-08-15T04:01:00.000Z",
      errorCode: "BRIEFING_GENERATION_FAILED",
    });

    const response = await GET(new Request("http://localhost/api/smart-insights/briefing"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      state: "failed",
      errorCode: "BRIEFING_GENERATION_FAILED",
    });
  });

  it("marks a published briefing ready without wrapping the existing contract", async () => {
    mocks.loadBriefingEnvelope.mockResolvedValue({
      fingerprint: "fingerprint-a",
      briefing: { id: "briefing-a", assetOpinions: [] },
    });

    const response = await GET(new Request("http://localhost/api/smart-insights/briefing"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-smart-insights-briefing-state")).toBe("ready");
    await expect(response.json()).resolves.toEqual({ id: "briefing-a", assetOpinions: [] });
  });

  it("queues a manual refresh behind research write authorization", async () => {
    const response = await POST();

    expect(response.status).toBe(202);
    expect(mocks.requireTenantCapability).toHaveBeenCalledWith(context, "research", "write");
    expect(mocks.enqueueBriefingRefresh).toHaveBeenCalledWith(context, "manual_refresh");
    await expect(response.json()).resolves.toMatchObject({ state: "generating" });
  });
});
