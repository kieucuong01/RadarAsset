import {
  adminAc,
  defaultAc,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

export type TenantRole = "owner" | "admin" | "editor" | "viewer";
export type TenantResource =
  | "portfolio"
  | "watchlist"
  | "research"
  | "backtest"
  | "membership";
export type TenantAction = "read" | "write" | "create" | "cancel" | "manage";

const capabilities: Record<
  TenantRole,
  Partial<Record<TenantResource, readonly TenantAction[]>>
> = {
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

export const organizationAccessControl = defaultAc;

export const organizationRoles = {
  owner: ownerAc,
  admin: adminAc,
  editor: memberAc,
  viewer: memberAc,
};
