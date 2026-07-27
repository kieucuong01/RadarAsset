import { NextResponse } from "next/server";
import { apiError } from "@/app/api/_lib";
import { getQuantRun } from "@/lib/backend/db";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await getQuantRun(id));
  } catch (error) {
    return apiError(error, 404);
  }
}
