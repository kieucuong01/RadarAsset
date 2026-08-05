import type { WatchlistItemResponse } from "@/lib/backend/types";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function saveWatchlistItem(
  input: { symbol: string; alert?: number | null },
  request: FetchLike = fetch,
): Promise<WatchlistItemResponse[]> {
  const payload = {
    symbol: input.symbol.trim().toUpperCase(),
    alert: input.alert ?? null,
  };
  const response = await request("/api/watchlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => null)) as
    | WatchlistItemResponse[]
    | { error?: string }
    | null;

  if (!response.ok) {
    const message = !Array.isArray(body) && body?.error;
    throw new Error(message || "Không thể thêm tài sản vào watchlist.");
  }

  if (!Array.isArray(body)) {
    throw new Error("Watchlist API trả về dữ liệu không hợp lệ.");
  }

  return body;
}
