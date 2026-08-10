import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { normalizeBacktestSubmission } from "@/lib/backtest/contracts";
import { createQuantRun, listQuantRuns } from "@/lib/backend/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "backtest", "read");
    return NextResponse.json(await listQuantRuns(context));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "backtest", "create");
    const payload = normalizeBacktestSubmission(await request.json());
    const run = await createQuantRun(context, payload);
    return NextResponse.json(run, { status: 202 });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 503;
    return apiError(error, status);
  }
}
