import { createHash, randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

import { auth } from "@/lib/auth";
import { createPortfolioQuantRun } from "@/lib/backend/quant-runs";
import { loadQuantAssetCatalog } from "@/lib/backend/quant-assets";
import { getPrisma } from "@/lib/db/prisma";

const prisma = getPrisma();
const suffix = randomUUID().slice(0, 8);
const email = `quant-e2e-${suffix}@example.test`;
const password = "Quant-E2E!2026";
let userId: string | null = null;
let organizationId: string | null = null;

function sessionCookie(response: Response): string {
  const header = response.headers.get("set-cookie");
  if (!header) throw new Error("Better Auth did not return a session cookie.");
  return header.split(";", 1)[0] ?? "";
}

function checksum(symbol: string) {
  return createHash("sha256").update(`quant-e2e:${symbol}`).digest("hex");
}

async function seedAsset(input: {
  symbol: string;
  market: string;
  currency: string;
  venue: string;
  providerId: string;
}) {
  const asset = await prisma.asset.create({
    data: {
      symbol: `E2E${suffix.toUpperCase()}${input.symbol}`,
      canonicalKey: `test_fixture:${suffix}:${input.symbol}`,
      name: `E2E ${input.symbol}`,
      assetClass: input.market === "vn_equity" ? "equity" : "spot",
      market: input.market,
      venue: input.venue,
      timezone: input.market === "vn_equity" ? "Asia/Ho_Chi_Minh" : "UTC",
      maxLeverage: input.market === "vn_equity" ? 2 : 1,
      currency: input.currency,
      provider: "test_fixture",
      providerSymbol: input.symbol,
      listingStatus: "active",
    },
  });
  const instrument = await prisma.providerInstrument.create({
    data: {
      providerId: input.providerId,
      assetId: asset.id,
      providerSymbol: input.symbol,
      metadata: { mode: "test_fixture" },
    },
  });
  await prisma.assetListingPeriod.create({
    data: {
      assetId: asset.id,
      providerInstrumentId: instrument.id,
      providerCode: `quant-e2e-${suffix}`,
      providerSymbol: input.symbol,
      venue: input.venue,
      status: "active",
      validFrom: new Date("2023-01-01T00:00:00.000Z"),
      metadata: { mode: "test_fixture" },
    },
  });
  const dataset = await prisma.dataset.create({
    data: { assetId: asset.id, timeframe: "1d", adjustmentPolicy: "raw" },
  });
  const version = await prisma.datasetVersion.create({
    data: {
      datasetId: dataset.id,
      providerId: input.providerId,
      version: 1,
      checksum: checksum(input.symbol),
      coverageStart: new Date("2024-01-01T00:00:00.000Z"),
      coverageEnd: new Date("2025-12-31T00:00:00.000Z"),
      rowCount: 2,
      missingBarCount: 0,
      qualityStatus: "passed",
      qualitySummary: { mode: "test_fixture" },
      sourceMetadata: { mode: "test_fixture", calendarVersion: "test-fixture-v1" },
      isActive: true,
      bars: {
        create: [
          {
            ts: new Date("2024-01-01T00:00:00.000Z"),
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1000,
            source: "test_fixture",
          },
          {
            ts: new Date("2025-12-31T00:00:00.000Z"),
            open: 110,
            high: 111,
            low: 109,
            close: 110,
            volume: 1000,
            source: "test_fixture",
          },
        ],
      },
    },
  });
  return { asset, version };
}

describe("authenticated Quant fixture boundary", () => {
  afterAll(async () => {
    if (userId) {
      await prisma.organization.deleteMany({ where: { memberships: { some: { userId } } } });
      await prisma.appUser.deleteMany({ where: { id: userId } });
    }
    await prisma.asset.deleteMany({
      where: { canonicalKey: { startsWith: `test_fixture:${suffix}:` } },
    });
    await prisma.dataProvider.deleteMany({ where: { code: `quant-e2e-${suffix}` } });
    await prisma.strategyVersion.deleteMany({
      where: { code: "ma_crossover", version: "1.0.0" },
    });
    await prisma.$disconnect();
  });

  it("signs in with a real cookie and creates an isolated multi-market Quant run", async () => {
    const unrelatedOrganization = await prisma.organization.create({
      data: { name: `Unrelated ${suffix}`, slug: `unrelated-${suffix}` },
    });
    const signUpResponse = await auth.api.signUpEmail({
      body: { email, password, name: "Quant E2E" },
      asResponse: true,
    });
    expect(signUpResponse.status).toBe(200);
    const cookie = sessionCookie(signUpResponse);
    const headers = new Headers({ cookie });
    const session = await auth.api.getSession({ headers });
    userId = session?.user.id ?? null;
    expect(userId).not.toBeNull();

    const organization = await auth.api.createOrganization({
      headers,
      body: { name: "Quant E2E Organization", slug: `quant-e2e-${suffix}` },
    });
    organizationId = organization?.id ?? null;
    expect(organizationId).not.toBeNull();
    await auth.api.setActiveOrganization({ headers, body: { organizationId: organizationId! } });

    const provider = await prisma.dataProvider.create({
      data: { code: `quant-e2e-${suffix}`, name: "Quant E2E Test Fixture" },
    });
    const seeded = await Promise.all([
      seedAsset({
        symbol: "VN",
        market: "vn_equity",
        currency: "VND",
        venue: "HOSE",
        providerId: provider.id,
      }),
      seedAsset({
        symbol: "BTC",
        market: "crypto_spot",
        currency: "USDT",
        venue: "BINANCE",
        providerId: provider.id,
      }),
      seedAsset({
        symbol: "XAU",
        market: "metal_spot",
        currency: "USD",
        venue: "OTC",
        providerId: provider.id,
      }),
    ]);
    const strategy = await prisma.strategyVersion.create({
      data: {
        code: "ma_crossover",
        version: "1.0.0",
        name: "Quant E2E MA",
        category: "rule_based",
        parameterSchema: {} as Prisma.InputJsonValue,
        defaultParameters: { fastPeriod: 2, slowPeriod: 3 },
        supportedMarkets: ["vn_equity", "crypto_spot", "metal_spot"],
        supportedTimeframes: ["1d"],
        implementationHash: "e".repeat(64),
      },
    });

    const catalog = await loadQuantAssetCatalog({
      q: `E2E${suffix.toUpperCase()}`,
      timeframe: "1d",
      from: "2024-01-01",
      to: "2025-12-31",
    });
    expect(catalog.items).toHaveLength(3);
    expect(catalog.items.every((item) => item.backtestable)).toBe(true);

    const run = await createPortfolioQuantRun(
      { organizationId: organizationId!, userId: userId!, role: "owner" },
      {
        timeframe: "1d",
        from: "2024-01-01",
        to: "2025-12-31",
        totalCapital: 100_000,
        allocationMode: "custom",
        feeBps: 10,
        slippageBps: 5,
        assumptions: {
          cashAllocationBps: 1,
          rebalanceFrequency: "none",
          monthlyContribution: 0,
          dividendMode: "exclude",
          fxPolicy: "normalized_returns",
          baseCurrency: "USD",
          marketCosts: {
            vn_equity: { commissionBps: 10, sellTaxBps: 10, slippageBps: 5, financingBpsAnnual: 0 },
            crypto_spot: {
              commissionBps: 10,
              sellTaxBps: 0,
              slippageBps: 5,
              financingBpsAnnual: 0,
            },
            metal_spot: { commissionBps: 10, sellTaxBps: 0, slippageBps: 5, financingBpsAnnual: 0 },
          },
        },
        legs: seeded.map(({ asset }, index) => ({
          symbol: asset.symbol,
          allocationBps: index < 2 ? 3333 : 3333,
          leverage: 1,
          strategyCode: strategy.code,
          strategyVersion: strategy.version,
          strategyParameters: { fastPeriod: 2, slowPeriod: 3 },
        })),
      },
    );
    expect(run).toMatchObject({ status: "queued", progress: 0 });
    expect(run.legs).toHaveLength(3);
    expect(run.legs.every((leg) => leg.datasetVersionId)).toBe(true);

    await prisma.organization.delete({ where: { id: organizationId! } });
    organizationId = null;
    await expect(
      prisma.organization.findUnique({ where: { id: unrelatedOrganization.id } }),
    ).resolves.toBeTruthy();
    await prisma.organization.delete({ where: { id: unrelatedOrganization.id } });
  });
});
