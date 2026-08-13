import { NextResponse } from "next/server";

import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { loadSmartInsightsDataHealth } from "@/lib/backend/smart-insights-data-health";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "research", "read");
    return NextResponse.json(await loadSmartInsightsDataHealth());
  } catch (error) {
    return apiError(error);
  }
}
