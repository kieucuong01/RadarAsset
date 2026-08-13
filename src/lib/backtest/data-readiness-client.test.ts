import { describe, expect, it, vi } from "vitest";

import {
  getQuantDataReadiness,
  parseQuantDataReadiness,
  quantDataOperationsHealth,
  quantDataReadinessSummary,
  type QuantDataReadiness,
} from "./data-readiness-client";

const validReadiness = {
  readyForBacktest: true,
  instrumentsByMarket: { vn_equity: 404, crypto_spot: 13, metal_spot: 1 },
  activeDatasetsByMarketTimeframe: [
    { market: "vn_equity", timeframe: "1d", count: 20 },
    { market: "crypto_spot", timeframe: "1h", count: 13 },
  ],
  ingestionRequestsByStatusTimeframe: [
    { status: "queued", timeframe: "1d", count: 398 },
    { status: "running", timeframe: "1h", count: 2 },
  ],
  backlogCount: 400,
  expectedDatasetCount: 836,
  missingDatasetCount: 803,
  staleDatasetCount: 2,
  missingBarCount: 5,
  oldestBacklogAt: "2026-08-14T09:00:00.000Z",
  lastSchedulerSuccessAt: "2026-08-14T10:30:00.000Z",
  recentProviderFailures: [{ providerCode: "vnstock-vci-free", count: 2 }],
} satisfies QuantDataReadiness;

describe("Quant data readiness client", () => {
  it("validates the readiness response and rejects unknown fields", () => {
    expect(parseQuantDataReadiness(validReadiness)).toEqual(validReadiness);
    expect(() =>
      parseQuantDataReadiness({ ...validReadiness, internalConnectionString: "secret" }),
    ).toThrow("Invalid quant data readiness response.");
  });

  it("loads readiness without caching", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(validReadiness), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(getQuantDataReadiness(fetcher)).resolves.toEqual(validReadiness);
    expect(fetcher).toHaveBeenCalledWith("/api/quant/data-readiness", { cache: "no-store" });
  });

  it("summarizes active coverage and ingestion backlog for the Quant header", () => {
    expect(quantDataReadinessSummary(validReadiness)).toEqual({
      tone: "backlog",
      label: "33 active datasets",
      detail: "400 ingestion jobs queued/running",
    });

    expect(
      quantDataReadinessSummary({
        ...validReadiness,
        readyForBacktest: false,
        activeDatasetsByMarketTimeframe: [],
        backlogCount: 0,
      }),
    ).toEqual({
      tone: "blocked",
      label: "No active datasets",
      detail: "Run ingestion before backtesting",
    });
  });

  it("classifies stale, missing, and failed provider operations as degraded", () => {
    expect(quantDataOperationsHealth(validReadiness)).toEqual({
      tone: "degraded",
      issueCount: 807,
      providerFailureCount: 2,
    });
    expect(
      quantDataOperationsHealth({
        ...validReadiness,
        missingDatasetCount: 0,
        staleDatasetCount: 0,
        missingBarCount: 0,
        recentProviderFailures: [],
      }),
    ).toEqual({ tone: "healthy", issueCount: 0, providerFailureCount: 0 });
  });
});
