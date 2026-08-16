import { NextResponse } from "next/server";
import { apiError } from "@/app/api/_lib";
import { loadAssetIntelligence } from "@/lib/backend/research-repository";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await params;
    return NextResponse.json(await loadAssetIntelligence(symbol));
  } catch (error) {
    return apiError(error);
  }
}
