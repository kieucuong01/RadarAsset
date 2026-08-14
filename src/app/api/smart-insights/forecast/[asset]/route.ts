import { NextResponse } from "next/server";

import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { loadKronosShadow } from "@/lib/backend/smart-insights-forecast";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ asset: string }> },
) {
  try {
    const { asset } = await params;
    const model = new URL(request.url).searchParams.get("model") ?? "kronos-small";
    if (asset.toUpperCase() !== "BTC" || model !== "kronos-small") {
      return NextResponse.json({ error: "Only BTC/kronos-small is supported." }, { status: 400 });
    }
    const context = await requireTenantContext();
    requireTenantCapability(context, "research", "read");
    return NextResponse.json(await loadKronosShadow(context, "BTC"));
  } catch (error) {
    return apiError(error);
  }
}
