import { describe, expect, it, vi } from "vitest";

import {
  getBacktestRun,
  getStrategyCatalog,
  isActiveRun,
  parseBacktestRun,
  submitBacktest,
} from "./client";
import { createDefaultPortfolioAssumptions } from "./contracts";
import { listStrategyCatalog } from "./strategy-catalog";

const submission = {
  timeframe: "1d" as const,
  totalCapital: 100_000,
  allocationMode: "equal" as const,
  feeBps: 10,
  slippageBps: 5,
  assumptions: createDefaultPortfolioAssumptions(10, 5),
  from: "2024-01-01",
  to: "2025-01-01",
  legs: [
    {
      symbol: "BTC",
      allocationBps: 10_000,
      leverage: 1,
      strategyCode: "ma_crossover" as const,
      strategyVersion: "1.0.0" as const,
      strategyParameters: { fastPeriod: 5, slowPeriod: 20 },
    },
  ],
};

const queuedRun = {
  id: "run-1",
  strategyName: "MA Crossover Backtest",
  strategyCode: "ma_crossover",
  strategyVersion: "1.0.0",
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
  legs: [],
  artifacts: [],
};

describe("backtest API client", () => {
  it("accepts the catalog payload produced by the strategy API", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(listStrategyCatalog()), { status: 200 }));

    await expect(getStrategyCatalog(fetcher)).resolves.toHaveLength(9);
  });

  it("loads and validates the versioned strategy catalog", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            code: "ma_crossover",
            version: "1.0.0",
            name: "MA Crossover",
            category: "rule_based",
            status: "active",
            parameterSchema: [
              {
                name: "fastPeriod",
                label: "Fast SMA",
                type: "integer",
                min: 2,
                max: 200,
                default: 5,
              },
            ],
            defaultParameters: { fastPeriod: 5 },
            supportedMarkets: ["vn_equity", "crypto_spot", "metal_spot"],
            supportedTimeframes: ["1d", "1h"],
            implementationHash: "a".repeat(64),
            sourceAttribution: "Apache License 2.0",
            modificationNotice: "Causal rewrite",
            origin: "built_in",
          },
        ]),
        { status: 200 },
      ),
    );

    const catalog = await getStrategyCatalog(fetcher);

    expect(catalog[0]?.code).toBe("ma_crossover");
    expect(fetcher).toHaveBeenCalledWith("/api/quant/strategies", { cache: "no-store" });
  });

  it("submits a strict payload and accepts the HTTP 202 queued contract", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(queuedRun), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await submitBacktest(submission, fetcher);

    expect(result.status).toBe("queued");
    expect(result.strategyCode).toBe("ma_crossover");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/quant/runs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(submission),
      }),
    );
  });

  it("parses independently resolved legs and scoped artifacts", () => {
    const parsed = parseBacktestRun({
      ...queuedRun,
      strategyCode: null,
      strategyVersion: null,
      legs: [
        {
          id: "leg-btc",
          symbol: "BTC",
          market: "crypto_spot",
          currency: "USDT",
          allocationBps: 10_000,
          initialNotional: 100_000,
          leverage: 1,
          strategyCode: "ma_crossover",
          strategyVersion: "1.0.0",
          strategyName: "MA Crossover",
          strategyParameters: { fastPeriod: 5, slowPeriod: 20 },
          implementationHash: "b".repeat(64),
          datasetVersionId: "dataset-1",
          status: "queued",
          progress: 0,
          metrics: null,
          errorCode: null,
        },
      ],
      artifacts: [
        {
          id: "manifest-1",
          quantRunLegId: "leg-btc",
          scopeKey: "leg:leg-btc",
          kind: "manifest",
          checksum: "c".repeat(64),
          payload: { schemaVersion: 1 },
          rowCount: 1,
          schemaVersion: 1,
        },
      ],
    });

    expect(parsed.legs[0]).toMatchObject({ symbol: "BTC", strategyCode: "ma_crossover" });
    expect(parsed.artifacts[0]).toMatchObject({ scopeKey: "leg:leg-btc" });
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
