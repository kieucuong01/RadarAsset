import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma, resolveProviderInstrument } = vi.hoisted(() => ({
  resolveProviderInstrument: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    marketIngestionRequest: {
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => prisma }));
vi.mock("./provider-catalog", () => ({ resolveProviderInstrument }));

import { IngestionRateLimitError, requestMarketIngestion } from "./ingestion-requests";

const context = { userId: "user-a", organizationId: "org-a", role: "editor" as const };
const active = {
  id: "request-a",
  status: "queued",
  timeframe: "1d",
  attemptCount: 0,
  datasetVersionId: null,
  errorCode: null,
  createdAt: new Date("2026-08-11T00:00:00Z"),
  updatedAt: new Date("2026-08-11T00:00:00Z"),
  providerInstrument: {
    providerSymbol: "ETHUSDT",
    provider: { code: "binance-public" },
    asset: { symbol: "ETH", name: "Ethereum" },
  },
};

describe("tenant market ingestion request queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveProviderInstrument.mockResolvedValue({ id: "instrument-eth" });
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
      callback(prisma),
    );
    prisma.$queryRaw.mockResolvedValue([{ locked: true }]);
    prisma.marketIngestionRequest.count.mockResolvedValue(0);
  });

  it("returns the active request instead of creating a duplicate", async () => {
    prisma.marketIngestionRequest.findFirst.mockResolvedValue(active);

    await expect(
      requestMarketIngestion(context, {
        providerCode: "binance-public",
        providerSymbol: "ETHUSDT",
        timeframe: "1d",
      }),
    ).resolves.toMatchObject({ id: "request-a", created: false, symbol: "ETH" });
    expect(prisma.marketIngestionRequest.create).not.toHaveBeenCalled();
  });

  it("creates one tenant and user scoped request after rate-limit checks", async () => {
    prisma.marketIngestionRequest.findFirst.mockResolvedValue(null);
    prisma.marketIngestionRequest.create.mockResolvedValue(active);

    await expect(
      requestMarketIngestion(context, {
        providerCode: "binance-public",
        providerSymbol: "ETHUSDT",
        timeframe: "1d",
      }),
    ).resolves.toMatchObject({ id: "request-a", created: true });
    expect(prisma.marketIngestionRequest.count).toHaveBeenNthCalledWith(1, {
      where: { organizationId: "org-a", userId: "user-a", status: { in: ["queued", "running"] } },
    });
    expect(prisma.marketIngestionRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-a",
          userId: "user-a",
          providerInstrumentId: "instrument-eth",
          timeframe: "1d",
        }),
      }),
    );
  });

  it("fails closed when the per-user active request limit is reached", async () => {
    prisma.marketIngestionRequest.findFirst.mockResolvedValue(null);
    prisma.marketIngestionRequest.count.mockResolvedValueOnce(20).mockResolvedValueOnce(20);

    await expect(
      requestMarketIngestion(context, {
        providerCode: "binance-public",
        providerSymbol: "ETHUSDT",
        timeframe: "1d",
      }),
    ).rejects.toBeInstanceOf(IngestionRateLimitError);
    expect(prisma.marketIngestionRequest.create).not.toHaveBeenCalled();
  });
});
