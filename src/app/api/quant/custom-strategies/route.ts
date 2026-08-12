import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { createCustomStrategy, listCustomStrategies } from "@/lib/backend/custom-strategies";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "backtest", "read");
    return NextResponse.json(await listCustomStrategies(context));
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && error.message === "Custom strategy not found." ? 404 : 503,
    );
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "backtest", "create");
    return NextResponse.json(await createCustomStrategy(context, await request.json()), {
      status: 201,
    });
  } catch (error) {
    return apiError(error, error instanceof z.ZodError ? 400 : 503);
  }
}
