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
        assetClass: "equity",
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

  it("hides another organization's quant id like a random id", async () => {
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
