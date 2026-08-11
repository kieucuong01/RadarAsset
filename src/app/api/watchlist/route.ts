import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { loadWatchlist, upsertWatchlistItem } from "@/lib/backend/db";

export const dynamic = "force-dynamic";

const watchlistSchema = z
  .object({
    symbol: z.string().trim().min(1).max(20).optional(),
    providerCode: z.string().trim().min(1).max(40).optional(),
    providerSymbol: z.string().trim().min(1).max(80).optional(),
    requestedTimeframes: z
      .array(z.enum(["1d", "1h"]))
      .max(2)
      .optional(),
    alert: z.coerce.number().positive().optional().nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasProvider = Boolean(value.providerCode || value.providerSymbol);
    if (!value.symbol && !hasProvider) {
      context.addIssue({ code: "custom", path: ["symbol"], message: "Asset is required." });
    }
    if (Boolean(value.providerCode) !== Boolean(value.providerSymbol)) {
      context.addIssue({
        code: "custom",
        path: [value.providerCode ? "providerSymbol" : "providerCode"],
        message: "Provider code and symbol must be provided together.",
      });
    }
  });

export async function GET() {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "watchlist", "read");
    return NextResponse.json(await loadWatchlist(context));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "watchlist", "write");
    const payload = watchlistSchema.parse(await request.json());
    const watchlist = await upsertWatchlistItem(context, payload);
    return NextResponse.json(watchlist, { status: 201 });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 503;
    return apiError(error, status);
  }
}
