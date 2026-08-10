import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { auth } from "@/lib/auth";
import { getPrisma } from "@/lib/db/prisma";

import { requireTenantCapability, resolveTenantContext } from "./tenant-context";

const prisma = getPrisma();
const suffix = randomUUID().slice(0, 8);
const email = `auth-adapter-${suffix}@example.test`;
const password = "Integration!2026-Auth";
let userId: string | null = null;

function sessionCookie(response: Response): string {
  const header = response.headers.get("set-cookie");
  if (!header) throw new Error("Better Auth did not return a session cookie.");
  return header.split(";", 1)[0] ?? "";
}

describe("Better Auth tenant boundary", () => {
  afterAll(async () => {
    if (userId) {
      await prisma.organization.deleteMany({
        where: { memberships: { some: { userId } } },
      });
      await prisma.appUser.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  it("persists sessions, provisions organizations, switches active tenant and fails closed", async () => {
    const signUpResponse = await auth.api.signUpEmail({
      body: { email, password, name: "Auth Adapter" },
      asResponse: true,
    });
    expect(signUpResponse.status).toBe(200);
    const cookie = sessionCookie(signUpResponse);
    const requestHeaders = new Headers({ cookie });

    const sessionAfterSignup = await auth.api.getSession({ headers: requestHeaders });
    expect(sessionAfterSignup?.user.email).toBe(email);
    userId = sessionAfterSignup?.user.id ?? null;
    expect(userId).not.toBeNull();

    const organizationA = await auth.api.createOrganization({
      headers: requestHeaders,
      body: { name: "Auth Organization A", slug: `auth-a-${suffix}` },
    });
    const organizationB = await auth.api.createOrganization({
      headers: requestHeaders,
      body: { name: "Auth Organization B", slug: `auth-b-${suffix}` },
    });
    expect(organizationA?.id).toBeTruthy();
    expect(organizationB?.id).toBeTruthy();

    const provisionedPortfolios = await prisma.portfolio.count({
      where: {
        organizationId: { in: [organizationA!.id, organizationB!.id] },
        name: "Main Portfolio",
      },
    });
    expect(provisionedPortfolios).toBe(2);

    await auth.api.setActiveOrganization({
      headers: requestHeaders,
      body: { organizationId: organizationB!.id },
    });
    const activeSession = await auth.api.getSession({ headers: requestHeaders });
    expect(activeSession?.session.activeOrganizationId).toBe(organizationB!.id);

    await prisma.membership.delete({
      where: {
        userId_organizationId: {
          userId: userId!,
          organizationId: organizationB!.id,
        },
      },
    });
    await prisma.membership.update({
      where: {
        userId_organizationId: {
          userId: userId!,
          organizationId: organizationA!.id,
        },
      },
      data: { role: "viewer" },
    });
    const memberships = await prisma.membership.findMany({
      where: { userId: userId! },
      select: { organizationId: true, role: true, createdAt: true },
    });
    const fallbackContext = resolveTenantContext({
      session: activeSession,
      memberships,
    });
    expect(fallbackContext).toEqual(
      expect.objectContaining({
        organizationId: organizationA!.id,
        role: "viewer",
      }),
    );
    expect(() => requireTenantCapability(fallbackContext, "portfolio", "write")).toThrow(
      "permission",
    );

    await auth.api.signOut({ headers: requestHeaders });
    await expect(auth.api.getSession({ headers: requestHeaders })).resolves.toBeNull();
  });
});
