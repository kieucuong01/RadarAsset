import { z } from "zod";

import type { WatchlistItemResponse } from "@/lib/backend/types";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const favoriteSchema = z
  .object({
    id: z.string().min(1),
    sym: z.string().min(1),
    name: z.string().min(1),
    price: z.number(),
    chg: z.number(),
    alert: z.number().nonnegative(),
    sentiment: z.enum(["bull", "bear", "neutral"]),
    datasetState: z.enum(["ready", "stale", "loading", "unavailable"]),
    ingestionRequestId: z.string().nullable(),
    backtestableTimeframes: z.array(z.enum(["1d", "1h"])),
  })
  .strict();

function parseFavorites(input: unknown): WatchlistItemResponse[] {
  const parsed = z.array(favoriteSchema).safeParse(input);
  if (!parsed.success) throw new Error("Watchlist API returned invalid favorite data.");
  return parsed.data;
}

async function responseBody(response: Response) {
  return (await response.json().catch(() => null)) as unknown;
}

export async function loadFavoriteAssets(request: FetchLike = fetch) {
  const response = await request("/api/watchlist", { cache: "no-store" });
  const body = await responseBody(response);
  if (!response.ok) throw new Error("Không thể tải danh sách tài sản yêu thích.");
  return parseFavorites(body);
}

export async function saveWatchlistItem(
  input: { symbol: string; alert?: number | null },
  request: FetchLike = fetch,
): Promise<WatchlistItemResponse[]> {
  const payload = { symbol: input.symbol.trim().toUpperCase(), alert: input.alert ?? null };
  const response = await request("/api/watchlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await responseBody(response);
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : null;
    throw new Error(message || "Không thể thêm tài sản vào danh sách yêu thích.");
  }
  return parseFavorites(body);
}

export async function addFavoriteAsset(
  input: {
    providerCode: string;
    providerSymbol: string;
    alert?: number | null;
    requestedTimeframes?: Array<"1d" | "1h">;
  },
  request: FetchLike = fetch,
) {
  const response = await request("/api/watchlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      providerCode: input.providerCode,
      providerSymbol: input.providerSymbol,
      alert: input.alert ?? null,
      requestedTimeframes: input.requestedTimeframes ?? ["1d", "1h"],
    }),
  });
  const body = await responseBody(response);
  if (!response.ok) throw new Error("Không thể thêm tài sản yêu thích hoặc chuẩn bị dữ liệu.");
  return parseFavorites(body);
}

export async function removeFavoriteAsset(id: string, request: FetchLike = fetch) {
  const response = await request(`/api/watchlist/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (response.status !== 204) throw new Error("Không thể xóa tài sản khỏi danh sách yêu thích.");
}
