export const TOTAL_ALLOCATION_BPS = 10_000;

export function equalAllocationBps(symbols: string[]): Record<string, number> {
  const ordered = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()))].sort();
  if (ordered.length < 1 || ordered.length > 10) {
    throw new Error("Expected 1 to 10 assets.");
  }

  const base = Math.floor(TOTAL_ALLOCATION_BPS / ordered.length);
  let remainder = TOTAL_ALLOCATION_BPS - base * ordered.length;
  return Object.fromEntries(
    ordered.map((symbol) => [symbol, base + (remainder-- > 0 ? 1 : 0)]),
  );
}

export function notionalFromBps(totalCapital: number, allocationBps: number) {
  if (!Number.isFinite(totalCapital) || totalCapital <= 0) {
    throw new Error("Total capital must be positive and finite.");
  }
  if (!Number.isInteger(allocationBps) || allocationBps < 0 || allocationBps > 10_000) {
    throw new Error("Allocation must be an integer from 0 to 10,000 basis points.");
  }
  return (totalCapital * allocationBps) / TOTAL_ALLOCATION_BPS;
}
