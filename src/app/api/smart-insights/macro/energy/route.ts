import { NextResponse } from "next/server";

import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { loadEnergyPulse } from "@/lib/backend/smart-insights-macro";
import { parseInsightWindow, SmartInsightsInputError } from "@/lib/backend/smart-insights";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "research", "read");
    const window = parseInsightWindow(new URL(request.url));
    return NextResponse.json(await loadEnergyPulse(context, window));
  } catch (error) {
    return apiError(error, error instanceof SmartInsightsInputError ? 400 : 503);
  }
}
