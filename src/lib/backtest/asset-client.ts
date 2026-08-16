import { z } from "zod";

import { formatCount } from "@/lib/financial-format";

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
      .enum([
        "DATASET_UNAVAILABLE",
        "DATASET_RANGE_INSUFFICIENT",
        "DATASET_PROVIDER_GAP",
        "DATASET_CALENDAR_UNVERIFIED",
      ])
      .nullable(),
    calendarVersion: z.string().min(1).max(100).nullable(),
    qualityIssueCount: z.number().int().nonnegative(),
    blockingQualityIssueCount: z.number().int().nonnegative(),
    catalogCoverage: z
      .object({
        firstObservedAt: z.string().datetime().nullable(),
        completeForRequestedRange: z.boolean(),
        warningCode: z.literal("SURVIVORSHIP_COVERAGE_PARTIAL").nullable(),
      })
      .strict(),
    listingStatus: z.enum(["active", "inactive", "delisted", "unknown"]),
    availableAdjustments: z.array(z.enum(["raw", "total_return"])).max(2),
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

const quantAssetCatalogSchema = z.object({ items: z.array(quantAssetCatalogItemSchema) }).strict();

export type QuantAssetCatalogItem = z.infer<typeof quantAssetCatalogItemSchema>;
export type QuantAssetCatalog = z.infer<typeof quantAssetCatalogSchema>;

function isoDay(value: string | null) {
  return value ? value.slice(0, 10) : null;
}

export function assetReadinessLabel(item: QuantAssetCatalogItem, locale: "vi" | "en" = "vi") {
  if (item.backtestable) {
    if (item.catalogCoverage.warningCode === "SURVIVORSHIP_COVERAGE_PARTIAL") {
      return {
        badge: locale === "vi" ? "Độ phủ lịch sử một phần" : "Partial history coverage",
        detail: item.catalogCoverage.firstObservedAt
          ? `${formatCount(item.rowCount)} bars · ${locale === "vi" ? "catalog từ" : "catalog since"} ${isoDay(item.catalogCoverage.firstObservedAt)}`
          : `${formatCount(item.rowCount)} bars · ${locale === "vi" ? "chưa rõ mốc catalog" : "catalog start unknown"}`,
      };
    }
    return {
      badge: locale === "vi" ? "Sẵn sàng" : "Ready",
      detail: `${formatCount(item.rowCount)} bars`,
    };
  }
  if (item.reasonCode === "DATASET_RANGE_INSUFFICIENT") {
    const start = isoDay(item.coverageStart);
    const end = isoDay(item.coverageEnd);
    return {
      badge: locale === "vi" ? "Ngoài khoảng dữ liệu" : "Range unavailable",
      detail:
        start && end
          ? `${formatCount(item.rowCount)} bars, ${start} ${locale === "vi" ? "đến" : "to"} ${end}`
          : `${formatCount(item.rowCount)} bars`,
    };
  }
  if (item.reasonCode === "DATASET_PROVIDER_GAP") {
    return {
      badge: locale === "vi" ? "Có khoảng trống dữ liệu" : "Provider data gap",
      detail: `${formatCount(item.blockingQualityIssueCount)} ${locale === "vi" ? "khoảng lỗi" : "blocking ranges"}`,
    };
  }
  if (item.reasonCode === "DATASET_CALENDAR_UNVERIFIED") {
    return {
      badge: locale === "vi" ? "Lịch chưa kiểm chứng" : "Calendar unverified",
      detail:
        item.calendarVersion ??
        (locale === "vi" ? "Chưa có phiên bản lịch" : "No calendar version"),
    };
  }
  return {
    badge: locale === "vi" ? "Chưa có dataset" : "No dataset",
    detail: `${formatCount(item.rowCount)} bars`,
  };
}

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
