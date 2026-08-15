import { z } from "zod";

import { cachedRequest, clearCachedRequest } from "@/lib/client/request-cache";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const QUANT_DATA_READINESS_CACHE_KEY = "quant:data-readiness";

const marketSchema = z.enum(["vn_equity", "crypto_spot", "metal_spot"]);
const timeframeSchema = z.enum(["1d", "1h"]);

const quantDataReadinessSchema = z
  .object({
    readyForBacktest: z.boolean(),
    instrumentsByMarket: z.object({
      vn_equity: z.number().int().nonnegative(),
      crypto_spot: z.number().int().nonnegative(),
      metal_spot: z.number().int().nonnegative(),
    }),
    activeDatasetsByMarketTimeframe: z.array(
      z
        .object({
          market: marketSchema,
          timeframe: timeframeSchema,
          count: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    ingestionRequestsByStatusTimeframe: z.array(
      z
        .object({
          status: z.string().min(1),
          timeframe: timeframeSchema,
          count: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    backlogCount: z.number().int().nonnegative(),
    dueBacklogCount: z.number().int().nonnegative(),
    expectedDatasetCount: z.number().int().nonnegative(),
    missingDatasetCount: z.number().int().nonnegative(),
    staleDatasetCount: z.number().int().nonnegative(),
    missingBarCount: z.number().int().nonnegative(),
    oldestBacklogAt: z.string().datetime().nullable(),
    oldestDueBacklogAt: z.string().datetime().nullable(),
    workerHeartbeatAt: z.string().datetime().nullable(),
    workerStatus: z.enum(["active", "stale", "unavailable"]),
    lastSchedulerSuccessAt: z.string().datetime().nullable(),
    latestSchedulerRun: z
      .object({
        command: z.enum(["hourly", "daily", "all"]),
        status: z.enum(["running", "succeeded", "failed"]),
        startedAt: z.string().datetime(),
        finishedAt: z.string().datetime().nullable(),
        errorCode: z.string().max(80).nullable(),
      })
      .nullable(),
    recentProviderFailures: z.array(
      z
        .object({
          providerCode: z.string().min(1).max(80),
          errorCode: z.string().min(1).max(80),
          count: z.number().int().positive(),
        })
        .strict(),
    ),
  })
  .strict();

export type QuantDataReadiness = z.infer<typeof quantDataReadinessSchema>;

export function parseQuantDataReadiness(input: unknown): QuantDataReadiness {
  const parsed = quantDataReadinessSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid quant data readiness response.");
  return parsed.data;
}

export async function getQuantDataReadiness(fetcher: Fetcher = fetch): Promise<QuantDataReadiness> {
  const response = await fetcher("/api/quant/data-readiness", { cache: "no-store" });
  if (!response.ok) throw new Error("Quant data readiness is unavailable.");
  return parseQuantDataReadiness(await response.json());
}

export function getCachedQuantDataReadiness(fetcher: Fetcher = fetch): Promise<QuantDataReadiness> {
  return cachedRequest(QUANT_DATA_READINESS_CACHE_KEY, () => getQuantDataReadiness(fetcher));
}

export function clearCachedQuantDataReadiness() {
  clearCachedRequest(QUANT_DATA_READINESS_CACHE_KEY);
}

export function quantDataReadinessSummary(readiness: QuantDataReadiness) {
  const activeDatasetCount = readiness.activeDatasetsByMarketTimeframe.reduce(
    (total, item) => total + item.count,
    0,
  );

  if (!readiness.readyForBacktest || activeDatasetCount === 0) {
    return {
      tone: "blocked" as const,
      label: "No active datasets",
      detail: "Run ingestion before backtesting",
    };
  }

  if (readiness.backlogCount > 0) {
    return {
      tone: "backlog" as const,
      label: `${activeDatasetCount.toLocaleString()} active datasets`,
      detail: `${readiness.backlogCount.toLocaleString()} ingestion jobs queued/running`,
    };
  }

  return {
    tone: "ready" as const,
    label: `${activeDatasetCount.toLocaleString()} active datasets`,
    detail: "No ingestion backlog",
  };
}

export function quantDataOperationsHealth(readiness: QuantDataReadiness) {
  const providerFailureCount = readiness.recentProviderFailures.reduce(
    (total, item) => total + item.count,
    0,
  );
  const issueCount =
    readiness.missingDatasetCount +
    readiness.staleDatasetCount +
    providerFailureCount +
    (readiness.latestSchedulerRun?.status === "failed" ? 1 : 0) +
    (readiness.dueBacklogCount > 0 && readiness.workerStatus !== "active" ? 1 : 0);
  const workerFailed = readiness.dueBacklogCount > 0 && readiness.workerStatus !== "active";
  return {
    tone:
      readiness.latestSchedulerRun?.status === "failed" || workerFailed
        ? ("failed" as const)
        : issueCount > 0
          ? ("degraded" as const)
          : ("healthy" as const),
    issueCount,
    providerFailureCount,
  };
}
