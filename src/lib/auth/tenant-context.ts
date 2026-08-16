import { headers } from "next/headers";

import { getPrisma } from "@/lib/db/prisma";

import {
  AuthenticationRequiredError,
  OrganizationRequiredError,
  TenantForbiddenError,
} from "./errors";
import {
  hasTenantCapability,
  type TenantAction,
  type TenantResource,
  type TenantRole,
} from "./permissions";

type SessionInput = {
  user: { id: string };
  session: { activeOrganizationId?: string | null };
} | null;

type MembershipInput = {
  organizationId: string;
  role: string;
  createdAt: Date;
};

export type TenantContext = {
  userId: string;
  organizationId: string;
  role: TenantRole;
};

const rolePrecedence: readonly TenantRole[] = ["owner", "admin", "editor", "viewer"];

function normalizeTenantRole(storedRole: string): TenantRole {
  const roles = new Set(
    storedRole
      .split(",")
      .map((role) => role.trim())
      .filter(Boolean),
  );

  return rolePrecedence.find((role) => roles.has(role)) ?? "viewer";
}

export function resolveTenantContext(input: {
  session: SessionInput;
  memberships: readonly MembershipInput[];
}): TenantContext {
  if (!input.session?.user.id) {
    throw new AuthenticationRequiredError();
  }

  const memberships = [...input.memberships].sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
  );
  const activeOrganizationId = input.session.session.activeOrganizationId ?? null;
  const membership =
    memberships.find((candidate) => candidate.organizationId === activeOrganizationId) ??
    memberships[0];

  if (!membership) {
    throw new OrganizationRequiredError();
  }

  return {
    userId: input.session.user.id,
    organizationId: membership.organizationId,
    role: normalizeTenantRole(membership.role),
  };
}

export async function resolvePublicMarketTenantContext(): Promise<TenantContext> {
  const email =
    process.env.SMART_INSIGHTS_PUBLIC_USER_EMAIL?.trim() ||
    process.env.QUANT_WORKER_USER_EMAIL?.trim() ||
    "demo@radarasset.local";
  const slug =
    process.env.SMART_INSIGHTS_PUBLIC_ORGANIZATION_SLUG?.trim() ||
    process.env.QUANT_WORKER_ORGANIZATION_SLUG?.trim() ||
    "demo-workspace";
  const membership = await getPrisma().membership.findFirst({
    where: {
      user: { email },
      organization: { slug },
    },
    select: { userId: true, organizationId: true, role: true },
  });

  if (!membership) {
    throw new OrganizationRequiredError("Public Smart Insights briefing is not configured.");
  }

  return {
    userId: membership.userId,
    organizationId: membership.organizationId,
    role: normalizeTenantRole(membership.role),
  };
}

export async function requireTenantContext(): Promise<TenantContext> {
  const [{ auth }, requestHeaders] = await Promise.all([import("@/lib/auth"), headers()]);
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session?.user.id) {
    throw new AuthenticationRequiredError();
  }

  const memberships = await getPrisma().membership.findMany({
    where: { userId: session.user.id },
    select: {
      organizationId: true,
      role: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return resolveTenantContext({ session, memberships });
}

export function requireTenantCapability(
  context: TenantContext,
  resource: TenantResource,
  action: TenantAction,
): void {
  if (!hasTenantCapability(context.role, resource, action)) {
    throw new TenantForbiddenError();
  }
}
