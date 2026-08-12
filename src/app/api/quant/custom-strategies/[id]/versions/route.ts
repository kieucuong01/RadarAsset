import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { createCustomStrategyVersion } from "@/lib/backend/custom-strategies";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "backtest", "create");
    const { id } = await params;
    return NextResponse.json(await createCustomStrategyVersion(context, id, await request.json()), {
      status: 201,
    });
  } catch (error) {
    const status =
      error instanceof z.ZodError
        ? 400
        : error instanceof Error && error.message === "Custom strategy not found."
          ? 404
          : 503;
    return apiError(error, status);
  }
}
