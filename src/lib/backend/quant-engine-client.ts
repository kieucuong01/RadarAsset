export class QuantEngineError extends Error {
  constructor(
    readonly code: "UNAVAILABLE" | "REJECTED" | "INVALID_RESPONSE",
    message: string,
  ) {
    super(message);
    this.name = "QuantEngineError";
  }
}

export type QuantEngineOptimizeInput = {
  returnsBySymbol: Record<string, number[]>;
  marketBySymbol: Record<string, string>;
  timeframe: "1d";
  method: string;
  maxWeightBps: number;
  totalWeightBps: number;
  targetReturnPct?: number;
  targetVolatilityPct?: number;
  riskTolerance?: number;
};

export async function requestQuantEngineOptimization(input: QuantEngineOptimizeInput) {
  return requestQuantEngine("/v1/optimize", input);
}

export async function requestQuantEngineVietnamFactors(input: {
  pricesBySymbol: Record<string, number[]>;
  volumesBySymbol: Record<string, number[]>;
  asOf: string;
}) {
  return requestQuantEngine("/v1/factors/vietnam", input);
}

async function requestQuantEngine(path: string, input: unknown) {
  const baseUrl = process.env.QUANT_ENGINE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8100";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.QUANT_ENGINE_API_TOKEN
          ? { authorization: `Bearer ${process.env.QUANT_ENGINE_API_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(input),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { detail?: unknown } | null;
      const detail =
        typeof payload?.detail === "string" ? payload.detail : "Optimization rejected.";
      throw new QuantEngineError("REJECTED", detail);
    }
    return (await response.json()) as unknown;
  } catch (error) {
    if (error instanceof QuantEngineError) throw error;
    throw new QuantEngineError("UNAVAILABLE", "Python quant engine is unavailable.");
  } finally {
    clearTimeout(timeout);
  }
}
