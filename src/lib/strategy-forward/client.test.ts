import { describe, expect, it, vi } from "vitest";
import { getNotifications, getStrategyForwardTests } from "./client";

describe("strategy-forward client", () => {
  it("parses bounded strict forward responses", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    await expect(getStrategyForwardTests(fetcher)).resolves.toEqual([]);
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
});
