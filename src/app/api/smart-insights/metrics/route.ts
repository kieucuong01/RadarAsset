import { NextResponse } from "next/server";

import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { loadMetrics, parseInsightWindow, SmartInsightsInputError } from "@/lib/backend/smart-insights";
import type { InsightMarket } from "@/lib/backend/smart-insights-types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "research", "read");
    const url = new URL(request.url);
    const market = url.searchParams.get("market") as InsightMarket | null;
    if (!market) throw new SmartInsightsInputError("Market is required.");
    const window = parseInsightWindow(url);
    return NextResponse.json({ metrics: await loadMetrics({ market, asset: url.searchParams.get("asset"), ...window }) });
  } catch (error) {
    return apiError(error, error instanceof SmartInsightsInputError ? 400 : 503);
  }
}
