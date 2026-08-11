import { describe, expect, it, vi } from "vitest";

import { parseOptimizerProposal, requestOptimizedAllocation } from "./optimizer-client";

const request = {
  symbols: ["BTC", "VNM"],
  timeframe: "1d" as const,
  from: "2025-01-01",
  to: "2025-12-31",
  riskAversion: 4,
  maxWeightBps: 7_000,
  totalWeightBps: 8_000,
  dividendMode: "exclude" as const,
};

const proposal = {
  weightsBps: { BTC: 3_000, VNM: 5_000 },
  totalWeightBps: 8_000,
  expectedReturnPct: 12.5,
  volatilityPct: 18.2,
  sharpe: 0.69,
  observationCount: 252,
  datasetVersionIds: { BTC: "dataset-btc", VNM: "dataset-vnm" },
  warnings: [],
};

describe("optimizer API client", () => {
  it("posts the strict portfolio request and parses the proposal", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(proposal), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(requestOptimizedAllocation(request, fetcher)).resolves.toEqual(proposal);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/quant/allocations/optimize",
      expect.objectContaining({ method: "POST", body: JSON.stringify(request) }),
    );
  });

  it("rejects proposals whose weights do not equal the investable target", () => {
    expect(() =>
      parseOptimizerProposal({ ...proposal, weightsBps: { BTC: 3_000, VNM: 4_999 } }),
    ).toThrow("Invalid optimizer response");
  });
});
