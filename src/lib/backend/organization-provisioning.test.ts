import { beforeEach, describe, expect, it, vi } from "vitest";

const { portfolioUpsert } = vi.hoisted(() => ({
  portfolioUpsert: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  getPrisma: () => ({
    portfolio: {
      upsert: portfolioUpsert,
    },
  }),
}));

import { provisionOrganizationDefaults } from "./organization-provisioning";

describe("organization default provisioning", () => {
  beforeEach(() => {
    portfolioUpsert.mockReset();
    portfolioUpsert.mockResolvedValue({ id: "portfolio-1" });
  });

  it("idempotently provisions one USD Main Portfolio per organization", async () => {
    const input = { organizationId: "org-1", userId: "user-1" };

    await provisionOrganizationDefaults(input);
    await provisionOrganizationDefaults(input);

    expect(portfolioUpsert).toHaveBeenCalledTimes(2);
    expect(portfolioUpsert).toHaveBeenLastCalledWith({
      where: {
        organizationId_name: {
          organizationId: "org-1",
          name: "Main Portfolio",
        },
      },
      create: {
        organizationId: "org-1",
        userId: "user-1",
        name: "Main Portfolio",
        baseCurrency: "USD",
      },
      update: {},
    });
  });
});
