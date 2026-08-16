import { z } from "zod";

import type { MarketDataFreshness, MarketDataHealthItem } from "@/lib/backend/types";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const nullableDateTime = z.string().datetime().nullable();

const marketDataHealthItemSchema = z.object({
  symbol: z.string().trim().min(1).max(20),
  market: z.enum(["vn_equity", "crypto_spot", "metal_spot"]),
  timeframe: z.enum(["1d"]),
  providerCode: z.string().max(80).nullable(),
  providerName: z.string().max(120).nullable(),
  upstreamProvider: z.string().max(80).nullable(),
  datasetVersionId: z.string().uuid().or(z.string().max(120)).nullable(),
  version: z.number().int().positive().nullable(),
  rowCount: z.number().int().nonnegative(),
  coverageStart: nullableDateTime,
  coverageEnd: nullableDateTime,
  publishedAt: nullableDateTime,
  lastIngestionStatus: z
    .enum(["running", "succeeded", "unchanged", "skipped", "failed", "unavailable"])
    .nullable(),
  lastErrorCode: z.string().max(64).nullable(),
  freshness: z.enum(["fresh", "stale", "unavailable", "fixture"]),
});

const marketDataHealthResponseSchema = z.object({
  data: z.array(marketDataHealthItemSchema).max(1_000),
});

const STATUS_META = {
  fresh: { label: "LIVE DATA", variant: "default" },
  stale: { label: "STALE", variant: "secondary" },
  unavailable: { label: "UNAVAILABLE", variant: "outline" },
  fixture: { label: "FIXTURE", variant: "secondary" },
} as const;

export function marketDataStatusMeta(freshness: MarketDataFreshness) {
  return STATUS_META[freshness];
}

export async function getMarketDataHealth(
  fetcher: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<MarketDataHealthItem[]> {
  const response = await fetcher("/api/market/data-health", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Unable to load market data health.");

  const parsed = marketDataHealthResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Invalid market data health response.");
  return parsed.data.data as MarketDataHealthItem[];
}
