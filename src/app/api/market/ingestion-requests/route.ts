import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import {
  IngestionRateLimitError,
  listMarketIngestionRequests,
  requestMarketIngestion,
} from "@/lib/backend/ingestion-requests";

export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    providerCode: z.string().trim().min(1).max(40),
    providerSymbol: z.string().trim().min(1).max(80),
    timeframe: z.enum(["1d", "1h"]),
  })
  .strict();

export async function GET() {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "backtest", "read");
    return NextResponse.json(await listMarketIngestionRequests(context));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "backtest", "create");
    const result = await requestMarketIngestion(context, requestSchema.parse(await request.json()));
    return NextResponse.json(result, { status: result.created ? 202 : 200 });
  } catch (error) {
    const status =
      error instanceof z.ZodError ? 400 : error instanceof IngestionRateLimitError ? 429 : 409;
    return apiError(error, status);
  }
}
