import { describe, expect, it, vi } from "vitest";

import { migrateLegacyStrategies } from "./legacy-migration";

const stored = JSON.stringify({
  version: 1,
  strategies: [
    {
      schemaVersion: 1,
      id: "dca",
      name: "DCA BTC",
      symbol: "BTC",
      kind: "scheduled_dca",
      amount: 400,
      currency: "USD",
      frequency: "monthly",
      dayOfMonth: 1,
    },
    {
      schemaVersion: 1,
      id: "price",
      name: "BTC 50k",
      symbol: "BTC",
      kind: "price_threshold",
      operator: "crosses_below",
      value: 50000,
      currency: "USD",
      action: "buy",
      sizePct: 25,
    },
    {
      schemaVersion: 1,
      id: "fundamental",
      name: "PB FPT",
      symbol: "FPT",
      kind: "fundamental_threshold",
      metric: "pb",
      operator: "lt",
      value: 4,
      action: "buy",
    },
  ],
});

describe("legacy Strategy Lab migration", () => {
  it("imports executable rules and preserves unsupported drafts", async () => {
    const create = vi.fn().mockResolvedValue({});
    const storage = new Map([["radarasset.strategy-lab.v1", stored]]);
    const result = await migrateLegacyStrategies(storageAdapter(storage), create);
    expect(result).toEqual({ imported: 2, skipped: 1, failed: 0 });
    expect(create).toHaveBeenCalledTimes(2);
    expect(storage.has("radarasset.strategy-lab.v1")).toBe(false);
    expect(storage.get("radarasset.strategy-lab.db-migration.v1")).toBe("complete");
  });

  it("keeps legacy storage when any import fails", async () => {
    const storage = new Map([["radarasset.strategy-lab.v1", stored]]);
    const result = await migrateLegacyStrategies(
      storageAdapter(storage),
      vi.fn().mockRejectedValue(new Error("offline")),
    );
    expect(result.failed).toBe(1);
    expect(storage.has("radarasset.strategy-lab.v1")).toBe(true);
  });
});

function storageAdapter(storage: Map<string, string>) {
  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
}
