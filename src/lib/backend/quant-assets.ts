import { z } from "zod";

import { getPrisma } from "@/lib/db/prisma";
import { calculateFreshness } from "@/lib/market-data/health";

import type { TenantContext } from "@/lib/auth/tenant-context";
import type {
  MarketDataMarket,
  MarketDataTimeframe,
  QuantAssetCatalogResponse,
  QuantDataReadinessResponse,
} from "./types";

const SUPPORTED_MARKETS = ["vn_equity", "crypto_spot", "metal_spot"] as const;
const FOREIGN_EQUITY_CLASSES = ["equity", "etf", "stock", "index"] as const;
const ELIGIBLE_DATASET_QUALITY = ["passed", "warning"] as const;
const CATALOG_SCAN_LIMIT = 500;
const CATALOG_RESPONSE_LIMIT = 50;
type QuantAssetReasonCode = QuantAssetCatalogResponse["items"][number]["reasonCode"];
const MARKET_PRIORITY: Record<MarketDataMarket, number> = {
  vn_equity: 0,
  metal_spot: 1,
  crypto_spot: 2,
};
const EMPTY_MARKET_COUNTS: Record<MarketDataMarket, number> = {
  vn_equity: 0,
  crypto_spot: 0,
  metal_spot: 0,
};
const BACKLOG_STATUSES = new Set(["queued", "running"]);
const PUBLIC_INGESTION_ERROR_CODES = new Set([
  "ingestion_failed",
  "invalid_response",
  "network_error",
  "provider_rejected",
  "provider_unavailable",
  "rate_limited",
  "response_limit",
  "stale_run",
  "unsupported_timeframe",
]);

function isRealIsoDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealIsoDate, "Expected a real calendar date.");

export const quantAssetQuerySchema = z
  .object({
    q: z
      .string()
      .default("")
      .transform((value) => value.trim().slice(0, 40)),
    timeframe: z.enum(["1d", "1h"]),
    from: isoDateSchema,
    to: isoDateSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.from > value.to) {
      context.addIssue({
        code: "custom",
        path: ["from"],
        message: "Start date must not be after end date.",
      });
    }
  });

export type QuantAssetQuery = z.infer<typeof quantAssetQuerySchema>;

function supportedMarket(value: string): MarketDataMarket {
  if (SUPPORTED_MARKETS.some((market) => market === value)) return value as MarketDataMarket;
  throw new Error("Unsupported Quant asset market returned from storage.");
}

function rangeBoundary(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

export async function loadQuantAssetCatalog(
  rawQuery: QuantAssetQuery,
  now = new Date(),
): Promise<QuantAssetCatalogResponse> {
  const query = quantAssetQuerySchema.parse(rawQuery);
  const assets = await getPrisma().asset.findMany({
    where: {
      market: { in: [...SUPPORTED_MARKETS] },
      NOT: {
        market: { not: "vn_equity" },
        assetClass: { in: [...FOREIGN_EQUITY_CLASSES] },
      },
      ...(query.q
        ? {
            OR: [
              { symbol: { contains: query.q, mode: "insensitive" as const } },
              { name: { startsWith: query.q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { symbol: "asc" },
    take: CATALOG_SCAN_LIMIT,
    select: {
      symbol: true,
      name: true,
      market: true,
      venue: true,
      currency: true,
      maxLeverage: true,
      listingStatus: true,
      listingPeriods: {
        orderBy: { validFrom: "asc" },
        take: 1,
        select: { validFrom: true },
      },
      datasets: {
        where: { timeframe: query.timeframe, adjustmentPolicy: { in: ["raw", "total_return"] } },
        select: {
          adjustmentPolicy: true,
          versions: {
            where: { isActive: true, qualityStatus: { in: [...ELIGIBLE_DATASET_QUALITY] } },
            orderBy: { version: "desc" },
            take: 1,
            select: {
              id: true,
              coverageStart: true,
              coverageEnd: true,
              rowCount: true,
              sourceMetadata: true,
              issues: {
                select: {
                  classification: true,
                  severity: true,
                  rangeStart: true,
                  rangeEnd: true,
                },
              },
              bars: {
                orderBy: { ts: "desc" },
                take: 1,
                select: { source: true },
              },
            },
          },
        },
      },
    },
  });

  const requestedStart = rangeBoundary(query.from);
  const requestedEnd = rangeBoundary(query.to);

  return {
    items: assets
      .map((asset) => {
        const market = supportedMarket(asset.market);
        const rawDataset = asset.datasets.find((dataset) => dataset.adjustmentPolicy === "raw");
        const version = rawDataset?.versions[0] ?? null;
        const availableAdjustments = asset.datasets
          .filter((dataset) => {
            const policyVersion = dataset.versions[0];
            return Boolean(
              policyVersion &&
              policyVersion.coverageStart <= requestedStart &&
              policyVersion.coverageEnd >= requestedEnd,
            );
          })
          .map((dataset) => dataset.adjustmentPolicy)
          .filter(
            (policy): policy is "raw" | "total_return" =>
              policy === "raw" || policy === "total_return",
          )
          .sort((left, right) => (left === "raw" ? -1 : right === "raw" ? 1 : 0));
        const rangeCovered = Boolean(
          version && version.coverageStart <= requestedStart && version.coverageEnd >= requestedEnd,
        );
        const intersectingIssues = (version?.issues ?? []).filter(
          (issue) =>
            issue.rangeStart &&
            issue.rangeEnd &&
            issue.rangeStart <= requestedEnd &&
            issue.rangeEnd >= requestedStart,
        );
        const hasCalendarBlock = intersectingIssues.some(
          (issue) => issue.classification === "CALENDAR_RANGE_UNVERIFIED",
        );
        const hasProviderGap = intersectingIssues.some(
          (issue) => issue.classification === "PROVIDER_GAP",
        );
        const reasonCode: QuantAssetReasonCode = !version
          ? "DATASET_UNAVAILABLE"
          : !rangeCovered
            ? "DATASET_RANGE_INSUFFICIENT"
            : hasCalendarBlock
              ? "DATASET_CALENDAR_UNVERIFIED"
              : hasProviderGap
                ? "DATASET_PROVIDER_GAP"
                : null;
        const sourceMetadata =
          version?.sourceMetadata && typeof version.sourceMetadata === "object"
            ? (version.sourceMetadata as Record<string, unknown>)
            : {};
        const firstObservedAt = asset.listingPeriods[0]?.validFrom ?? null;
        const completeForRequestedRange = Boolean(
          firstObservedAt && requestedStart >= firstObservedAt,
        );

        return {
          symbol: asset.symbol,
          name: asset.name,
          market,
          venue: asset.venue,
          currency: asset.currency,
          maxLeverage: Number(asset.maxLeverage),
          timeframe: query.timeframe as MarketDataTimeframe,
          datasetVersionId: version?.id ?? null,
          coverageStart: version?.coverageStart.toISOString() ?? null,
          coverageEnd: version?.coverageEnd.toISOString() ?? null,
          rowCount: version?.rowCount ?? 0,
          freshness: calculateFreshness({
            market,
            timeframe: query.timeframe,
            coverageEnd: version?.coverageEnd ?? null,
            source: version?.bars[0]?.source ?? null,
            lastStatus: null,
            now,
          }),
          backtestable: reasonCode === null,
          reasonCode,
          calendarVersion:
            typeof sourceMetadata.calendarVersion === "string"
              ? sourceMetadata.calendarVersion
              : null,
          qualityIssueCount: version?.issues.length ?? 0,
          blockingQualityIssueCount: intersectingIssues.filter(
            (issue) =>
              issue.classification === "PROVIDER_GAP" ||
              issue.classification === "CALENDAR_RANGE_UNVERIFIED",
          ).length,
          catalogCoverage: {
            firstObservedAt: firstObservedAt?.toISOString() ?? null,
            completeForRequestedRange,
            warningCode: completeForRequestedRange
              ? null
              : ("SURVIVORSHIP_COVERAGE_PARTIAL" as const),
          },
          listingStatus: ["active", "inactive", "delisted", "unknown"].includes(asset.listingStatus)
            ? (asset.listingStatus as "active" | "inactive" | "delisted" | "unknown")
            : "unknown",
          availableAdjustments,
        };
      })
      .sort((left, right) => {
        const readiness = Number(right.backtestable) - Number(left.backtestable);
        if (readiness !== 0) return readiness;
        const market = MARKET_PRIORITY[left.market] - MARKET_PRIORITY[right.market];
        if (market !== 0) return market;
        const rows = right.rowCount - left.rowCount;
        if (rows !== 0) return rows;
        return left.symbol.localeCompare(right.symbol);
      })
      .slice(0, CATALOG_RESPONSE_LIMIT),
  };
}

export async function loadQuantDataReadiness(
  _context: TenantContext,
  now = new Date(),
): Promise<QuantDataReadinessResponse> {
  const prisma = getPrisma();
  const failureCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [
    assetCounts,
    activeDatasets,
    ingestionCounts,
    oldestBacklog,
    recentFailures,
    schedulerRows,
    workerHeartbeat,
  ] = await Promise.all([
    prisma.asset.groupBy({
      by: ["market"],
      where: { market: { in: [...SUPPORTED_MARKETS] }, listingStatus: "active" },
      _count: { _all: true },
    }),
    prisma.dataset.findMany({
      where: {
        adjustmentPolicy: "raw",
        timeframe: { in: ["1d", "1h"] },
        asset: { market: { in: [...SUPPORTED_MARKETS] }, listingStatus: "active" },
        versions: {
          some: { isActive: true, qualityStatus: { in: [...ELIGIBLE_DATASET_QUALITY] } },
        },
      },
      select: {
        timeframe: true,
        asset: { select: { market: true } },
        versions: {
          where: { isActive: true, qualityStatus: { in: [...ELIGIBLE_DATASET_QUALITY] } },
          orderBy: { version: "desc" },
          take: 1,
          select: { coverageEnd: true, missingBarCount: true, sourceMetadata: true },
        },
      },
    }),
    prisma.marketIngestionRequest.groupBy({
      by: ["status", "timeframe"],
      _count: { _all: true },
    }),
    prisma.marketIngestionRequest.findFirst({
      where: { status: { in: [...BACKLOG_STATUSES] } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.marketIngestionRequest.findMany({
      where: {
        status: "failed",
        updatedAt: { gte: failureCutoff },
      },
      select: {
        errorCode: true,
        providerInstrument: { select: { provider: { select: { code: true } } } },
      },
      take: 1_000,
    }),
    prisma.$queryRaw<
      Array<{
        command: string;
        status: string;
        started_at: Date;
        finished_at: Date | null;
        error_code: string | null;
        last_success_at: Date | null;
      }>
    >`
      SELECT
        command,
        status,
        started_at,
        finished_at,
        error_code,
        MAX(finished_at) FILTER (WHERE status = 'succeeded') OVER () AS last_success_at
      FROM market_ingestion_scheduler_runs
      WHERE status IN ('succeeded', 'failed')
      ORDER BY started_at DESC
      LIMIT 1
    `,
    prisma.ingestionWorkerHeartbeat.findFirst({
      orderBy: { heartbeatAt: "desc" },
      select: { heartbeatAt: true },
    }),
  ]);

  const instrumentsByMarket = { ...EMPTY_MARKET_COUNTS };
  for (const row of assetCounts) {
    instrumentsByMarket[supportedMarket(row.market)] = row._count._all;
  }

  const activeDatasetMap = new Map<
    string,
    QuantDataReadinessResponse["activeDatasetsByMarketTimeframe"][number]
  >();
  let staleDatasetCount = 0;
  let missingBarCount = 0;
  for (const dataset of activeDatasets) {
    const market = supportedMarket(dataset.asset.market);
    const timeframe = dataset.timeframe as MarketDataTimeframe;
    const version = dataset.versions[0];
    if (version) {
      missingBarCount += version.missingBarCount;
      const metadata = version.sourceMetadata as { mode?: unknown } | null;
      const freshness = calculateFreshness({
        market,
        timeframe,
        coverageEnd: version.coverageEnd,
        source: metadata?.mode === "fixture" ? "research_fixture" : null,
        lastStatus: null,
        now,
      });
      if (freshness === "stale") staleDatasetCount += 1;
    }
    const key = `${market}:${timeframe}`;
    const current = activeDatasetMap.get(key);
    if (current) {
      current.count += 1;
    } else {
      activeDatasetMap.set(key, { market, timeframe, count: 1 });
    }
  }
  const activeDatasetsByMarketTimeframe = [...activeDatasetMap.values()].sort((left, right) => {
    const market = MARKET_PRIORITY[left.market] - MARKET_PRIORITY[right.market];
    if (market !== 0) return market;
    return left.timeframe.localeCompare(right.timeframe);
  });

  const ingestionRequestsByStatusTimeframe = ingestionCounts.map((row) => ({
    status: row.status,
    timeframe: row.timeframe as MarketDataTimeframe,
    count: row._count._all,
  }));
  const backlogCount = ingestionRequestsByStatusTimeframe
    .filter((row) => BACKLOG_STATUSES.has(row.status))
    .reduce((total, row) => total + row.count, 0);
  const dueBacklogCount = backlogCount;
  const expectedDatasetCount =
    instrumentsByMarket.vn_equity * 2 +
    instrumentsByMarket.crypto_spot * 2 +
    instrumentsByMarket.metal_spot;
  const missingDatasetCount = Math.max(0, expectedDatasetCount - activeDatasets.length);
  const providerFailureCounts = new Map<string, number>();
  for (const failure of recentFailures) {
    const code = failure.providerInstrument.provider.code;
    const errorCode =
      failure.errorCode && PUBLIC_INGESTION_ERROR_CODES.has(failure.errorCode)
        ? failure.errorCode
        : "unknown";
    const key = `${code}:${errorCode}`;
    providerFailureCounts.set(key, (providerFailureCounts.get(key) ?? 0) + 1);
  }
  const recentProviderFailures = [...providerFailureCounts.entries()]
    .map(([key, count]) => {
      const separator = key.indexOf(":");
      return {
        providerCode: key.slice(0, separator),
        errorCode: key.slice(separator + 1),
        count,
      };
    })
    .sort((left, right) =>
      `${left.providerCode}:${left.errorCode}`.localeCompare(
        `${right.providerCode}:${right.errorCode}`,
      ),
    );
  const latestScheduler = schedulerRows[0] ?? null;
  const latestSchedulerRun = latestScheduler
    ? {
        command: latestScheduler.command as "hourly" | "daily" | "all",
        status: latestScheduler.status as "running" | "succeeded" | "failed",
        startedAt: latestScheduler.started_at.toISOString(),
        finishedAt: latestScheduler.finished_at?.toISOString() ?? null,
        errorCode: latestScheduler.error_code,
      }
    : null;
  const lastSchedulerSuccessAt = latestScheduler?.last_success_at?.toISOString() ?? null;
  const schedulerRecent = Boolean(
    latestScheduler?.last_success_at &&
    now.getTime() - latestScheduler.last_success_at.getTime() <= 25 * 60 * 60 * 1000,
  );
  const backlogOverAge = Boolean(
    oldestBacklog && now.getTime() - oldestBacklog.createdAt.getTime() > 6 * 60 * 60 * 1000,
  );
  const workerHeartbeatAt = workerHeartbeat?.heartbeatAt ?? null;
  const workerStatus = !workerHeartbeatAt
    ? "unavailable"
    : now.getTime() - workerHeartbeatAt.getTime() <= 90_000
      ? "active"
      : "stale";
  const workerCanDrainDueBacklog = dueBacklogCount === 0 || workerStatus === "active";

  return {
    readyForBacktest:
      activeDatasetsByMarketTimeframe.some((row) => row.count > 0) &&
      missingDatasetCount === 0 &&
      staleDatasetCount === 0 &&
      !backlogOverAge &&
      workerCanDrainDueBacklog &&
      schedulerRecent,
    instrumentsByMarket,
    activeDatasetsByMarketTimeframe,
    ingestionRequestsByStatusTimeframe,
    backlogCount,
    dueBacklogCount,
    expectedDatasetCount,
    missingDatasetCount,
    staleDatasetCount,
    missingBarCount,
    oldestBacklogAt: oldestBacklog?.createdAt.toISOString() ?? null,
    oldestDueBacklogAt: oldestBacklog?.createdAt.toISOString() ?? null,
    workerHeartbeatAt: workerHeartbeatAt?.toISOString() ?? null,
    workerStatus,
    lastSchedulerSuccessAt,
    latestSchedulerRun,
    recentProviderFailures,
  };
}
