import { NextResponse } from "next/server";

import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { loadEvidence } from "@/lib/backend/smart-insights";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "research", "read");
    const evidence = await loadEvidence(context, (await params).id);
    return evidence ? NextResponse.json(evidence) : NextResponse.json({ error: "Evidence not found." }, { status: 404 });
  } catch (error) {
    return apiError(error);
  }
}
