import { NextResponse } from "next/server";
import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { loadStrategyForwardTests } from "@/lib/backend/strategy-forward-tests";

export async function GET() {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "portfolio", "read");
    return NextResponse.json(await loadStrategyForwardTests(context));
  } catch (error) {
    return apiError(error);
  }
}
