import { z } from "zod";
import { NextResponse } from "next/server";
import { apiError } from "@/app/api/_lib";
import { requireTenantCapability, requireTenantContext } from "@/lib/auth/tenant-context";
import { markNotificationRead } from "@/lib/backend/strategy-forward-tests";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "portfolio", "read");
    z.object({ read: z.literal(true) })
      .strict()
      .parse(await request.json());
    await markNotificationRead(context, (await params).id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
