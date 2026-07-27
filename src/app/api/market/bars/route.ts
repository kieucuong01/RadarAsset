import { NextResponse } from "next/server";
import { apiError } from "@/app/api/_lib";
import { loadMarketBars } from "@/lib/backend/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const symbol = url.searchParams.get("symbol") ?? "BTC";
    const timeframe = url.searchParams.get("timeframe") ?? "1d";
    return NextResponse.json(await loadMarketBars(symbol, timeframe));
  } catch (error) {
    return apiError(error);
  }
}
