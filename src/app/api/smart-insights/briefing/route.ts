import { NextResponse } from "next/server";

import { apiError } from "@/app/api/_lib";
import { AuthenticationRequiredError } from "@/lib/auth/errors";
import {
  requireTenantCapability,
  requireTenantContext,
  resolvePublicMarketTenantContext,
} from "@/lib/auth/tenant-context";
import {
  loadBriefingEnvelope,
  smartInsightsToday,
  SmartInsightsInputError,
} from "@/lib/backend/smart-insights";
import {
  enqueueBriefingRefresh,
  loadBriefingRefreshState,
} from "@/lib/backend/smart-insights-refresh";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    let personalContext = true;
    const context = await requireTenantContext().catch((error: unknown) => {
      if (error instanceof AuthenticationRequiredError) {
        personalContext = false;
        return resolvePublicMarketTenantContext();
      }
      throw error;
    });
    if (personalContext) requireTenantCapability(context, "research", "read");
    const requestedDate = new URL(request.url).searchParams.get("date");
    const today = smartInsightsToday();
    const tracksCurrentRefresh = personalContext && (!requestedDate || requestedDate === today);
    const [envelope, refresh] = await Promise.all([
      loadBriefingEnvelope(context, requestedDate),
      tracksCurrentRefresh
        ? loadBriefingRefreshState(context)
        : Promise.resolve({ state: "idle" as const, errorCode: null }),
    ]);
    if (!envelope) {
      const headers = {
        "Cache-Control": "private, no-cache",
        "X-Smart-Insights-Briefing-State": refresh.state,
      };
      if (requestedDate && requestedDate !== today) {
        return NextResponse.json(
          { state: "idle", errorCode: "BRIEFING_NOT_GENERATED_FOR_DATE" },
          { status: 404, headers },
        );
      }
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
