import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/app/api/_lib";
import { loadWatchlist, upsertWatchlistItem } from "@/lib/backend/db";

export const dynamic = "force-dynamic";

const watchlistSchema = z.object({
  symbol: z.string().min(1),
  alert: z.coerce.number().positive().optional().nullable(),
});

export async function GET() {
  try {
    return NextResponse.json(await loadWatchlist());
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = watchlistSchema.parse(await request.json());
    const watchlist = await upsertWatchlistItem(payload);
    return NextResponse.json(watchlist, { status: 201 });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 503;
    return apiError(error, status);
  }
}
