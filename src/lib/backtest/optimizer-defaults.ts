import type { OptimizerRequest } from "./optimizer-client";
import type { OptimizerMethod } from "./optimizer-methods";

export const DEFAULT_OPTIMIZER_SYMBOLS = ["VNINDEX", "XAU", "BTC"] as const;
export const DEFAULT_OPTIMIZER_FROM = "2021-01-01";
export const DEFAULT_OPTIMIZER_TO = "2026-01-01";
export const DEFAULT_OPTIMIZER_METHOD: OptimizerMethod = "risk_parity";

type OptimizerRequestInput = Pick<
  OptimizerRequest,
  "symbols" | "method" | "from" | "to" | "targetReturnPct" | "targetVolatilityPct" | "riskTolerance"
> & {
  maxWeightPct: number;
};

export function buildOptimizerRequest(input: OptimizerRequestInput): OptimizerRequest {
  const minimumCap = Math.ceil(10_000 / input.symbols.length);
  return {
    symbols: input.symbols,
    method: input.method,
    timeframe: "1d",
    from: input.from,
    to: input.to,
    maxWeightBps: Math.max(minimumCap, Math.round(input.maxWeightPct * 100)),
    totalWeightBps: 10_000,
    ...(input.method === "target_return" && input.targetReturnPct !== undefined
      ? { targetReturnPct: input.targetReturnPct }
      : {}),
    ...(input.method === "target_volatility" && input.targetVolatilityPct !== undefined
      ? { targetVolatilityPct: input.targetVolatilityPct }
      : {}),
    ...(input.method === "risk_tolerance" && input.riskTolerance !== undefined
      ? { riskTolerance: input.riskTolerance }
      : {}),
    dividendMode: "exclude",
  };
}
