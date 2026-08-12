import { NextResponse } from "next/server";

import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { listTenantCustomStrategyCatalog } from "@/lib/backend/custom-strategies";
import { listStrategyCatalog } from "@/lib/backtest/strategy-catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "backtest", "read");
    const custom = await listTenantCustomStrategyCatalog(context);
    return NextResponse.json([...listStrategyCatalog(), ...custom]);
  } catch (error) {
    return apiError(error);
  }
}
