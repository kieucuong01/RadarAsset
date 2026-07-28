import { NextResponse } from "next/server";
import { apiError } from "@/app/api/_lib";
import { loadResearchRuns } from "@/lib/backend/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await loadResearchRuns());
  } catch (error) {
    return apiError(error);
  }
}
