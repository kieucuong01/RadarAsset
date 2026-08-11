import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: { providerInstrument: { findMany: vi.fn(), findFirst: vi.fn() } },
}));

vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => prisma }));

import { resolveProviderInstrument, searchProviderInstruments } from "./provider-catalog";

const row = {
  id: "instrument-vnm",
  providerSymbol: "VNM",
  metadata: {},
  provider: { code: "vnstock-vci-free", status: "active" },
  asset: {
    id: "asset-vnm",
    symbol: "VNM",
    name: "Vinamilk",
    market: "vn_equity",
    venue: "HOSE",
    currency: "VND",
    datasets: [
      {
        timeframe: "1d",
        versions: [{ id: "dataset-vnm-1d" }],
      },
    ],
  },
};

describe("approved provider instrument catalog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("searches only active approved provider instruments with a bounded limit", async () => {
    prisma.providerInstrument.findMany.mockResolvedValue([row]);

    await expect(searchProviderInstruments({ q: " vnm ", limit: 500 })).resolves.toEqual({
      items: [
        expect.objectContaining({
          providerCode: "vnstock-vci-free",
          providerSymbol: "VNM",
          symbol: "VNM",
          market: "vn_equity",
          supportedTimeframes: ["1d", "1h"],
        }),
      ],
    });
    expect(prisma.providerInstrument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider: {
            status: "active",
            code: { in: ["binance-public", "msn-via-vnstock", "vnstock-vci-free"] },
          },
          OR: [
            { providerSymbol: { contains: "VNM", mode: "insensitive" } },
            { asset: { symbol: { contains: "VNM", mode: "insensitive" } } },
            { asset: { name: { startsWith: "VNM", mode: "insensitive" } } },
          ],
        }),
        take: 500,
      }),
    );
  });

  it("resolves one exact approved active provider instrument", async () => {
    prisma.providerInstrument.findFirst.mockResolvedValue(row);

    await expect(resolveProviderInstrument("vnstock-vci-free", "vnm")).resolves.toMatchObject({
      id: "instrument-vnm",
      assetId: "asset-vnm",
      symbol: "VNM",
    });
    expect(prisma.providerInstrument.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          providerSymbol: "VNM",
          provider: { code: "vnstock-vci-free", status: "active" },
        },
      }),
    );
  });

  it("rejects an unapproved provider before querying storage", async () => {
    await expect(resolveProviderInstrument("user-url", "BTC")).rejects.toThrow("approved");
    expect(prisma.providerInstrument.findFirst).not.toHaveBeenCalled();
  });

  it("ranks instruments with ready datasets before catalog-only matches", async () => {
    prisma.providerInstrument.findMany.mockResolvedValue([
      {
        ...row,
        id: "instrument-aaa",
        providerSymbol: "AAA",
        asset: { ...row.asset, id: "asset-aaa", symbol: "AAA", datasets: [] },
      },
      row,
    ]);

    await expect(searchProviderInstruments({ q: "", limit: 1 })).resolves.toEqual({
      items: [expect.objectContaining({ symbol: "VNM" })],
    });
    expect(prisma.providerInstrument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 500,
        include: expect.objectContaining({
          asset: expect.objectContaining({
            include: expect.objectContaining({
              datasets: expect.objectContaining({
                select: expect.objectContaining({
                  versions: expect.objectContaining({
                    where: { isActive: true, qualityStatus: { in: ["passed", "warning"] } },
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    );
  });

  it("keeps ready Vietnam equities visible ahead of ready crypto in the default picker", async () => {
    prisma.providerInstrument.findMany.mockResolvedValue([
      {
        ...row,
        id: "instrument-btc",
        providerSymbol: "BTCUSDT",
        provider: { code: "binance-public", status: "active" },
        asset: {
          ...row.asset,
          id: "asset-btc",
          symbol: "BTC",
          name: "Bitcoin / Tether",
          market: "crypto_spot",
          currency: "USDT",
          datasets: [{ timeframe: "1d", versions: [{ id: "dataset-btc", rowCount: 730 }] }],
        },
      },
      row,
    ]);

    await expect(searchProviderInstruments({ q: "", limit: 2 })).resolves.toMatchObject({
      items: [{ symbol: "VNM" }, { symbol: "BTC" }],
    });
  });
});
