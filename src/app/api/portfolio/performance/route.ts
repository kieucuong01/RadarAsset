import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import {
  loadPortfolioPerformance,
  normalizePortfolioTimeframe,
} from "@/lib/backend/portfolio-repository";
import { parseReportingCurrency } from "../transactions/schema";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "portfolio", "read");
    const url = new URL(request.url);
    const timeframe = normalizePortfolioTimeframe(url.searchParams.get("timeframe"));
    const currency = parseReportingCurrency(url.searchParams.get("currency"));
    const performance = await loadPortfolioPerformance(context, timeframe, currency);
    return NextResponse.json({ timeframe, currency, performance });
  } catch (error) {
    return apiError(error, error instanceof z.ZodError ? 400 : undefined);
  }
}
