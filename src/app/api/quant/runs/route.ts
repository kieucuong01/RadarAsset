import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/app/api/_lib";
import { createQuantRun, listQuantRuns } from "@/lib/backend/db";

export const dynamic = "force-dynamic";

const quantRunSchema = z.object({
  strategyName: z.string().min(1),
  parameters: z.record(z.unknown()).optional(),
});

export async function GET() {
  try {
    return NextResponse.json(await listQuantRuns());
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = quantRunSchema.parse(await request.json());
    const run = await createQuantRun(payload);
    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 503;
    return apiError(error, status);
  }
}
