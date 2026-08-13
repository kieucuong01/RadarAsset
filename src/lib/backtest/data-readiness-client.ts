import { z } from "zod";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

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
  })
  .strict();

export type QuantDataReadiness = z.infer<typeof quantDataReadinessSchema>;

export function parseQuantDataReadiness(input: unknown): QuantDataReadiness {
  const parsed = quantDataReadinessSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid quant data readiness response.");
  return parsed.data;
}

export async function getQuantDataReadiness(
  fetcher: Fetcher = fetch,
): Promise<QuantDataReadiness> {
  const response = await fetcher("/api/quant/data-readiness", { cache: "no-store" });
  if (!response.ok) throw new Error("Quant data readiness is unavailable.");
  return parseQuantDataReadiness(await response.json());
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
