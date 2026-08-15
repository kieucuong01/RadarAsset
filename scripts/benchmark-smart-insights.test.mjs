import assert from "node:assert/strict";
import test from "node:test";

import { assertBudgets, percentile } from "./benchmark-smart-insights.mjs";

test("percentile returns the nearest-rank observation", () => {
  assert.equal(percentile([10, 20, 30, 40, 50], 0.95), 50);
  assert.equal(percentile([50, 10, 40, 20, 30], 0.5), 30);
});

test("percentile rejects empty or invalid samples", () => {
  assert.throws(() => percentile([], 0.95), /at least one sample/);
  assert.throws(() => percentile([10, Number.NaN], 0.95), /finite/);
  assert.throws(() => percentile([10], 0), /between zero and one/);
});

test("briefing budget accepts the exact boundary", () => {
  assert.doesNotThrow(() =>
    assertBudgets({ p95Ms: 200, bytes: 250_000, gzipBytes: 75_000 }),
  );
});

test("briefing budget reports every exceeded limit", () => {
  assert.throws(
    () => assertBudgets({ p95Ms: 201, bytes: 250_001, gzipBytes: 75_001 }),
    /p95 201ms > 200ms, payload 250001 > 250000, gzip 75001 > 75000/,
  );
});
