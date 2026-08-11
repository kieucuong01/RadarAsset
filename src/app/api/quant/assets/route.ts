import { NextResponse } from "next/server";

import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { loadQuantAssetCatalog, quantAssetQuerySchema } from "@/lib/backend/quant-assets";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "backtest", "read");
    const query = quantAssetQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    return NextResponse.json(await loadQuantAssetCatalog(query));
  } catch (error) {
    return apiError(error);
  }
}
