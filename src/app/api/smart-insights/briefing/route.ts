import { NextResponse } from "next/server";

import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { loadBriefingEnvelope, SmartInsightsInputError } from "@/lib/backend/smart-insights";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "research", "read");
    const envelope = await loadBriefingEnvelope(
      context,
      new URL(request.url).searchParams.get("date"),
    );
    if (!envelope) {
      return NextResponse.json({ error: "Briefing not found." }, { status: 404 });
    }
    const etag = `"${envelope.fingerprint}"`;
    const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
    if (request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers });
    }
    return NextResponse.json(envelope.briefing, { headers });
  } catch (error) {
    return apiError(error, error instanceof SmartInsightsInputError ? 400 : 503);
  }
}
