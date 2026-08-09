import { describe, expect, it } from "vitest";

import {
  AuthenticationRequiredError,
  OrganizationRequiredError,
  TenantForbiddenError,
} from "@/lib/auth/errors";

import { apiError } from "./_lib";

describe("apiError authorization mapping", () => {
  it.each([
    [new AuthenticationRequiredError(), 401],
    [new OrganizationRequiredError(), 409],
    [new TenantForbiddenError(), 403],
  ])("maps %s to status %i", (error, expectedStatus) => {
    expect(apiError(error).status).toBe(expectedStatus);
  });

  it("preserves explicit status values for domain errors", () => {
    expect(apiError(new Error("invalid"), 422).status).toBe(422);
  });
});
