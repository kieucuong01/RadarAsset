import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import {
  loadPortfolioResponse,
  normalizePortfolioChartTimeframe,
} from "@/lib/backend/portfolio-repository";
import { parseReportingCurrency } from "./transactions/schema";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "portfolio", "read");
    const url = new URL(request.url);
    const timeframe = normalizePortfolioChartTimeframe(url.searchParams.get("timeframe"));
    const currency = parseReportingCurrency(url.searchParams.get("currency"));
    const portfolio = await loadPortfolioResponse(context, timeframe, currency);
    return NextResponse.json(portfolio);
  } catch (error) {
    return apiError(error, error instanceof z.ZodError ? 400 : undefined);
  }
}
