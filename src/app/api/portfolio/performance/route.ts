import { NextResponse } from "next/server";
import { apiError } from "@/app/api/_lib";
import { loadPortfolioPerformance, normalizePortfolioTimeframe } from "@/lib/backend/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const timeframe = normalizePortfolioTimeframe(url.searchParams.get("timeframe"));
    const performance = await loadPortfolioPerformance(timeframe);
    return NextResponse.json({ timeframe, performance });
  } catch (error) {
    return apiError(error);
  }
}
