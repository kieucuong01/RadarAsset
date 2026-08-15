import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  getPrisma: () => ({ $transaction: mocks.transaction }),
}));

import { enqueueBriefingRefresh, loadBriefingRefreshState } from "./smart-insights-refresh";

const context = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  role: "editor" as const,
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "request-a",
    organizationId: context.organizationId,
    userId: context.userId,
    status: "queued",
    reason: "favorite_changed",
    requestVersion: 1,
    processingVersion: null,
    requestedAt: new Date("2026-08-15T01:00:00.000Z"),
    availableAt: new Date("2026-08-15T01:00:00.000Z"),
    startedAt: null,
    finishedAt: null,
    workerId: null,
    attemptCount: 0,
    errorCode: null,
    createdAt: new Date("2026-08-15T01:00:00.000Z"),
    updatedAt: new Date("2026-08-15T01:00:00.000Z"),
    ...overrides,
  };
}

describe("Smart Insights briefing refresh queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        $queryRaw: mocks.queryRaw,
        smartInsightRefreshRequest: {
          findUnique: mocks.findUnique,
          create: mocks.create,
          update: mocks.update,
        },
      }),
    );
  });

  it("creates the first tenant-scoped refresh at version one", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.create.mockResolvedValue(row());

    const result = await enqueueBriefingRefresh(context, "watchlist_saved");

    expect(result).toEqual({ state: "generating", requestVersion: 1, errorCode: null });
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: context.organizationId,
        userId: context.userId,
        status: "queued",
        reason: "watchlist_saved",
        requestVersion: 1,
      }),
    });
  });

  it("coalesces another queued request by incrementing the version", async () => {
    mocks.findUnique.mockResolvedValue(row({ requestVersion: 3 }));
    mocks.update.mockResolvedValue(row({ requestVersion: 4 }));

    const result = await enqueueBriefingRefresh(context, "portfolio_transaction");

    expect(result.requestVersion).toBe(4);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "request-a" },
      data: expect.objectContaining({
        status: "queued",
        reason: "portfolio_transaction",
        requestVersion: 4,
        processingVersion: null,
      }),
    });
  });

  it("preserves a running lease while recording a newer requested version", async () => {
    mocks.findUnique.mockResolvedValue(
      row({ status: "running", requestVersion: 2, processingVersion: 2 }),
    );
    mocks.update.mockResolvedValue(
      row({ status: "running", requestVersion: 3, processingVersion: 2 }),
    );

    const result = await enqueueBriefingRefresh(context, "watchlist_removed");

    expect(result).toEqual({ state: "generating", requestVersion: 3, errorCode: null });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "request-a" },
      data: expect.not.objectContaining({ status: "queued", processingVersion: null }),
    });
  });

  it.each([
    [null, { state: "idle", requestVersion: 0, errorCode: null }],
    [row({ status: "running" }), { state: "generating", requestVersion: 1, errorCode: null }],
    [
      row({ status: "failed", errorCode: "AI_PROVIDER_UNAVAILABLE" }),
      { state: "failed", requestVersion: 1, errorCode: "AI_PROVIDER_UNAVAILABLE" },
    ],
    [row({ status: "succeeded" }), { state: "ready", requestVersion: 1, errorCode: null }],
  ])("maps the persisted row to a sanitized public state", async (stored, expected) => {
    const findUnique = vi.fn().mockResolvedValue(stored);

    await expect(
      loadBriefingRefreshState(context, {
        smartInsightRefreshRequest: { findUnique },
      }),
    ).resolves.toEqual(expected);
  });
});
