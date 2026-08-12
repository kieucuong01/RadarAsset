import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { listStrategyAssignments } from "@/lib/backend/db";
import { applyStrategyAssignment } from "@/lib/backend/strategy-forward-tests";
import { normalizeStrategyAssignment } from "@/lib/backtest/assignment-contracts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "portfolio", "read");
    return NextResponse.json(await listStrategyAssignments(context));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "portfolio", "write");
    const input = normalizeStrategyAssignment(await request.json());
    requireTenantCapability(context, "backtest", "read");
    return NextResponse.json(await applyStrategyAssignment(context, input), { status: 201 });
  } catch (error) {
    return apiError(error, error instanceof z.ZodError ? 400 : 503);
  }
}
