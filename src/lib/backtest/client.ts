import { z } from "zod";

import type { BacktestSubmission } from "./contracts";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const equityPointSchema = z
  .object({
    timestamp: z.string(),
    cash: z.number(),
    marketValue: z.number(),
    grossExposure: z.number().nonnegative(),
    equity: z.number(),
  })
  .strict();

const drawdownPointSchema = z
  .object({
    timestamp: z.string(),
    drawdownPct: z.number().nonpositive(),
  })
  .strict();

const tradeSchema = z
  .object({
    asset: z.enum(["FPT", "BTC", "XAU"]),
    side: z.literal("long"),
    entrySignalAt: z.string(),
    entryAt: z.string(),
    exitSignalAt: z.string(),
    exitAt: z.string(),
    entryPrice: z.number().positive(),
    exitPrice: z.number().positive(),
    quantity: z.number().positive(),
    fees: z.number().nonnegative(),
    slippageCost: z.number().nonnegative(),
    realizedPnl: z.number(),
    returnPct: z.number(),
    barsHeld: z.number().int().nonnegative(),
    exitReason: z.literal("signal"),
  })
  .strict();

const artifactBase = {
  id: z.string(),
  checksum: z.string().length(64),
  rowCount: z.number().int().nonnegative(),
  schemaVersion: z.literal(1),
};

const artifactSchema = z.discriminatedUnion("kind", [
  z
    .object({ ...artifactBase, kind: z.literal("equity"), payload: z.array(equityPointSchema) })
    .strict(),
  z
    .object({ ...artifactBase, kind: z.literal("drawdown"), payload: z.array(drawdownPointSchema) })
    .strict(),
  z.object({ ...artifactBase, kind: z.literal("trades"), payload: z.array(tradeSchema) }).strict(),
  z
    .object({
      ...artifactBase,
      kind: z.literal("manifest"),
      payload: z.record(z.string(), z.unknown()),
    })
    .strict(),
]);

const strategyCatalogItemSchema = z
  .object({
    code: z.string(),
    version: z.string(),
    name: z.string(),
    category: z.string(),
    status: z.string(),
    parameterSchema: z.array(
      z
        .object({
          name: z.string(),
          label: z.string(),
          type: z.enum(["integer", "number"]),
          min: z.number(),
          max: z.number(),
          default: z.number(),
        })
        .strict(),
    ),
    defaultParameters: z.record(z.string(), z.number()),
    supportedMarkets: z.array(z.string()),
    supportedTimeframes: z.array(z.enum(["1d", "1h"])),
    implementationHash: z.string().length(64),
    sourceAttribution: z.string().nullable(),
    modificationNotice: z.string().nullable(),
  })
  .strict();

export type StrategyCatalogItem = z.infer<typeof strategyCatalogItemSchema>;

const backtestRunSchema = z
  .object({
    id: z.string(),
    strategyName: z.string(),
    strategyCode: z.string(),
    strategyVersion: z.string(),
    status: z.enum(["queued", "running", "succeeded", "failed"]),
    timeframe: z.enum(["1d", "1h"]),
    progress: z.number().int().min(0).max(100),
    strategyHash: z.string().nullable(),
    datasetVersionIds: z.array(z.string()),
    engineVersion: z.string(),
    parameters: z.record(z.string(), z.unknown()),
    metrics: z.record(z.string(), z.unknown()).nullable(),
    errorMessage: z.string().nullable(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    createdAt: z.string(),
    artifacts: z.array(artifactSchema),
  })
  .strict();

export type BacktestRun = z.infer<typeof backtestRunSchema>;
export type BacktestArtifact = BacktestRun["artifacts"][number];

export function parseBacktestRun(input: unknown): BacktestRun {
  const parsed = backtestRunSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Invalid backtest response.");
  }
  return parsed.data;
}

export function parseStrategyCatalog(input: unknown): StrategyCatalogItem[] {
  const parsed = z.array(strategyCatalogItemSchema).safeParse(input);
  if (!parsed.success) {
    throw new Error("Invalid strategy catalog response.");
  }
  return parsed.data;
}

export async function getStrategyCatalog(fetcher: Fetcher = fetch): Promise<StrategyCatalogItem[]> {
  const response = await fetcher("/api/quant/strategies", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Strategy catalog is unavailable.");
  }
  return parseStrategyCatalog(await response.json());
}

export function isActiveRun(status: BacktestRun["status"]) {
  return status === "queued" || status === "running";
}

export async function submitBacktest(
  submission: BacktestSubmission,
  fetcher: Fetcher = fetch,
): Promise<BacktestRun> {
  const response = await fetcher("/api/quant/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(submission),
  });
  if (response.status !== 202) {
    throw new Error("Backtest submission failed.");
  }
  return parseBacktestRun(await response.json());
}

export async function getBacktestRun(
  id: string,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<BacktestRun> {
  const response = await fetcher(`/api/quant/runs/${encodeURIComponent(id)}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error("Backtest status is unavailable.");
  }
  return parseBacktestRun(await response.json());
}
