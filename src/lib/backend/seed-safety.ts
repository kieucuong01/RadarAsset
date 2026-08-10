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
  await prisma.organization.deleteMany({
    where: { slug: input.organizationSlug },
  });
  await prisma.appUser.deleteMany({
    where: { email: input.email },
  });
}
