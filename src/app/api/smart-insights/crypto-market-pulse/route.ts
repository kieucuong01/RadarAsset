import { NextResponse } from "next/server";

import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { loadCryptoMarketPulse } from "@/lib/backend/crypto-market-pulse";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "research", "read");
    return NextResponse.json(await loadCryptoMarketPulse());
  } catch (error) {
    return apiError(error, 503);
  }
}
