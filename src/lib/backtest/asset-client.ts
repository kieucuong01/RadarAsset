import { z } from "zod";

import type { QuantAssetQuery } from "@/lib/backend/quant-assets";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const quantAssetCatalogItemSchema = z
  .object({
    symbol: z.string().regex(/^[A-Z0-9][A-Z0-9._/-]{0,19}$/),
    name: z.string().min(1),
    market: z.enum(["vn_equity", "crypto_spot", "metal_spot"]),
    venue: z.string().nullable(),
    currency: z.string().min(1),
    maxLeverage: z.number().min(1).max(2),
    timeframe: z.enum(["1d", "1h"]),
    datasetVersionId: z.string().uuid().nullable(),
    coverageStart: z.string().datetime().nullable(),
    coverageEnd: z.string().datetime().nullable(),
    rowCount: z.number().int().nonnegative(),
    freshness: z.enum(["fresh", "stale", "unavailable", "fixture"]),
    backtestable: z.boolean(),
    reasonCode: z
      .enum(["DATASET_UNAVAILABLE", "DATASET_RANGE_INSUFFICIENT"])
      .nullable(),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.backtestable !== (item.reasonCode === null)) {
      context.addIssue({
        code: "custom",
        path: ["reasonCode"],
        message: "Backtest readiness and reason code disagree.",
      });
    }
    if (item.backtestable && !item.datasetVersionId) {
      context.addIssue({
        code: "custom",
        path: ["datasetVersionId"],
        message: "A backtestable asset requires an immutable dataset version.",
      });
    }
  });

const quantAssetCatalogSchema = z
  .object({ items: z.array(quantAssetCatalogItemSchema) })
  .strict();

export type QuantAssetCatalogItem = z.infer<typeof quantAssetCatalogItemSchema>;
export type QuantAssetCatalog = z.infer<typeof quantAssetCatalogSchema>;

export function parseQuantAssetCatalog(input: unknown): QuantAssetCatalog {
  const parsed = quantAssetCatalogSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid quant asset catalog response.");
  return parsed.data;
}

export async function getQuantAssets(
  query: QuantAssetQuery,
  fetcher: Fetcher = fetch,
): Promise<QuantAssetCatalog> {
  const search = new URLSearchParams({
    q: query.q.trim().slice(0, 40),
    timeframe: query.timeframe,
    from: query.from,
    to: query.to,
  });
  const response = await fetcher(`/api/quant/assets?${search.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Quant asset catalog is unavailable.");
  return parseQuantAssetCatalog(await response.json());
}
