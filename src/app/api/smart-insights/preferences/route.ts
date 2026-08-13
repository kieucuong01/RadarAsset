import { NextResponse } from "next/server";

import { apiError } from "@/app/api/_lib";
import { hasTenantCapability } from "@/lib/auth/permissions";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { loadPreferences, savePreferences, SmartInsightsInputError } from "@/lib/backend/smart-insights";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "research", "read");
    return NextResponse.json(await loadPreferences(context, hasTenantCapability(context.role, "research", "write")));
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "research", "write");
    return NextResponse.json(await savePreferences(context, await request.json()));
  } catch (error) {
    return apiError(error, error instanceof SmartInsightsInputError || error instanceof SyntaxError ? 400 : 503);
  }
}
