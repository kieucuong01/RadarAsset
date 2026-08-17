import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { createPortfolioTransaction } from "@/lib/backend/portfolio-repository";
import { PortfolioDomainError, PortfolioInputError } from "@/lib/backend/portfolio";
import { enqueueBriefingRefresh } from "@/lib/backend/smart-insights-refresh";

import { transactionSchema } from "./schema";

export const dynamic = "force-dynamic";

function mutationStatus(error: unknown) {
  if (error instanceof z.ZodError) return 400;
  if (error instanceof PortfolioInputError) return error.code === "ASSET_UNSUPPORTED" ? 400 : 404;
  if (error instanceof PortfolioDomainError) return 409;
  return 503;
}

export async function POST(request: Request) {
  let context;
  try {
    context = await requireTenantContext();
    requireTenantCapability(context, "portfolio", "write");
  } catch (error) {
    return apiError(error);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return apiError(error, 400);
  }

  try {
    const portfolio = await createPortfolioTransaction(context, transactionSchema.parse(body));
    let refresh = "queued";
    try {
      await enqueueBriefingRefresh(context, "portfolio_transaction");
    } catch {
      refresh = "failed";
    }
    return NextResponse.json(portfolio, {
      status: 201,
      headers: { "X-Smart-Insights-Refresh": refresh },
    });
  } catch (error) {
    return apiError(error, mutationStatus(error));
  }
}
