import { NextResponse } from "next/server";
import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { loadNotifications } from "@/lib/backend/strategy-forward-tests";

export async function GET(request: Request) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "portfolio", "read");
    const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
    return NextResponse.json(await loadNotifications(context, cursor));
  } catch (error) {
    return apiError(error);
  }
}
