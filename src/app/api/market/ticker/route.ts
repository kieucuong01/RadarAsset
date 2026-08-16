import { NextResponse } from "next/server";
import { apiError } from "@/app/api/_lib";
import { loadTickerResponse } from "@/lib/backend/market-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const symbols = url.searchParams
      .get("symbols")
      ?.split(",")
      .map((symbol) => symbol.trim().toUpperCase())
      .filter(Boolean);
    return NextResponse.json(await loadTickerResponse(symbols));
  } catch (error) {
    return apiError(error);
  }
}
