import { NextResponse } from "next/server";

import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { loadBriefing, SmartInsightsInputError } from "@/lib/backend/smart-insights";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "research", "read");
    const briefing = await loadBriefing(context, new URL(request.url).searchParams.get("date"));
    return briefing
      ? NextResponse.json(briefing)
      : NextResponse.json({ error: "Briefing not found." }, { status: 404 });
  } catch (error) {
    return apiError(error, error instanceof SmartInsightsInputError ? 400 : 503);
  }
}
