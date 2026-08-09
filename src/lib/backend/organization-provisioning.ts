import { getPrisma } from "@/lib/db/prisma";

export async function provisionOrganizationDefaults(input: {
  organizationId: string;
  userId: string;
}) {
  const prisma = getPrisma();

  return prisma.portfolio.upsert({
    where: {
      organizationId_name: {
        organizationId: input.organizationId,
        name: "Main Portfolio",
      },
    },
    create: {
      organizationId: input.organizationId,
      userId: input.userId,
      name: "Main Portfolio",
      baseCurrency: "USD",
    },
    update: {},
  });
}
