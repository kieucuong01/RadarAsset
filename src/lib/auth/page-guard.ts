import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getPrisma } from "@/lib/db/prisma";

import { resolveTenantContext, type TenantContext } from "./tenant-context";
import { safeReturnTo } from "./navigation";

export { safeReturnTo, shouldCreateWorkspace } from "./navigation";

type PageGuardInput = Parameters<typeof resolveTenantContext>[0];

export function authDestination(input: PageGuardInput, returnTo: string): string | null {
  if (!input.session?.user.id) {
    return `/sign-in?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
  }

  if (input.memberships.length === 0) {
    return "/onboarding";
  }

  return null;
}

export async function requireTenantPage(returnTo: string): Promise<TenantContext> {
  const [{ auth }, requestHeaders] = await Promise.all([import("@/lib/auth"), headers()]);
  const session = await auth.api.getSession({ headers: requestHeaders });
  const memberships = session?.user.id
    ? await getPrisma().membership.findMany({
        where: { userId: session.user.id },
        select: {
          organizationId: true,
          role: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const destination = authDestination({ session, memberships }, safeReturnTo(returnTo));

  if (destination) {
    redirect(destination);
  }

  return resolveTenantContext({ session, memberships });
}
