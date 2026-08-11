import { backtestSymbolSchema } from "./contracts";

export function normalizePreselectedSymbols(input: string | string[] | undefined) {
  const values = input === undefined ? [] : Array.isArray(input) ? input : [input];
  const symbols: string[] = [];
  for (const value of values.flatMap((item) => item.split(","))) {
    const parsed = backtestSymbolSchema.safeParse(value);
    if (!parsed.success || symbols.includes(parsed.data)) continue;
    symbols.push(parsed.data);
    if (symbols.length === 10) break;
  }
  return symbols;
}
