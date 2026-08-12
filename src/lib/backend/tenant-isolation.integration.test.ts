import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getPrisma } from "@/lib/db/prisma";
import type { TenantContext } from "@/lib/auth/tenant-context";

import {
  createPortfolioTransaction,
  getQuantRun,
  listQuantRuns,
  loadPortfolioResponse,
  loadWatchlist,
} from "./db";
import { resetDemoIdentity } from "./seed-safety";
import { listMarketIngestionRequests, requestMarketIngestion } from "./ingestion-requests";

const prisma = getPrisma();
const suffix = randomUUID().slice(0, 8);
const fixtures = {
  userAId: randomUUID(),
  userBId: randomUUID(),
  organizationAId: randomUUID(),
  organizationBId: randomUUID(),
  assetId: randomUUID(),
  assetSymbol: `ISO${suffix.toUpperCase()}`,
  quantRunAId: "",
  quantRunBId: "",
};

const contextA: TenantContext = {
  userId: fixtures.userAId,
  organizationId: fixtures.organizationAId,
  role: "editor",
};
const contextB: TenantContext = {
  userId: fixtures.userBId,
  organizationId: fixtures.organizationBId,
  role: "editor",
};

describe("database tenant isolation", () => {
  beforeAll(async () => {
    await prisma.appUser.createMany({
      data: [
        {
          id: fixtures.userAId,
          email: `isolation-a-${suffix}@example.test`,
          name: "Isolation A",
        },
        {
          id: fixtures.userBId,
          email: `isolation-b-${suffix}@example.test`,
          name: "Isolation B",
        },
      ],
    });
    await prisma.organization.createMany({
      data: [
        {
          id: fixtures.organizationAId,
          name: "Isolation A",
          slug: `isolation-a-${suffix}`,
        },
        {
          id: fixtures.organizationBId,
          name: "Isolation B",
          slug: `isolation-b-${suffix}`,
        },
      ],
    });
    await prisma.membership.createMany({
      data: [
        {
          organizationId: fixtures.organizationAId,
          userId: fixtures.userAId,
          role: "editor",
        },
        {
          organizationId: fixtures.organizationBId,
          userId: fixtures.userBId,
          role: "editor",
        },
      ],
    });
    await prisma.portfolio.createMany({
      data: [
        {
          organizationId: fixtures.organizationAId,
          userId: fixtures.userAId,
          name: "Main Portfolio",
          baseCurrency: "USD",
        },
        {
          organizationId: fixtures.organizationBId,
          userId: fixtures.userBId,
          name: "Main Portfolio",
          baseCurrency: "USD",
        },
      ],
    });
    await prisma.asset.create({
      data: {
        id: fixtures.assetId,
        symbol: fixtures.assetSymbol,
        name: "Isolation Asset",
        assetClass: "crypto",
        market: "crypto_spot",
        currency: "USD",
        provider: "integration-test",
      },
    });
    const [runA, runB] = await Promise.all([
      prisma.quantRun.create({
        data: {
          organizationId: fixtures.organizationAId,
          userId: fixtures.userAId,
          strategyName: "Organization A strategy",
        },
      }),
      prisma.quantRun.create({
        data: {
          organizationId: fixtures.organizationBId,
          userId: fixtures.userBId,
          strategyName: "Organization B strategy",
        },
      }),
    ]);
    fixtures.quantRunAId = runA.id;
    fixtures.quantRunBId = runB.id;
    await prisma.quantRunArtifact.create({
      data: {
        organizationId: fixtures.organizationBId,
        quantRunId: runB.id,
        kind: "manifest",
        checksum: "b".repeat(64),
        payload: { tenant: "organization-b" },
        rowCount: 1,
      },
    });

    await prisma.watchlistItem.createMany({
      data: [
        {
          organizationId: fixtures.organizationAId,
          userId: fixtures.userAId,
          assetId: fixtures.assetId,
        },
        {
          organizationId: fixtures.organizationBId,
          userId: fixtures.userBId,
          assetId: fixtures.assetId,
        },
      ],
    });
    const [researchA, researchB] = await Promise.all([
      prisma.researchRun.create({
        data: {
          organizationId: fixtures.organizationAId,
          userId: fixtures.userAId,
          assetId: fixtures.assetId,
          source: "integration-test",
          kind: "sentiment",
          status: "succeeded",
        },
      }),
      prisma.researchRun.create({
        data: {
          organizationId: fixtures.organizationBId,
          userId: fixtures.userBId,
          assetId: fixtures.assetId,
          source: "integration-test",
          kind: "sentiment",
          status: "succeeded",
        },
      }),
    ]);
    await prisma.aiInsight.createMany({
      data: [
        {
          assetId: fixtures.assetId,
          researchRunId: researchA.id,
          source: "integration-test",
          title: "Organization A private sentiment",
          summary: "A-only research",
          sentiment: "bull",
          publishedAt: new Date("2026-08-10T00:00:00.000Z"),
        },
        {
          assetId: fixtures.assetId,
          researchRunId: researchB.id,
          source: "integration-test",
          title: "Organization B private sentiment",
          summary: "B-only research",
          sentiment: "bear",
          publishedAt: new Date("2026-08-10T00:01:00.000Z"),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: {
        id: {
          in: [fixtures.organizationAId, fixtures.organizationBId],
        },
      },
    });
    await prisma.asset.deleteMany({ where: { id: fixtures.assetId } });
    await prisma.appUser.deleteMany({
      where: { id: { in: [fixtures.userAId, fixtures.userBId] } },
    });
    await prisma.$disconnect();
  });

  it("returns only the active organization's portfolio and quant runs", async () => {
    const [portfolioA, runsA, portfolioB, runsB] = await Promise.all([
      loadPortfolioResponse(contextA),
      listQuantRuns(contextA),
      loadPortfolioResponse(contextB),
      listQuantRuns(contextB),
    ]);

    expect(portfolioA.portfolioId).not.toBe(portfolioB.portfolioId);
    expect(runsA.map((run) => run.id)).toEqual([fixtures.quantRunAId]);
    expect(runsB.map((run) => run.id)).toEqual([fixtures.quantRunBId]);
  });

  it("persists an immutable strategy version link on a tenant quant run", async () => {
    const strategyId = randomUUID();
    try {
      await prisma.$executeRaw`
        INSERT INTO "strategy_versions" (
          "id", "code", "version", "name", "category", "status",
          "parameter_schema", "default_parameters", "supported_markets",
          "supported_timeframes", "implementation_hash", "created_at"
        ) VALUES (
          ${strategyId}::uuid, 'ma_crossover', '1.0.0', 'MA Crossover', 'rule_based', 'active',
          '{"type":"object"}'::jsonb, '{"fastPeriod":5,"slowPeriod":20}'::jsonb,
          '["vn_equity","crypto_spot","metal_spot"]'::jsonb, '["1d","1h"]'::jsonb,
          ${"a".repeat(64)}, NOW()
        )
      `;
      await prisma.$executeRaw`
        UPDATE "quant_runs"
        SET "strategy_version_id" = ${strategyId}::uuid
        WHERE "id" = ${fixtures.quantRunAId}::uuid
          AND "organization_id" = ${fixtures.organizationAId}::uuid
      `;

      const linked = await prisma.$queryRaw<Array<{ strategy_version_id: string | null }>>`
        SELECT "strategy_version_id"
        FROM "quant_runs"
        WHERE "id" = ${fixtures.quantRunAId}::uuid
      `;
      expect(linked[0]?.strategy_version_id).toBe(strategyId);
    } finally {
      await prisma.$executeRaw`
        UPDATE "quant_runs"
        SET "strategy_version_id" = NULL
        WHERE "id" = ${fixtures.quantRunAId}::uuid
      `;
      await prisma.$executeRaw`
        DELETE FROM "strategy_versions"
        WHERE "id" = ${strategyId}::uuid
      `;
    }
  });

  it("cascades tenant run legs and preserves referenced immutable versions", async () => {
    const providerId = randomUUID();
    const datasetId = randomUUID();
    const datasetVersionId = randomUUID();
    const strategyVersionId = randomUUID();
    const runId = randomUUID();
    let legId: string | null = null;

    try {
      await prisma.dataProvider.create({
        data: {
          id: providerId,
          code: `isolation-provider-${suffix}`,
          name: "Isolation Provider",
        },
      });
      await prisma.dataset.create({
        data: {
          id: datasetId,
          assetId: fixtures.assetId,
          timeframe: "1d",
          adjustmentPolicy: `integration-${suffix}`,
        },
      });
      await prisma.datasetVersion.create({
        data: {
          id: datasetVersionId,
          datasetId,
          providerId,
          version: 1,
          checksum: "c".repeat(64),
          coverageStart: new Date("2025-01-01T00:00:00.000Z"),
          coverageEnd: new Date("2026-01-01T00:00:00.000Z"),
          rowCount: 250,
          isActive: true,
        },
      });
      await prisma.strategyVersion.create({
        data: {
          id: strategyVersionId,
          code: `integration_ma_${suffix}`,
          version: "1.0.0",
          name: "Integration MA",
          category: "rule_based",
          parameterSchema: {},
          defaultParameters: {},
          supportedMarkets: ["vn_equity"],
          supportedTimeframes: ["1d"],
          implementationHash: "d".repeat(64),
        },
      });
      await prisma.quantRun.create({
        data: {
          id: runId,
          organizationId: fixtures.organizationAId,
          userId: fixtures.userAId,
          strategyName: "Portfolio backtest",
        },
      });
      const leg = await prisma.quantRunLeg.create({
        data: {
          quantRunId: runId,
          assetId: fixtures.assetId,
          datasetVersionId,
          strategyVersionId,
          symbolSnapshot: fixtures.assetSymbol,
          marketSnapshot: "vn_equity",
          currencySnapshot: "USD",
          allocationBps: 10_000,
          initialNotional: "100000",
          leverage: "1",
          parameters: {},
          implementationHash: "d".repeat(64),
        },
      });
      legId = leg.id;
      await prisma.quantRunArtifact.create({
        data: {
          organizationId: fixtures.organizationAId,
          quantRunId: runId,
          quantRunLegId: leg.id,
          scopeKey: `leg:${leg.id}`,
          kind: "manifest",
          checksum: "a".repeat(64),
          payload: {},
        },
      });

      await prisma.quantRun.delete({ where: { id: runId } });

      await expect(prisma.quantRunLeg.findUnique({ where: { id: leg.id } })).resolves.toBeNull();
      await expect(
        prisma.datasetVersion.findUnique({ where: { id: datasetVersionId } }),
      ).resolves.not.toBeNull();
      await expect(
        prisma.strategyVersion.findUnique({ where: { id: strategyVersionId } }),
      ).resolves.not.toBeNull();
    } finally {
      await prisma.quantRun.deleteMany({ where: { id: runId } });
      if (legId) await prisma.quantRunLeg.deleteMany({ where: { id: legId } });
      await prisma.dataset.deleteMany({ where: { id: datasetId } });
      await prisma.dataProvider.deleteMany({ where: { id: providerId } });
      await prisma.strategyVersion.deleteMany({ where: { id: strategyVersionId } });
    }
  });

  it("hides another organization's quant id like a random id", async () => {
    const ownRun = await getQuantRun(contextB, fixtures.quantRunBId);
    expect(ownRun.artifacts).toEqual([
      expect.objectContaining({ kind: "manifest", checksum: "b".repeat(64) }),
    ]);
    await expect(getQuantRun(contextA, fixtures.quantRunBId)).rejects.toThrow(
      "Quant run not found.",
    );
    await expect(getQuantRun(contextA, randomUUID())).rejects.toThrow("Quant run not found.");
  });

  it("keeps watchlist sentiment inside the active organization", async () => {
    const [watchlistA, watchlistB] = await Promise.all([
      loadWatchlist(contextA),
      loadWatchlist(contextB),
    ]);

    expect(watchlistA).toEqual([
      expect.objectContaining({ sym: fixtures.assetSymbol, sentiment: "bull" }),
    ]);
    expect(watchlistB).toEqual([
      expect.objectContaining({ sym: fixtures.assetSymbol, sentiment: "bear" }),
    ]);
  });

  it("isolates ingestion requests for the same provider instrument by tenant", async () => {
    let providerId = "";
    let createdProvider = false;
    const instrumentId = randomUUID();
    try {
      const existingProvider = await prisma.dataProvider.findUnique({
        where: { code: "binance-public" },
      });
      if (existingProvider) {
        providerId = existingProvider.id;
      } else {
        providerId = randomUUID();
        createdProvider = true;
        await prisma.dataProvider.create({
          data: {
            id: providerId,
            code: "binance-public",
            name: "Binance Public Spot",
            status: "active",
          },
        });
      }
      await prisma.providerInstrument.create({
        data: {
          id: instrumentId,
          providerId,
          assetId: fixtures.assetId,
          providerSymbol: `${fixtures.assetSymbol}USDT`,
        },
      });

      const [requestA, requestB] = await Promise.all([
        requestMarketIngestion(contextA, {
          providerCode: "binance-public",
          providerSymbol: `${fixtures.assetSymbol}USDT`,
          timeframe: "1h",
        }),
        requestMarketIngestion(contextB, {
          providerCode: "binance-public",
          providerSymbol: `${fixtures.assetSymbol}USDT`,
          timeframe: "1h",
        }),
      ]);
      const [visibleA, visibleB] = await Promise.all([
        listMarketIngestionRequests(contextA),
        listMarketIngestionRequests(contextB),
      ]);

      expect(requestA.id).not.toBe(requestB.id);
      expect(visibleA.map((item) => item.id)).toContain(requestA.id);
      expect(visibleA.map((item) => item.id)).not.toContain(requestB.id);
      expect(visibleB.map((item) => item.id)).toContain(requestB.id);
      expect(visibleB.map((item) => item.id)).not.toContain(requestA.id);
    } finally {
      await prisma.marketIngestionRequest.deleteMany({
        where: { providerInstrumentId: instrumentId },
      });
      await prisma.providerInstrument.deleteMany({ where: { id: instrumentId } });
      if (createdProvider) await prisma.dataProvider.deleteMany({ where: { id: providerId } });
    }
  });

  it("resets a named demo identity without deleting another tenant", async () => {
    const demoUserId = randomUUID();
    const demoOrganizationId = randomUUID();
    const demoEmail = `seed-demo-${suffix}@example.test`;
    const demoSlug = `seed-demo-${suffix}`;
    await prisma.appUser.create({
      data: { id: demoUserId, email: demoEmail, name: "Seed Demo" },
    });
    await prisma.organization.create({
      data: {
        id: demoOrganizationId,
        name: "Seed Demo",
        slug: demoSlug,
        memberships: {
          create: { userId: demoUserId, role: "owner" },
        },
        portfolios: {
          create: {
            userId: demoUserId,
            name: "Main Portfolio",
            baseCurrency: "USD",
          },
        },
      },
    });

    await resetDemoIdentity(prisma, {
      email: demoEmail,
      organizationSlug: demoSlug,
    });

    const [otherTenant, demoTenant, demoUser] = await Promise.all([
      prisma.organization.findUnique({ where: { id: fixtures.organizationAId } }),
      prisma.organization.findUnique({ where: { id: demoOrganizationId } }),
      prisma.appUser.findUnique({ where: { id: demoUserId } }),
    ]);
    expect(otherTenant).not.toBeNull();
    expect(demoTenant).toBeNull();
    expect(demoUser).toBeNull();
  });

  it("refuses to reset a reserved demo slug owned by another user", async () => {
    const ownerId = randomUUID();
    const demoUserId = randomUUID();
    const organizationId = randomUUID();
    const demoEmail = `collision-demo-${suffix}@example.test`;
    const demoSlug = `collision-demo-${suffix}`;
    try {
      await prisma.appUser.createMany({
        data: [
          { id: ownerId, email: `collision-owner-${suffix}@example.test`, name: "Owner" },
          { id: demoUserId, email: demoEmail, name: "Demo" },
        ],
      });
      await prisma.organization.create({
        data: {
          id: organizationId,
          name: "Reserved Slug Owner",
          slug: demoSlug,
          memberships: { create: { userId: ownerId, role: "owner" } },
        },
      });

      await expect(
        resetDemoIdentity(prisma, { email: demoEmail, organizationSlug: demoSlug }),
      ).rejects.toThrow("reserved demo workspace");
      await expect(
        prisma.organization.findUnique({ where: { id: organizationId } }),
      ).resolves.not.toBeNull();
      await expect(
        prisma.appUser.findUnique({ where: { id: demoUserId } }),
      ).resolves.not.toBeNull();
    } finally {
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.appUser.deleteMany({ where: { id: { in: [ownerId, demoUserId] } } });
    }
  });

  it("refuses to reset a demo user linked to another tenant", async () => {
    const demoUserId = randomUUID();
    const demoOrganizationId = randomUUID();
    const demoEmail = `cross-member-demo-${suffix}@example.test`;
    const demoSlug = `cross-member-demo-${suffix}`;
    try {
      await prisma.appUser.create({
        data: { id: demoUserId, email: demoEmail, name: "Cross Member Demo" },
      });
      await prisma.organization.create({
        data: {
          id: demoOrganizationId,
          name: "Cross Member Demo",
          slug: demoSlug,
          memberships: { create: { userId: demoUserId, role: "owner" } },
        },
      });
      await prisma.membership.create({
        data: {
          organizationId: fixtures.organizationAId,
          userId: demoUserId,
          role: "viewer",
        },
      });

      await expect(
        resetDemoIdentity(prisma, { email: demoEmail, organizationSlug: demoSlug }),
      ).rejects.toThrow("another organization");
      await expect(
        prisma.organization.findUnique({ where: { id: demoOrganizationId } }),
      ).resolves.not.toBeNull();
      await expect(
        prisma.organization.findUnique({ where: { id: fixtures.organizationAId } }),
      ).resolves.not.toBeNull();
    } finally {
      await prisma.membership.deleteMany({ where: { userId: demoUserId } });
      await prisma.organization.deleteMany({ where: { id: demoOrganizationId } });
      await prisma.appUser.deleteMany({ where: { id: demoUserId } });
    }
  });

  it("deletes private research artifacts with their organization", async () => {
    const userId = randomUUID();
    const organizationId = randomUUID();
    const researchRunId = randomUUID();
    const insightId = randomUUID();
    try {
      await prisma.appUser.create({
        data: { id: userId, email: `cascade-${suffix}@example.test`, name: "Cascade Test" },
      });
      await prisma.organization.create({
        data: {
          id: organizationId,
          name: "Cascade Test",
          slug: `cascade-${suffix}`,
          memberships: { create: { userId, role: "owner" } },
        },
      });
      await prisma.researchRun.create({
        data: {
          id: researchRunId,
          organizationId,
          userId,
          assetId: fixtures.assetId,
          source: "integration-test",
          kind: "sentiment",
          status: "succeeded",
          insights: {
            create: {
              id: insightId,
              assetId: fixtures.assetId,
              source: "integration-test",
              title: "Private cascade insight",
              summary: "Must not become a public orphan",
              sentiment: "neutral",
            },
          },
        },
      });

      await prisma.organization.delete({ where: { id: organizationId } });

      await expect(prisma.aiInsight.findUnique({ where: { id: insightId } })).resolves.toBeNull();
    } finally {
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.appUser.deleteMany({ where: { id: userId } });
    }
  });

  it("cascades a custom strategy only inside its organization", async () => {
    const userAId = randomUUID();
    const userBId = randomUUID();
    const organizationAId = randomUUID();
    const organizationBId = randomUUID();
    const strategyAId = randomUUID();
    const strategyBId = randomUUID();
    const versionAId = randomUUID();
    const versionBId = randomUUID();
    try {
      await prisma.appUser.createMany({
        data: [
          { id: userAId, email: `custom-a-${suffix}@example.test`, name: "Custom A" },
          { id: userBId, email: `custom-b-${suffix}@example.test`, name: "Custom B" },
        ],
      });
      await prisma.organization.create({
        data: {
          id: organizationAId,
          name: "Custom strategy A",
          slug: `custom-strategy-a-${suffix}`,
          memberships: { create: { userId: userAId, role: "owner" } },
        },
      });
      await prisma.organization.create({
        data: {
          id: organizationBId,
          name: "Custom strategy B",
          slug: `custom-strategy-b-${suffix}`,
          memberships: { create: { userId: userBId, role: "owner" } },
        },
      });

      for (const strategy of [
        { strategyId: strategyAId, versionId: versionAId, organizationId: organizationAId, userId: userAId },
        { strategyId: strategyBId, versionId: versionBId, organizationId: organizationBId, userId: userBId },
      ]) {
        await prisma.$executeRaw`
          INSERT INTO custom_strategies (
            id, organization_id, created_by_user_id, name, family, status, created_at, updated_at
          ) VALUES (
            ${strategy.strategyId}::uuid, ${strategy.organizationId}::uuid, ${strategy.userId}::uuid,
            'Tenant DCA', 'systematic', 'active', NOW(), NOW()
          )
        `;
        await prisma.$executeRaw`
          INSERT INTO custom_strategy_versions (
            id, custom_strategy_id, version, kind, rule_definition, implementation_hash, status, created_at
          ) VALUES (
            ${strategy.versionId}::uuid, ${strategy.strategyId}::uuid, '1.0.0', 'scheduled_dca',
            '{"schemaVersion":1,"kind":"scheduled_dca","contributionAmount":400,"currency":"USD","frequency":"monthly","dayOfMonth":1}'::jsonb,
            ${"c".repeat(64)}, 'active', NOW()
          )
        `;
      }

      await prisma.organization.delete({ where: { id: organizationAId } });

      const survivingVersion = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM custom_strategy_versions WHERE id = ${versionBId}::uuid
      `;
      const removedVersion = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM custom_strategy_versions WHERE id = ${versionAId}::uuid
      `;
      expect(survivingVersion).toEqual([{ id: versionBId }]);
      expect(removedVersion).toEqual([]);
    } finally {
      await prisma.organization.deleteMany({ where: { id: { in: [organizationAId, organizationBId] } } });
      await prisma.appUser.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    }
  });

  it("never writes an organization A transaction into organization B", async () => {
    const portfolioB = await prisma.portfolio.findUniqueOrThrow({
      where: {
        organizationId_name: {
          organizationId: fixtures.organizationBId,
          name: "Main Portfolio",
        },
      },
      select: { id: true },
    });

    await createPortfolioTransaction(contextA, {
      symbol: fixtures.assetSymbol,
      type: "buy",
      quantity: 1,
      price: 100,
    });

    const [organizationATransactions, organizationBTransactions] = await Promise.all([
      prisma.portfolioTransaction.count({
        where: {
          portfolio: { organizationId: fixtures.organizationAId },
        },
      }),
      prisma.portfolioTransaction.count({
        where: { portfolioId: portfolioB.id },
      }),
    ]);

    expect(organizationATransactions).toBe(1);
    expect(organizationBTransactions).toBe(0);
  });
});
