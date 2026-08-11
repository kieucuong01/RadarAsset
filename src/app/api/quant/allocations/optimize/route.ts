import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import {
  QuantOptimizerEligibilityError,
  optimizeQuantAllocation,
  quantOptimizerRequestSchema,
} from "@/lib/backend/quant-optimizer";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "backtest", "create");
    const payload = quantOptimizerRequestSchema.parse(await request.json());
    return NextResponse.json(await optimizeQuantAllocation(context, payload));
  } catch (error) {
    const status =
      error instanceof z.ZodError
        ? 400
        : error instanceof QuantOptimizerEligibilityError
          ? 409
          : 503;
    return apiError(error, status);
  }
}
