import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { loadWatchlist, upsertWatchlistItem } from "@/lib/backend/db";

export const dynamic = "force-dynamic";

const watchlistSchema = z.object({
  symbol: z.string().min(1),
  alert: z.coerce.number().positive().optional().nullable(),
});

export async function GET() {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "watchlist", "read");
    return NextResponse.json(await loadWatchlist(context));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "watchlist", "write");
    const payload = watchlistSchema.parse(await request.json());
    const watchlist = await upsertWatchlistItem(context, payload);
    return NextResponse.json(watchlist, { status: 201 });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 503;
    return apiError(error, status);
  }
}
