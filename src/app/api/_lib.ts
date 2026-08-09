import { NextResponse } from "next/server";

import {
  AuthenticationRequiredError,
  OrganizationRequiredError,
  TenantForbiddenError,
} from "@/lib/auth/errors";

export function apiError(error: unknown, status = 503) {
  if (error instanceof AuthenticationRequiredError) {
    status = 401;
  } else if (error instanceof OrganizationRequiredError) {
    status = 409;
  } else if (error instanceof TenantForbiddenError) {
    status = 403;
  }

  const message = error instanceof Error ? error.message : "Unexpected API error.";
  return NextResponse.json({ error: message }, { status });
}
