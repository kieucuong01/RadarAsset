import { NextResponse } from "next/server";

import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { loadVietnamFactorLab } from "@/lib/backend/factor-lab";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "backtest", "read");
    return NextResponse.json(await loadVietnamFactorLab(context));
  } catch (error) {
    return apiError(error, 503);
  }
}
