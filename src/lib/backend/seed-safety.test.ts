import { describe, expect, it, vi } from "vitest";

import { assertSeedDatabaseAllowed, resetDemoIdentity } from "./seed-safety";

describe("development seed safety", () => {
  it("requires an exact local database allowlist match", () => {
    expect(() =>
      assertSeedDatabaseAllowed(
        "postgresql://postgres:postgres@localhost:5432/quant_insight_radar",
        "quant_insight_radar",
      ),
    ).not.toThrow();
    expect(() =>
      assertSeedDatabaseAllowed(
        "postgresql://postgres:postgres@db.example.com:5432/quant_insight_radar",
        "quant_insight_radar",
      ),
    ).toThrow("local PostgreSQL host");
    expect(() =>
      assertSeedDatabaseAllowed(
        "postgresql://postgres:postgres@localhost:5432/staging",
        "quant_insight_radar",
      ),
    ).toThrow("must exactly match");
  });

  it("deletes only the named demo organization and user", async () => {
    const prisma = {
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          id: "organization-demo",
          memberships: [{ userId: "user-demo", role: "owner" }],
        }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      appUser: {
        findUnique: vi.fn().mockResolvedValue({
          id: "user-demo",
          memberships: [{ organizationId: "organization-demo" }],
          portfolios: [{ organizationId: "organization-demo" }],
          watchlistItems: [{ organizationId: "organization-demo" }],
          researchRuns: [{ organizationId: "organization-demo" }],
          quantRuns: [{ organizationId: "organization-demo" }],
          invitationsSent: [{ organizationId: "organization-demo" }],
        }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await resetDemoIdentity(prisma as never, {
      email: "demo@radarasset.local",
      organizationSlug: "demo-workspace",
    });

    expect(prisma.organization.deleteMany).toHaveBeenCalledWith({
      where: { id: "organization-demo" },
    });
    expect(prisma.appUser.deleteMany).toHaveBeenCalledWith({
      where: { id: "user-demo" },
    });
  });

  it("refuses to reset a reserved slug owned by another user", async () => {
    const prisma = {
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          id: "organization-demo",
          memberships: [{ userId: "someone-else", role: "owner" }],
        }),
        deleteMany: vi.fn(),
      },
      appUser: {
        findUnique: vi.fn().mockResolvedValue({
          id: "user-demo",
          memberships: [],
          portfolios: [],
          watchlistItems: [],
          researchRuns: [],
          quantRuns: [],
          invitationsSent: [],
        }),
        deleteMany: vi.fn(),
      },
    };

    await expect(
      resetDemoIdentity(prisma as never, {
        email: "demo@radarasset.local",
        organizationSlug: "demo-workspace",
      }),
    ).rejects.toThrow("reserved demo workspace");
    expect(prisma.organization.deleteMany).not.toHaveBeenCalled();
    expect(prisma.appUser.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses to delete a demo user linked to another organization", async () => {
    const prisma = {
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          id: "organization-demo",
          memberships: [{ userId: "user-demo", role: "owner" }],
        }),
        deleteMany: vi.fn(),
      },
      appUser: {
        findUnique: vi.fn().mockResolvedValue({
          id: "user-demo",
          memberships: [
            { organizationId: "organization-demo" },
            { organizationId: "organization-other" },
          ],
          portfolios: [],
          watchlistItems: [],
          researchRuns: [],
          quantRuns: [],
          invitationsSent: [],
        }),
        deleteMany: vi.fn(),
      },
    };

    await expect(
      resetDemoIdentity(prisma as never, {
        email: "demo@radarasset.local",
        organizationSlug: "demo-workspace",
      }),
    ).rejects.toThrow("another organization");
    expect(prisma.organization.deleteMany).not.toHaveBeenCalled();
    expect(prisma.appUser.deleteMany).not.toHaveBeenCalled();
  });
});
