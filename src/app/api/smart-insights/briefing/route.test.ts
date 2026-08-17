import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthenticationRequiredError } from "@/lib/auth/errors";

const mocks = vi.hoisted(() => ({
  requireTenantContext: vi.fn(),
  requireTenantCapability: vi.fn(),
  resolvePublicMarketTenantContext: vi.fn(),
  loadBriefingEnvelope: vi.fn(),
  loadBriefingRefreshState: vi.fn(),
  enqueueBriefingRefresh: vi.fn(),
}));

vi.mock("@/lib/auth/tenant-context", () => ({
  requireTenantContext: mocks.requireTenantContext,
  requireTenantCapability: mocks.requireTenantCapability,
  resolvePublicMarketTenantContext: mocks.resolvePublicMarketTenantContext,
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
const publicContext = {
  userId: "public-user",
  organizationId: "public-org",
  role: "viewer" as const,
};

describe("Smart Insights briefing lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireTenantContext.mockResolvedValue(context);
    mocks.resolvePublicMarketTenantContext.mockResolvedValue(publicContext);
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

  it("does not project today's queued refresh onto a missing historical date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T05:00:00.000Z"));
    mocks.loadBriefingRefreshState.mockResolvedValue({
      state: "generating",
      requestedAt: "2026-08-17T04:00:00.000Z",
      finishedAt: null,
      errorCode: null,
    });

    try {
      const response = await GET(
        new Request("http://localhost/api/smart-insights/briefing?date=2026-08-15"),
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        state: "idle",
        errorCode: "BRIEFING_NOT_GENERATED_FOR_DATE",
      });
      expect(mocks.loadBriefingRefreshState).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the queued lifecycle for an exact missing today briefing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T05:00:00.000Z"));
    mocks.loadBriefingRefreshState.mockResolvedValue({
      state: "generating",
      requestedAt: "2026-08-17T04:00:00.000Z",
      finishedAt: null,
      errorCode: null,
    });

    try {
      const response = await GET(
        new Request("http://localhost/api/smart-insights/briefing?date=2026-08-17"),
      );

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toMatchObject({ state: "generating" });
    } finally {
      vi.useRealTimers();
    }
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
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ id: "briefing-a", assetOpinions: [] });
  });

  it("serves the public market briefing to guests without requiring tenant permission", async () => {
    mocks.requireTenantContext.mockRejectedValue(new AuthenticationRequiredError());
    mocks.loadBriefingEnvelope.mockResolvedValue({
      fingerprint: "public-fingerprint",
      briefing: {
        id: "public-briefing",
        assetOpinions: [{ symbol: "BTC" }, { symbol: "XAU" }, { symbol: "VNINDEX" }],
      },
    });

    const response = await GET(new Request("http://localhost/api/smart-insights/briefing"));

    expect(response.status).toBe(200);
    expect(mocks.resolvePublicMarketTenantContext).toHaveBeenCalledOnce();
    expect(mocks.loadBriefingEnvelope).toHaveBeenCalledWith(publicContext, null);
    expect(mocks.requireTenantCapability).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      id: "public-briefing",
      assetOpinions: [{ symbol: "BTC" }, { symbol: "XAU" }, { symbol: "VNINDEX" }],
    });
  });

  it("does not return 304 because derived opinion changes can update independently", async () => {
    mocks.loadBriefingEnvelope.mockResolvedValue({
      fingerprint: "fingerprint-a",
      briefing: { id: "briefing-a", portfolioChangesStatus: "ready" },
    });

    const response = await GET(
      new Request("http://localhost/api/smart-insights/briefing", {
        headers: { "if-none-match": '"fingerprint-a"' },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ portfolioChangesStatus: "ready" });
  });

  it("queues a manual refresh behind research write authorization", async () => {
    const response = await POST();

    expect(response.status).toBe(202);
    expect(mocks.requireTenantCapability).toHaveBeenCalledWith(context, "research", "write");
    expect(mocks.enqueueBriefingRefresh).toHaveBeenCalledWith(context, "manual_refresh");
    await expect(response.json()).resolves.toMatchObject({ state: "generating" });
  });
});
