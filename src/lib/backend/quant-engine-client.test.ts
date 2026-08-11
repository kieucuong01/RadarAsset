import { afterEach, describe, expect, it, vi } from "vitest";

import { QuantEngineError, requestQuantEngineOptimization } from "./quant-engine-client";

const input = {
  returnsBySymbol: { BTC: Array(30).fill(0.01) },
  marketBySymbol: { BTC: "crypto_spot" },
  timeframe: "1d" as const,
  method: "equal_weight",
  maxWeightBps: 10_000,
  totalWeightBps: 10_000,
};

describe("quant engine client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the private engine endpoint and returns JSON", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ method: "equal_weight" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(requestQuantEngineOptimization(input)).resolves.toEqual({
      method: "equal_weight",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8100/v1/optimize",
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
  });

  it("maps network errors to a typed unavailable failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(requestQuantEngineOptimization(input)).rejects.toEqual(
      expect.objectContaining<Partial<QuantEngineError>>({ code: "UNAVAILABLE" }),
    );
  });
});
