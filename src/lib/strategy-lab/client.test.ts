import { describe, expect, it, vi } from "vitest";

import {
  archiveCustomStrategy,
  createCustomStrategy,
  createCustomStrategyVersion,
  listCustomStrategies,
} from "./client";

const strategy = {
  id: "strategy-a",
  name: "BTC DCA",
  description: null,
  family: "systematic",
  status: "active",
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z",
  versions: [
    {
      id: "version-a",
      version: "1.0.0",
      kind: "scheduled_dca",
      rule: {
        schemaVersion: 1,
        kind: "scheduled_dca",
        contributionAmount: 400,
        currency: "USD",
        frequency: "monthly",
        dayOfMonth: 1,
      },
      implementationHash: "a".repeat(64),
      status: "active",
      executionCode: "custom:version-a",
      createdAt: "2026-08-14T00:00:00.000Z",
    },
  ],
} as const;

describe("Strategy Lab API client", () => {
  it("loads strict tenant strategies without caching", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => [strategy] });
    await expect(listCustomStrategies(fetcher)).resolves.toHaveLength(1);
    expect(fetcher).toHaveBeenCalledWith("/api/quant/custom-strategies", { cache: "no-store" });
  });

  it("creates strategies and immutable versions with JSON requests", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => strategy });
    const rule = strategy.versions[0].rule;
    await createCustomStrategy({ name: "BTC DCA", rule }, fetcher);
    await createCustomStrategyVersion("strategy-a", { rule }, fetcher);
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/quant/custom-strategies",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "BTC DCA", rule }) }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/quant/custom-strategies/strategy-a/versions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("archives by DELETE and hides server error details", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: "database secret" }),
    });
    await expect(archiveCustomStrategy("strategy-a", fetcher)).rejects.toThrow(
      "CUSTOM_STRATEGY_REQUEST_FAILED",
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/api/quant/custom-strategies/strategy-a",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
