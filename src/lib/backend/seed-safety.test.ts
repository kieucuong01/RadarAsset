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
      organization: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      appUser: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };

    await resetDemoIdentity(prisma as never, {
      email: "demo@radarasset.local",
      organizationSlug: "demo-workspace",
    });

    expect(prisma.organization.deleteMany).toHaveBeenCalledWith({
      where: { slug: "demo-workspace" },
    });
    expect(prisma.appUser.deleteMany).toHaveBeenCalledWith({
      where: { email: "demo@radarasset.local" },
    });
  });
});
