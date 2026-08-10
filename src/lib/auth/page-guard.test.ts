import { describe, expect, it } from "vitest";

import { authDestination, safeReturnTo, shouldCreateWorkspace } from "./page-guard";

const sessionUser = {
  user: { id: "user-1" },
  session: { activeOrganizationId: "org-1" },
};
const membership = {
  organizationId: "org-1",
  role: "owner",
  createdAt: new Date(0),
};

describe("authenticated page guard", () => {
  it("sends unauthenticated users to sign-in with a local return path", () => {
    expect(authDestination({ session: null, memberships: [] }, "/portfolio")).toBe(
      "/sign-in?returnTo=%2Fportfolio",
    );
  });

  it("sends users without a workspace to onboarding", () => {
    expect(authDestination({ session: sessionUser, memberships: [] }, "/portfolio")).toBe(
      "/onboarding",
    );
  });

  it("allows users with a valid membership to continue", () => {
    expect(
      authDestination({ session: sessionUser, memberships: [membership] }, "/portfolio"),
    ).toBeNull();
  });

  it.each([
    ["https://attacker.example", "/portfolio"],
    ["//attacker.example", "/portfolio"],
    ["/\\attacker.example", "/portfolio"],
    ["/%5Cattacker.example", "/portfolio"],
    ["/%2Fattacker.example", "/portfolio"],
    ["/portfolio%0A@attacker.example", "/portfolio"],
    ["portfolio", "/portfolio"],
    ["/quant-lab?tab=runs", "/quant-lab?tab=runs"],
    ["/onboarding?create=1", "/onboarding?create=1"],
    ["/api/portfolio", "/portfolio"],
  ])("normalizes returnTo %s safely", (value, expected) => {
    expect(safeReturnTo(value, "/portfolio")).toBe(expected);
  });

  it.each([
    [0, false, true],
    [1, false, false],
    [1, true, true],
  ])(
    "selects the onboarding form for %i organizations when createNew=%s",
    (organizationCount, createNew, expected) => {
      expect(shouldCreateWorkspace(organizationCount, createNew)).toBe(expected);
    },
  );
});
