import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/app/api/_lib";
import { importResearchRun } from "@/lib/backend/db";

export const dynamic = "force-dynamic";

const statusSchema = z.enum(["queued", "running", "succeeded", "failed"]);
const sentimentSchema = z.enum(["bull", "bear", "neutral"]);
const stanceSchema = z.enum(["accumulate", "hold", "trim", "avoid", "watch"]);

const optionalDate = z.string().datetime().optional().nullable();

const researchImportSchema = z.object({
  source: z.string().trim().min(1).max(80),
  kind: z.string().trim().min(1).max(80),
  symbol: z.string().trim().min(1).max(24).optional().nullable(),
  status: statusSchema.optional(),
  summary: z.string().trim().max(4000).optional().nullable(),
  parameters: z.record(z.unknown()).optional(),
  startedAt: optionalDate,
  finishedAt: optionalDate,
  providerRuns: z
    .array(
      z.object({
        provider: z.string().trim().min(1).max(80),
        status: statusSchema,
        recordsFetched: z.coerce.number().int().min(0).max(100000).optional(),
        errorMessage: z.string().trim().max(1000).optional().nullable(),
        startedAt: optionalDate,
        finishedAt: optionalDate,
      }),
    )
    .max(20)
    .optional(),
  insights: z
    .array(
      z.object({
        source: z.string().trim().min(1).max(80).optional(),
        title: z.string().trim().min(1).max(300),
        summary: z.string().trim().min(1).max(2000),
        sentiment: sentimentSchema,
        confidence: z.coerce.number().int().min(0).max(100).optional(),
        catalyst: z.string().trim().max(200).optional().nullable(),
        risk: z.string().trim().max(200).optional().nullable(),
        publishedAt: z.string().datetime().optional(),
      }),
    )
    .max(25)
    .optional(),
  evidence: z
    .array(
      z.object({
        sourceType: z.string().trim().min(1).max(40),
        sourceName: z.string().trim().min(1).max(120),
        url: z.string().url().max(500).optional().nullable(),
        title: z.string().trim().min(1).max(300),
        excerpt: z.string().trim().min(1).max(2000),
        engagement: z.coerce.number().int().min(0).max(10000000).optional(),
        observedAt: z.string().datetime().optional(),
      }),
    )
    .max(100)
    .optional(),
  thesis: z
    .object({
      stance: stanceSchema,
      conviction: z.coerce.number().int().min(0).max(100),
      thesis: z.string().trim().min(1).max(6000),
      bullCase: z.string().trim().min(1).max(3000),
      bearCase: z.string().trim().min(1).max(3000),
      actionItems: z.array(z.string().trim().min(1).max(200)).max(12),
    })
    .optional()
    .nullable(),
  forecasts: z
    .array(
      z.object({
        horizon: z.string().trim().min(1).max(20),
        targetPrice: z.coerce.number().positive(),
        lowerBound: z.coerce.number().positive(),
        upperBound: z.coerce.number().positive(),
        confidence: z.coerce.number().int().min(0).max(100),
        model: z.string().trim().min(1).max(120),
        generatedAt: z.string().datetime().optional(),
      }),
    )
    .max(20)
    .optional(),
});

function assertWorkerAccess(request: Request) {
  const expectedToken = process.env.QUANT_WORKER_API_TOKEN;
  if (!expectedToken) return;
  const actualToken = request.headers.get("x-worker-token");
  if (actualToken !== expectedToken) {
    throw new Error("Unauthorized worker request.");
  }
}

export async function POST(request: Request) {
  try {
    assertWorkerAccess(request);
    const payload = researchImportSchema.parse(await request.json());
    return NextResponse.json(await importResearchRun(payload), { status: 201 });
  } catch (error) {
    const status =
      error instanceof z.ZodError
        ? 400
        : error instanceof Error && error.message === "Unauthorized worker request."
          ? 401
          : 503;
    return apiError(error, status);
  }
}
