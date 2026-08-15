import { describe, expect, it, vi } from "vitest";

import { cachedRequest, clearCachedRequest } from "./request-cache";

describe("cachedRequest", () => {
  it("deduplicates concurrent requests for the same key", async () => {
    const loader = vi.fn(async () => "loaded");

    const [first, second] = await Promise.all([
      cachedRequest("portfolio:1M", loader),
      cachedRequest("portfolio:1M", loader),
    ]);

    expect(first).toBe("loaded");
    expect(second).toBe("loaded");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("returns the cached value until the key is cleared", async () => {
    let value = 0;
    const loader = vi.fn(async () => {
      value += 1;
      return `value-${value}`;
    });

    await expect(cachedRequest("quant:data-readiness", loader)).resolves.toBe("value-1");
    await expect(cachedRequest("quant:data-readiness", loader)).resolves.toBe("value-1");
    clearCachedRequest("quant:data-readiness");
    await expect(cachedRequest("quant:data-readiness", loader)).resolves.toBe("value-2");

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("does not cache failed requests", async () => {
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce("recovered");

    await expect(cachedRequest("portfolio:failed", loader)).rejects.toThrow("temporary");
    await expect(cachedRequest("portfolio:failed", loader)).resolves.toBe("recovered");

    expect(loader).toHaveBeenCalledTimes(2);
  });
});
