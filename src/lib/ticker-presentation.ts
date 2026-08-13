import type { DataStatus } from "@/lib/mvp-ui";

export type TickerSnapshot<T> = {
  rows: T[];
  status: Extract<DataStatus, "SYSTEM" | "UNAVAILABLE">;
  detail: string;
};

export function resolveTickerSnapshot<T>(rows: T[]): TickerSnapshot<T> {
  if (rows.length === 0) {
    return {
      rows: [],
      status: "UNAVAILABLE",
      detail: "Ticker API không có dữ liệu đã xác thực.",
    };
  }

  return {
    rows,
    status: "SYSTEM",
    detail: "Được tải từ /api/market/ticker.",
  };
}
