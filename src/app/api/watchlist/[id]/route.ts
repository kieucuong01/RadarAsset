import { NextResponse } from "next/server";

import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { removeWatchlistItem } from "@/lib/backend/research-repository";
import { enqueueBriefingRefresh } from "@/lib/backend/smart-insights-refresh";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "watchlist", "write");
    const { id } = await params;
    if (!id || id.length > 100)
      return NextResponse.json({ error: "Invalid favorite ID." }, { status: 400 });
    const removed = await removeWatchlistItem(context, id);
    if (!removed) return NextResponse.json({ error: "Favorite not found." }, { status: 404 });
    let refresh = "queued";
    try {
      await enqueueBriefingRefresh(context, "watchlist_removed");
    } catch {
      refresh = "failed";
    }
    return new NextResponse(null, {
      status: 204,
      headers: { "X-Smart-Insights-Refresh": refresh },
    });
  } catch (error) {
    return apiError(error);
  }
}
