import type { TenantContext } from "@/lib/auth/tenant-context";
import { getPrisma } from "@/lib/db/prisma";

import { resolveProviderInstrument } from "./provider-catalog";

const ACTIVE_STATUSES = ["queued", "running"] as const;

export class IngestionRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestionRateLimitError";
  }
}

type RequestInput = {
  providerCode: string;
  providerSymbol: string;
  timeframe: "1d" | "1h";
};

const include = {
  providerInstrument: {
    include: { provider: true, asset: true },
  },
} as const;

function response(
  row: {
    id: string;
    status: string;
    timeframe: string;
    attemptCount: number;
    datasetVersionId: string | null;
    errorCode: string | null;
    createdAt: Date;
    updatedAt: Date;
    providerInstrument: {
      providerSymbol: string;
      provider: { code: string };
      asset: { symbol: string; name: string };
    };
  },
  created: boolean,
) {
  return {
    id: row.id,
    created,
    providerCode: row.providerInstrument.provider.code,
    providerSymbol: row.providerInstrument.providerSymbol,
    symbol: row.providerInstrument.asset.symbol,
    name: row.providerInstrument.asset.name,
    timeframe: row.timeframe === "1h" ? ("1h" as const) : ("1d" as const),
    status:
      row.status === "running" || row.status === "succeeded" || row.status === "failed"
        ? row.status
        : ("queued" as const),
    attemptCount: row.attemptCount,
    datasetVersionId: row.datasetVersionId,
    errorCode: row.errorCode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function requestMarketIngestion(context: TenantContext, input: RequestInput) {
  const instrument = await resolveProviderInstrument(input.providerCode, input.providerSymbol);
  const prisma = getPrisma();
  const execute = () =>
    prisma.$transaction(
      async (tx) => {
        const lockKey = [
          "market-ingestion-request",
          context.organizationId,
          context.userId,
          instrument.id,
          input.timeframe,
        ].join(":");
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0)) IS NULL AS locked`;
        const active = await tx.marketIngestionRequest.findFirst({
          where: {
            organizationId: context.organizationId,
            userId: context.userId,
            providerInstrumentId: instrument.id,
            timeframe: input.timeframe,
            status: { in: [...ACTIVE_STATUSES] },
          },
          include,
          orderBy: { createdAt: "desc" },
        });
        if (active) return response(active, false);

        const userCount = await tx.marketIngestionRequest.count({
          where: {
            organizationId: context.organizationId,
            userId: context.userId,
            status: { in: [...ACTIVE_STATUSES] },
          },
        });
        const organizationCount = await tx.marketIngestionRequest.count({
          where: {
            organizationId: context.organizationId,
            status: { in: [...ACTIVE_STATUSES] },
          },
        });
        if (userCount >= 20 || organizationCount >= 100) {
          throw new IngestionRateLimitError("Too many active market ingestion requests.");
        }
        const created = await tx.marketIngestionRequest.create({
          data: {
            organizationId: context.organizationId,
            userId: context.userId,
            providerInstrumentId: instrument.id,
            timeframe: input.timeframe,
            status: "queued",
          },
          include,
        });
        return response(created, true);
      },
      { isolationLevel: "Serializable" },
    );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await execute();
    } catch (error) {
      const retryable =
        error !== null && typeof error === "object" && "code" in error && error.code === "P2034";
      if (!retryable || attempt === 2) throw error;
    }
  }
  throw new Error("Market ingestion request retry budget was exhausted.");
}

export async function listMarketIngestionRequests(context: TenantContext) {
  const rows = await getPrisma().marketIngestionRequest.findMany({
    where: { organizationId: context.organizationId, userId: context.userId },
    include,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((row) => response(row, false));
}
