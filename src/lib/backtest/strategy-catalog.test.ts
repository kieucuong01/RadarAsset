import { describe, expect, it } from "vitest";

import {
  STRATEGY_CATALOG,
  normalizeStrategyParameters,
  strategyDefinition,
  syncStrategyCatalog,
} from "./strategy-catalog";

describe("strategy catalog", () => {
  it("exposes the four approved runnable strategies in stable order", () => {
    expect(STRATEGY_CATALOG.map((item) => item.code)).toEqual([
      "ma_crossover",
      "turtle_breakout",
      "signal_rolling_reversal",
      "abcd_causal",
    ]);
    expect(STRATEGY_CATALOG.every((item) => item.version === "1.0.0")).toBe(true);
  });

  it("normalizes valid parameters and rejects unknown or unsafe values", () => {
    expect(
      normalizeStrategyParameters("turtle_breakout", {
        entryPeriod: 20,
        exitPeriod: 10,
      }),
    ).toEqual({ entryPeriod: 20, exitPeriod: 10 });

    expect(() =>
      normalizeStrategyParameters("ma_crossover", {
        fastPeriod: 20,
        slowPeriod: 5,
      }),
    ).toThrow("Fast period must be lower than slow period");

    expect(() =>
      normalizeStrategyParameters("ma_crossover", {
        fastPeriod: 5,
        slowPeriod: 20,
        execute: "rm -rf",
      }),
    ).toThrow();
  });

  it("returns an immutable definition and stable implementation hash", () => {
    const first = strategyDefinition("abcd_causal", "1.0.0");
    const second = strategyDefinition("abcd_causal", "1.0.0");

    expect(first).toEqual(second);
    expect(first.implementationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.sourceAttribution).toContain("Apache License 2.0");
  });

  it("synchronizes missing rows and rejects catalog drift", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const repository = {
      async findByCodeVersion(input: { code: string; version: string }) {
        return rows.get(`${input.code}:${input.version}`) ?? null;
      },
      async create(input: Record<string, unknown>) {
        rows.set(`${String(input.code)}:${String(input.version)}`, input);
        return input;
      },
    };

    await syncStrategyCatalog(repository);
    expect(rows.size).toBe(4);
    await expect(syncStrategyCatalog(repository)).resolves.toHaveLength(4);

    const key = "ma_crossover:1.0.0";
    rows.set(key, { ...rows.get(key), implementationHash: "b".repeat(64) });
    await expect(syncStrategyCatalog(repository)).rejects.toThrow("catalog drift");
  });

  it("treats reordered JSON object keys as the same catalog value", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const repository = {
      findByCodeVersion: async ({ code, version }: { code: string; version: string }) => {
        const row = rows.get(`${code}:${version}`);
        if (!row) return null;
        const parameterSchema = (row.parameterSchema as Array<Record<string, unknown>>).map(
          ({ name, label, type, min, max, default: defaultValue }) => ({
            max,
            min,
            name,
            type,
            label,
            default: defaultValue,
          }),
        );
        return { ...row, parameterSchema };
      },
      create: async (row: Record<string, unknown>) => {
        rows.set(`${String(row.code)}:${String(row.version)}`, row);
        return row;
      },
    };

    await expect(syncStrategyCatalog(repository)).resolves.toHaveLength(4);
    await expect(syncStrategyCatalog(repository)).resolves.toHaveLength(4);
  });
});
