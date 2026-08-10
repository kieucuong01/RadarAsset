import type { PrismaClient } from "@prisma/client";

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function assertSeedDatabaseAllowed(connectionString: string, allowedDatabase: string): void {
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL before seeding.");
  }

  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ""));
  if (!LOCAL_DATABASE_HOSTS.has(databaseUrl.hostname)) {
    throw new Error("The development seed only runs against a local PostgreSQL host.");
  }
  if (!allowedDatabase || databaseName !== allowedDatabase) {
    throw new Error(
      `DEV_SEED_DATABASE must exactly match the DATABASE_URL database (${databaseName}).`,
    );
  }
}

type DemoIdentityClient = Pick<PrismaClient, "organization" | "appUser">;

export async function resetDemoIdentity(
  prisma: DemoIdentityClient,
  input: { email: string; organizationSlug: string },
): Promise<void> {
  const [organization, user] = await Promise.all([
    prisma.organization.findUnique({
      where: { slug: input.organizationSlug },
      select: {
        id: true,
        memberships: { select: { userId: true, role: true } },
      },
    }),
    prisma.appUser.findUnique({
      where: { email: input.email },
      select: {
        id: true,
        memberships: { select: { organizationId: true } },
        portfolios: { select: { organizationId: true } },
        watchlistItems: { select: { organizationId: true } },
        researchRuns: { select: { organizationId: true } },
        quantRuns: { select: { organizationId: true } },
        invitationsSent: { select: { organizationId: true } },
      },
    }),
  ]);

  if (organization) {
    const isExclusiveDemoWorkspace =
      user &&
      organization.memberships.length === 1 &&
      organization.memberships[0]?.userId === user.id &&
      organization.memberships[0]?.role === "owner";
    if (!isExclusiveDemoWorkspace) {
      throw new Error("The reserved demo workspace is not exclusively owned by the demo user.");
    }
  }

  if (user) {
    const demoOrganizationId = organization?.id;
    const linkedOrganizationIds = [
      ...user.memberships,
      ...user.portfolios,
      ...user.watchlistItems,
      ...user.researchRuns,
      ...user.quantRuns,
      ...user.invitationsSent,
    ].map((relation) => relation.organizationId);
    if (linkedOrganizationIds.some((organizationId) => organizationId !== demoOrganizationId)) {
      throw new Error("The demo user is linked to another organization.");
    }
  }

  if (organization) {
    await prisma.organization.deleteMany({ where: { id: organization.id } });
  }
  if (user) {
    await prisma.appUser.deleteMany({ where: { id: user.id } });
  }
}
