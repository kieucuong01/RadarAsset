import { NextResponse } from "next/server";
import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { getQuantRun } from "@/lib/backend/db";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "backtest", "read");
    const { id } = await params;
    return NextResponse.json(await getQuantRun(context, id));
  } catch (error) {
    return apiError(error, 404);
  }
}
