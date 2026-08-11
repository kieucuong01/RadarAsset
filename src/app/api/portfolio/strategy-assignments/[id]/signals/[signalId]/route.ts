import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { updateStrategySignalStatus } from "@/lib/backend/db";

export const dynamic = "force-dynamic";

const signalStatusSchema = z
  .object({
    status: z.enum(["suggested", "reviewed", "executed", "dismissed"]),
  })
  .strict();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; signalId: string }> },
) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "portfolio", "write");
    const { signalId } = await params;
    const payload = signalStatusSchema.parse(await request.json());
    return NextResponse.json(await updateStrategySignalStatus(context, signalId, payload.status));
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 503;
    return apiError(error, status);
  }
}
