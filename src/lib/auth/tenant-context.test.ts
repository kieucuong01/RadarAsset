import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AuthenticationRequiredError,
  OrganizationRequiredError,
  TenantForbiddenError,
} from "./errors";

const mocks = vi.hoisted(() => ({
  membershipFindFirst: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  getPrisma: () => ({
    membership: {
      findFirst: mocks.membershipFindFirst,
    },
  }),
}));

import {
  requireTenantCapability,
  resolvePublicMarketTenantContext,
  resolveTenantContext,
} from "./tenant-context";

const session = (activeOrganizationId: string | null = null) => ({
  user: { id: "user-1" },
  session: { activeOrganizationId },
});

describe("tenant context resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("uses the active organization only when membership exists", () => {
    const result = resolveTenantContext({
      session: session("org-2"),
      memberships: [
        {
          organizationId: "org-1",
          role: "viewer",
          createdAt: new Date("2026-01-01"),
        },
        {
          organizationId: "org-2",
          role: "editor",
          createdAt: new Date("2026-01-02"),
        },
      ],
    });

    expect(result).toEqual({
      userId: "user-1",
      organizationId: "org-2",
      role: "editor",
    });
  });

  it("falls back from a stale active organization to the oldest membership", () => {
    const result = resolveTenantContext({
      session: session("deleted-org"),
      memberships: [
        {
          organizationId: "org-new",
          role: "admin",
          createdAt: new Date("2026-02-01"),
        },
        {
          organizationId: "org-old",
          role: "viewer",
          createdAt: new Date("2026-01-01"),
        },
      ],
    });

    expect(result.organizationId).toBe("org-old");
    expect(result.role).toBe("viewer");
  });

  it("requires an authenticated user and at least one organization", () => {
    expect(() => resolveTenantContext({ session: null, memberships: [] })).toThrow(
      AuthenticationRequiredError,
    );
    expect(() => resolveTenantContext({ session: session(), memberships: [] })).toThrow(
      OrganizationRequiredError,
    );
  });

  it("normalizes comma-separated roles by highest valid precedence", () => {
    const result = resolveTenantContext({
      session: session("org-1"),
      memberships: [
        {
          organizationId: "org-1",
          role: "viewer,editor,unknown",
          createdAt: new Date("2026-01-01"),
        },
      ],
    });

    expect(result.role).toBe("editor");
  });

  it("fails closed to viewer when stored roles are invalid", () => {
    const result = resolveTenantContext({
      session: session("org-1"),
      memberships: [
        {
          organizationId: "org-1",
          role: "super-admin",
          createdAt: new Date("2026-01-01"),
        },
      ],
    });

    expect(result.role).toBe("viewer");
    expect(() => requireTenantCapability(result, "portfolio", "write")).toThrow(
      TenantForbiddenError,
    );
  });

  it("resolves the configured public market tenant for guest Smart Insights reads", async () => {
    mocks.membershipFindFirst.mockResolvedValue({
      userId: "user-public",
      organizationId: "org-public",
      role: "viewer,editor",
    });

    await expect(resolvePublicMarketTenantContext()).resolves.toEqual({
      userId: "user-public",
      organizationId: "org-public",
      role: "editor",
    });
    expect(mocks.membershipFindFirst).toHaveBeenCalledWith({
      where: {
        user: { email: "demo@radarasset.local" },
        organization: { slug: "demo-workspace" },
      },
      select: { userId: true, organizationId: true, role: true },
    });
  });

  it("uses explicit public Smart Insights tenant env overrides", async () => {
    vi.stubEnv("SMART_INSIGHTS_PUBLIC_USER_EMAIL", "public@example.test");
    vi.stubEnv("SMART_INSIGHTS_PUBLIC_ORGANIZATION_SLUG", "public-workspace");
    mocks.membershipFindFirst.mockResolvedValue({
      userId: "user-public",
      organizationId: "org-public",
      role: "viewer",
    });

    await resolvePublicMarketTenantContext();

    expect(mocks.membershipFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          user: { email: "public@example.test" },
          organization: { slug: "public-workspace" },
        },
      }),
    );
  });

  it("fails closed when the public market tenant is not configured in the database", async () => {
    mocks.membershipFindFirst.mockResolvedValue(null);

    await expect(resolvePublicMarketTenantContext()).rejects.toThrow(OrganizationRequiredError);
  });
});
