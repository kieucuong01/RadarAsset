import { createAccessControl } from "better-auth/plugins/access";

export type TenantRole = "owner" | "admin" | "editor" | "viewer";
export type TenantResource = "portfolio" | "watchlist" | "research" | "backtest" | "membership";
export type TenantAction = "read" | "write" | "create" | "cancel" | "manage";

const capabilities: Record<TenantRole, Partial<Record<TenantResource, readonly TenantAction[]>>> = {
  owner: {
    portfolio: ["read", "write"],
    watchlist: ["read", "write"],
    research: ["read", "write"],
    backtest: ["read", "create", "cancel"],
    membership: ["read", "manage"],
  },
  admin: {
    portfolio: ["read", "write"],
    watchlist: ["read", "write"],
    research: ["read", "write"],
    backtest: ["read", "create", "cancel"],
    membership: ["read", "manage"],
  },
  editor: {
    portfolio: ["read", "write"],
    watchlist: ["read", "write"],
    research: ["read", "write"],
    backtest: ["read", "create", "cancel"],
    membership: ["read"],
  },
  viewer: {
    portfolio: ["read"],
    watchlist: ["read"],
    research: ["read"],
    backtest: ["read"],
    membership: ["read"],
  },
};

export function hasTenantCapability(
  role: TenantRole,
  resource: TenantResource,
  action: TenantAction,
): boolean {
  return capabilities[role][resource]?.includes(action) ?? false;
}

const organizationStatements = {
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
} as const;

export const organizationAccessControl = createAccessControl(organizationStatements);

const ownerOrganizationRole = organizationAccessControl.newRole({
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
});

const adminOrganizationRole = organizationAccessControl.newRole({
  organization: ["update"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
});

const readOnlyOrganizationRole = organizationAccessControl.newRole({
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: ["read"],
});

export const organizationRoles = {
  owner: ownerOrganizationRole,
  admin: adminOrganizationRole,
  editor: readOnlyOrganizationRole,
  viewer: readOnlyOrganizationRole,
};
