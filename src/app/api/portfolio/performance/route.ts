import { NextResponse } from "next/server";
import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { loadPortfolioPerformance, normalizePortfolioTimeframe } from "@/lib/backend/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "portfolio", "read");
    const url = new URL(request.url);
    const timeframe = normalizePortfolioTimeframe(url.searchParams.get("timeframe"));
    const performance = await loadPortfolioPerformance(context, timeframe);
    return NextResponse.json({ timeframe, performance });
  } catch (error) {
    return apiError(error);
  }
}
