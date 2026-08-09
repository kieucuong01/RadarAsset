import { requireServerEnv } from "@/lib/auth/env";
import { getPrisma } from "@/lib/db/prisma";

export type WorkerImportContext = {
  organizationId: string;
  userId: null;
};

export async function getWorkerImportContext(): Promise<WorkerImportContext> {
  const slug = requireServerEnv("QUANT_WORKER_ORGANIZATION_SLUG");
  const organization = await getPrisma().organization.findUnique({
    where: { slug },
    select: { id: true },
  });

  if (!organization) {
    throw new Error(`QUANT_WORKER_ORGANIZATION_SLUG does not match an organization: ${slug}.`);
  }

  return {
    organizationId: organization.id,
    userId: null,
  };
}
