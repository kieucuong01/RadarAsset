import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { archiveCustomStrategy, listCustomStrategies } from "@/lib/backend/custom-strategies";

export const dynamic = "force-dynamic";

const archiveSchema = z.object({ action: z.literal("archive") }).strict();

function statusFor(error: unknown) {
  if (error instanceof z.ZodError) return 400;
  if (error instanceof Error && error.message === "Custom strategy not found.") return 404;
  return 503;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "backtest", "read");
    const { id } = await params;
    const strategy = (await listCustomStrategies(context)).find((item) => item.id === id);
    if (!strategy) throw new Error("Custom strategy not found.");
    return NextResponse.json(strategy);
  } catch (error) {
    return apiError(error, statusFor(error));
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "backtest", "create");
    const { id } = await params;
    archiveSchema.parse(await request.json());
    return NextResponse.json(await archiveCustomStrategy(context, id));
  } catch (error) {
    return apiError(error, statusFor(error));
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "backtest", "create");
    const { id } = await params;
    return NextResponse.json(await archiveCustomStrategy(context, id));
  } catch (error) {
    return apiError(error, statusFor(error));
  }
}
