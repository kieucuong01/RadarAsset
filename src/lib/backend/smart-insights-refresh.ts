import type { TenantContext } from "@/lib/auth/tenant-context";
import { getPrisma } from "@/lib/db/prisma";

export type BriefingGenerationState = "idle" | "generating" | "failed" | "ready";

export type BriefingRefreshState = {
  state: BriefingGenerationState;
  requestVersion: number;
  errorCode: string | null;
};

type RefreshRow = {
  status: string;
  requestVersion: number;
  errorCode: string | null;
};

type RefreshReader = {
  smartInsightRefreshRequest: {
    findUnique(args: {
      where: { organizationId_userId: { organizationId: string; userId: string } };
      select: { status: true; requestVersion: true; errorCode: true };
    }): Promise<RefreshRow | null>;
  };
};

function publicState(row: RefreshRow | null): BriefingRefreshState {
  if (!row) return { state: "idle", requestVersion: 0, errorCode: null };
  const state: BriefingGenerationState =
    row.status === "queued" || row.status === "running"
      ? "generating"
      : row.status === "failed"
        ? "failed"
        : "ready";
  return { state, requestVersion: row.requestVersion, errorCode: row.errorCode };
}

export async function loadBriefingRefreshState(
  context: Pick<TenantContext, "organizationId" | "userId">,
  client: RefreshReader = getPrisma(),
): Promise<BriefingRefreshState> {
  const row = await client.smartInsightRefreshRequest.findUnique({
    where: {
      organizationId_userId: {
        organizationId: context.organizationId,
        userId: context.userId,
      },
    },
    select: { status: true, requestVersion: true, errorCode: true },
  });
  return publicState(row);
}

export async function enqueueBriefingRefresh(
  context: Pick<TenantContext, "organizationId" | "userId">,
  reason: "favorite_changed" | "portfolio_changed" | "manual" | "activation",
): Promise<BriefingRefreshState> {
  const prisma = getPrisma();
  const row = await prisma.$transaction(async (tx) => {
    const lockKey = `smart-insights:refresh:${context.organizationId}:${context.userId}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0)) IS NULL AS locked`;
    const current = await tx.smartInsightRefreshRequest.findUnique({
      where: {
        organizationId_userId: {
          organizationId: context.organizationId,
          userId: context.userId,
        },
      },
    });
    const now = new Date();
    if (!current) {
      return tx.smartInsightRefreshRequest.create({
        data: {
          organizationId: context.organizationId,
          userId: context.userId,
          status: "queued",
          reason,
          requestVersion: 1,
          requestedAt: now,
          availableAt: now,
        },
      });
    }
    const nextVersion = current.requestVersion + 1;
    const common = {
      reason,
      requestVersion: nextVersion,
      requestedAt: now,
      errorCode: null,
      finishedAt: null,
    };
    return tx.smartInsightRefreshRequest.update({
      where: { id: current.id },
      data:
        current.status === "running"
          ? common
          : {
              ...common,
              status: "queued",
              processingVersion: null,
              availableAt: now,
              startedAt: null,
              workerId: null,
              attemptCount: 0,
            },
    });
  });
  return publicState(row);
}
