import { NextResponse } from "next/server";
import { apiError } from "@/app/api/_lib";
import { loadPortfolioResponse, normalizePortfolioTimeframe } from "@/lib/backend/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const timeframe = normalizePortfolioTimeframe(url.searchParams.get("timeframe"));
    const portfolio = await loadPortfolioResponse(timeframe);
    return NextResponse.json(portfolio);
  } catch (error) {
    return apiError(error);
  }
}
