import { expect, test } from "vitest";

import { assertBudgets, benchmark, percentile } from "./benchmark-smart-insights.mjs";

test("percentile returns the nearest-rank observation", () => {
  expect(percentile([10, 20, 30, 40, 50], 0.95)).toBe(50);
  expect(percentile([50, 10, 40, 20, 30], 0.5)).toBe(30);
});

test("percentile rejects empty or invalid samples", () => {
  expect(() => percentile([], 0.95)).toThrow(/at least one sample/);
  expect(() => percentile([10, Number.NaN], 0.95)).toThrow(/finite/);
  expect(() => percentile([10], 0)).toThrow(/between zero and one/);
});

test("briefing budget accepts the exact boundary", () => {
  expect(() => assertBudgets({ p95Ms: 200, bytes: 250_000, gzipBytes: 75_000 })).not.toThrow();
});

test("briefing budget reports every exceeded limit", () => {
  expect(() => assertBudgets({ p95Ms: 201, bytes: 250_001, gzipBytes: 75_001 })).toThrow(
    /p95 201ms > 200ms, payload 250001 > 250000, gzip 75001 > 75000/,
  );
});

test("benchmark warms once, reports asset count, and excludes the warm-up", async () => {
  let calls = 0;
  const body = JSON.stringify({
    assetOpinions: Array.from({ length: 25 }, (_, index) => ({ index })),
  });
  const result = await benchmark({
    url: "http://local.test/api/smart-insights/briefing",
    iterations: 3,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, text: async () => body };
    },
  });

  expect(calls).toBe(4);
  expect(result.iterations).toBe(3);
  expect(result.assetCount).toBe(25);
  expect(result.requestCount).toBe(4);
});

test("briefing budget rejects a universe over 25 assets", () => {
  expect(() => assertBudgets({ p95Ms: 1, bytes: 1, gzipBytes: 1, assetCount: 26 })).toThrow(
    /asset count 26 > 25/,
  );
});
