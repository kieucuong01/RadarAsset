import { NextResponse } from "next/server";
import { apiError } from "@/app/api/_lib";
import { loadInsights } from "@/lib/backend/research-repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await loadInsights());
  } catch (error) {
    return apiError(error);
  }
}
