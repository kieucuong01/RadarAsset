import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { searchProviderInstruments } from "@/lib/backend/provider-catalog";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().max(40).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function GET(request: Request) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "watchlist", "read");
    const url = new URL(request.url);
    const query = querySchema.parse({
      q: url.searchParams.get("q") ?? "",
      limit: url.searchParams.get("limit") ?? 20,
    });
    return NextResponse.json(await searchProviderInstruments(query));
  } catch (error) {
    return apiError(error, error instanceof z.ZodError ? 400 : 503);
  }
}
