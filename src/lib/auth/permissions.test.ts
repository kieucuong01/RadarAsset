import { describe, expect, it } from "vitest";

import { hasTenantCapability, organizationRoles } from "./permissions";

describe("tenant permissions", () => {
  it("keeps viewers read-only", () => {
    expect(hasTenantCapability("viewer", "portfolio", "read")).toBe(true);
    expect(hasTenantCapability("viewer", "portfolio", "write")).toBe(false);
    expect(hasTenantCapability("viewer", "backtest", "create")).toBe(false);
  });

  it.each(["owner", "admin", "editor"] as const)("allows %s to mutate tenant data", (role) => {
    expect(hasTenantCapability(role, "portfolio", "write")).toBe(true);
    expect(hasTenantCapability(role, "backtest", "create")).toBe(true);
  });

  it("reserves membership management for owners and admins", () => {
    expect(hasTenantCapability("owner", "membership", "manage")).toBe(true);
    expect(hasTenantCapability("admin", "membership", "manage")).toBe(true);
    expect(hasTenantCapability("editor", "membership", "manage")).toBe(false);
  });

  it("keeps Better Auth organization mutations aligned with tenant roles", () => {
    expect(organizationRoles.admin.authorize({ organization: ["update"] }).success).toBe(true);
    expect(organizationRoles.editor.authorize({ organization: ["update"] }).success).toBe(false);
    expect(organizationRoles.viewer.authorize({ member: ["create"] }).success).toBe(false);
  });
});
