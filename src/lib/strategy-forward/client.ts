import { z } from "zod";

const signalSchema = z
  .object({
    id: z.string(),
    symbol: z.string(),
    strategyCode: z.string(),
    strategyVersion: z.string(),
    signalType: z.enum(["buy", "sell"]),
    status: z.enum(["suggested", "reviewed", "executed", "dismissed"]),
    signalAt: z.string().datetime(),
    executionAt: z.string().datetime().nullable(),
    signalPrice: z.number().nullable(),
    reason: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();
const snapshotSchema = z
  .object({
    timestamp: z.string().datetime(),
    equity: z.number(),
    benchmarkEquity: z.number(),
    pnlExcludingContributions: z.number(),
    cumulativeContributions: z.number(),
    cumulativeFees: z.number(),
  })
  .strict();
export const forwardTestSchema = z
  .object({
    assignmentId: z.string(),
    portfolioId: z.string(),
    symbol: z.string(),
    strategy: z
      .object({ code: z.string(), version: z.string(), name: z.string(), kind: z.string() })
      .strict(),
    status: z.enum(["active", "paused", "evaluation_failed"]),
    activatedAt: z.string().datetime(),
    lastEvaluatedAt: z.string().datetime().nullable(),
    lastEvaluatedBarAt: z.string().datetime().nullable(),
    latestSignal: signalSchema.nullable(),
    snapshots: z.array(snapshotSchema).max(365),
  })
  .strict();
export type ForwardTest = z.infer<typeof forwardTestSchema>;

const notificationSchema = z
  .object({
    id: z.string(),
    assignmentId: z.string(),
    signalId: z.string(),
    type: z.enum(["strategy_buy", "strategy_sell"]),
    title: z.string().max(120),
    body: z.string().max(500),
    readAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();
const notificationPageSchema = z
  .object({
    items: z.array(notificationSchema).max(25),
    nextCursor: z.string().nullable(),
    unreadCount: z.number().int().nonnegative(),
  })
  .strict();
export type NotificationPage = z.infer<typeof notificationPageSchema>;

export async function getStrategyForwardTests(
  fetcher: typeof fetch = fetch,
): Promise<ForwardTest[]> {
  const response = await fetcher("/api/portfolio/strategy-forward-tests", { cache: "no-store" });
  if (!response.ok) throw new Error("Không thể tải forward test.");
  return z
    .array(forwardTestSchema)
    .max(100)
    .parse(await response.json());
}

export async function getNotifications(fetcher: typeof fetch = fetch): Promise<NotificationPage> {
  const response = await fetcher("/api/notifications", { cache: "no-store" });
  if (!response.ok)
    throw new Error(response.status === 401 ? "AUTH_REQUIRED" : "Không thể tải thông báo.");
  return notificationPageSchema.parse(await response.json());
}

export async function markNotificationReadClient(
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(`/api/notifications/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ read: true }),
  });
  if (!response.ok) throw new Error("Không thể cập nhật thông báo.");
}
