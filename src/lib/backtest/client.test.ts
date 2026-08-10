import { describe, expect, it, vi } from "vitest";

import { getBacktestRun, isActiveRun, parseBacktestRun, submitBacktest } from "./client";

const submission = {
  strategy: "ma_cross" as const,
  timeframe: "1d" as const,
  fastPeriod: 5,
  slowPeriod: 20,
  initialCapital: 100_000,
  feeBps: 10,
  slippageBps: 5,
  from: "2024-01-01",
  to: "2025-01-01",
  legs: [{ symbol: "BTC" as const, leverage: 1 }],
};

const queuedRun = {
  id: "run-1",
  strategyName: "MA Crossover Backtest",
  status: "queued",
  timeframe: "1d",
  progress: 0,
  strategyHash: "a".repeat(64),
  datasetVersionIds: ["dataset-1"],
  engineVersion: "ma-cross-v1",
  parameters: submission,
  metrics: null,
  errorMessage: null,
  startedAt: null,
  finishedAt: null,
  createdAt: "2026-08-10T00:00:00.000Z",
  artifacts: [],
};

describe("backtest API client", () => {
  it("submits a strict payload and accepts the HTTP 202 queued contract", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(queuedRun), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await submitBacktest(submission, fetcher);

    expect(result.status).toBe("queued");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/quant/runs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(submission),
      }),
    );
  });

  it("classifies only queued and running states as active", () => {
    expect(isActiveRun("queued")).toBe(true);
    expect(isActiveRun("running")).toBe(true);
    expect(isActiveRun("succeeded")).toBe(false);
    expect(isActiveRun("failed")).toBe(false);
  });

  it("loads a tenant-scoped run detail and forwards AbortSignal", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(queuedRun)));

    const result = await getBacktestRun("run-1", fetcher, controller.signal);

    expect(result.id).toBe("run-1");
    expect(fetcher).toHaveBeenCalledWith("/api/quant/runs/run-1", {
      cache: "no-store",
      signal: controller.signal,
    });
  });

  it("rejects malformed artifact payloads instead of rendering unchecked server data", () => {
    expect(() =>
      parseBacktestRun({
        ...queuedRun,
        status: "succeeded",
        progress: 100,
        metrics: { totalReturnPct: 10 },
        artifacts: [
          {
            id: "artifact-1",
            kind: "equity",
            checksum: "b".repeat(64),
            payload: "not-an-equity-array",
            rowCount: 1,
            schemaVersion: 1,
          },
        ],
      }),
    ).toThrow("Invalid backtest response");
  });
});
