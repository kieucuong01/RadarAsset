import { NextResponse } from "next/server";

import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { loadBriefingEnvelope, SmartInsightsInputError } from "@/lib/backend/smart-insights";
import {
  enqueueBriefingRefresh,
  loadBriefingRefreshState,
} from "@/lib/backend/smart-insights-refresh";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "research", "read");
    const [envelope, refresh] = await Promise.all([
      loadBriefingEnvelope(context, new URL(request.url).searchParams.get("date")),
      loadBriefingRefreshState(context),
    ]);
    if (!envelope) {
      const headers = {
        "Cache-Control": "private, no-cache",
        "X-Smart-Insights-Briefing-State": refresh.state,
      };
      if (refresh.state === "generating") {
        return NextResponse.json(refresh, { status: 202, headers });
      }
      if (refresh.state === "failed") {
        return NextResponse.json(
          { state: "failed", errorCode: refresh.errorCode ?? "BRIEFING_GENERATION_FAILED" },
          { status: 503, headers },
        );
      }
      return NextResponse.json(
        { state: "idle", errorCode: "BRIEFING_NOT_GENERATED" },
        { status: 404, headers },
      );
    }
    const headers = {
      "Cache-Control": "private, no-store",
      "X-Smart-Insights-Briefing-State": "ready",
    };
    return NextResponse.json(envelope.briefing, { headers });
  } catch (error) {
    return apiError(error, error instanceof SmartInsightsInputError ? 400 : 503);
  }
}

export async function POST() {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "research", "write");
    const refresh = await enqueueBriefingRefresh(context, "manual_refresh");
    return NextResponse.json(
      { ...refresh, state: "generating" },
      {
        status: 202,
        headers: {
          "Cache-Control": "private, no-cache",
          "X-Smart-Insights-Briefing-State": "generating",
        },
      },
    );
  } catch (error) {
    return apiError(error);
  }
}
