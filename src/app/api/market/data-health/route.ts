import { NextResponse } from "next/server";

import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { loadMarketDataHealth } from "@/lib/backend/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "backtest", "read");
    return NextResponse.json({ data: await loadMarketDataHealth() });
  } catch (error) {
    return apiError(error);
  }
}
