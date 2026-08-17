import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import {
  deletePortfolioTransaction,
  normalizePortfolioTimeframe,
  updatePortfolioTransaction,
} from "@/lib/backend/portfolio-repository";
import { PortfolioDomainError, PortfolioInputError } from "@/lib/backend/portfolio";
import { enqueueBriefingRefresh } from "@/lib/backend/smart-insights-refresh";

import { parseReportingCurrency, transactionIdSchema, transactionSchema } from "../schema";

export const dynamic = "force-dynamic";

type TransactionRouteContext = { params: Promise<{ id: string }> };

function mutationStatus(error: unknown) {
  if (error instanceof z.ZodError) return 400;
  if (error instanceof PortfolioInputError) return error.code === "ASSET_UNSUPPORTED" ? 400 : 404;
  if (error instanceof PortfolioDomainError) return 409;
  return 503;
}

async function authorize() {
  const context = await requireTenantContext();
  requireTenantCapability(context, "portfolio", "write");
  return context;
}

async function refresh(context: Awaited<ReturnType<typeof requireTenantContext>>) {
  try {
    await enqueueBriefingRefresh(context, "portfolio_transaction");
    return "queued";
  } catch {
    return "failed";
  }
}

export async function PATCH(request: Request, routeContext: TransactionRouteContext) {
  try {
    const context = await authorize();
    const id = transactionIdSchema.parse((await routeContext.params).id);
    const payload = transactionSchema.parse(await request.json());
    const portfolio = await updatePortfolioTransaction(context, id, payload);
    return NextResponse.json(portfolio, {
      headers: { "X-Smart-Insights-Refresh": await refresh(context) },
    });
  } catch (error) {
    return apiError(error, mutationStatus(error));
  }
}

export async function DELETE(request: Request, routeContext: TransactionRouteContext) {
  try {
    const context = await authorize();
    const id = transactionIdSchema.parse((await routeContext.params).id);
    const url = new URL(request.url);
    const timeframe = normalizePortfolioTimeframe(url.searchParams.get("timeframe"));
    const currency = parseReportingCurrency(url.searchParams.get("currency"));
    const portfolio = await deletePortfolioTransaction(context, id, timeframe, currency);
    return NextResponse.json(portfolio, {
      headers: { "X-Smart-Insights-Refresh": await refresh(context) },
    });
  } catch (error) {
    return apiError(error, mutationStatus(error));
  }
}
