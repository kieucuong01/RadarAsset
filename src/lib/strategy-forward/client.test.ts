import { describe, expect, it, vi } from "vitest";
import {
  getNotifications,
  getStrategyForwardTests,
  updateStrategySignalStatusClient,
} from "./client";

describe("strategy-forward client", () => {
  it("parses bounded strict forward responses", async () => {
    const response = {
      assignmentId: "assignment-a",
      portfolioId: "portfolio-a",
      symbol: "BTC",
      currency: "USDT",
      strategy: { code: "threshold", version: "1.0.0", name: "Threshold", kind: "custom_rule" },
      status: "active",
      activatedAt: "2026-08-01T00:00:00.000Z",
      lastEvaluatedAt: null,
      lastEvaluatedBarAt: null,
      latestSignal: null,
      backtestBaseline: null,
      snapshots: [],
    };
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => [response] });
    await expect(getStrategyForwardTests(fetcher)).resolves.toEqual([response]);
    expect(fetcher).toHaveBeenCalledWith("/api/portfolio/strategy-forward-tests", {
      cache: "no-store",
    });
  });

  it("rejects malformed notifications", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], nextCursor: null, unreadCount: -1 }),
    });
    await expect(getNotifications(fetcher)).rejects.toThrow();
  });

  it("persists reviewed and dismissed signal decisions", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });

    await updateStrategySignalStatusClient("assignment-a", "signal-a", "dismissed", fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      "/api/portfolio/strategy-assignments/assignment-a/signals/signal-a",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "dismissed" }) }),
    );
  });
});
