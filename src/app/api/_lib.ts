import { NextResponse } from "next/server";

export function apiError(error: unknown, status = 503) {
  const message = error instanceof Error ? error.message : "Unexpected API error.";
  return NextResponse.json({ error: message }, { status });
}
