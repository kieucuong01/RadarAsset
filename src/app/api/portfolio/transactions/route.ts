import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/app/api/_lib";
import { createPortfolioTransaction } from "@/lib/backend/db";
import { PortfolioDomainError } from "@/lib/backend/portfolio";

export const dynamic = "force-dynamic";

const transactionSchema = z.object({
  symbol: z.string().min(1),
  type: z.enum(["buy", "sell"]),
  quantity: z.coerce.number().positive(),
  price: z.coerce.number().positive(),
  fee: z.coerce.number().min(0).default(0),
  executedAt: z
    .string()
    .datetime()
    .refine((value) => new Date(value).getTime() <= Date.now(), {
      message: "Execution time cannot be in the future.",
    })
    .optional(),
  note: z.string().trim().max(500).optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const payload = transactionSchema.parse(await request.json());
    const portfolio = await createPortfolioTransaction(payload);
    return NextResponse.json(portfolio, { status: 201 });
  } catch (error) {
    const status =
      error instanceof z.ZodError ? 400 : error instanceof PortfolioDomainError ? 409 : 503;
    return apiError(error, status);
  }
}
