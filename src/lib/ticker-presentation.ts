import type { DataStatus } from "@/lib/mvp-ui";

export type TickerSnapshot<T> = {
  rows: T[];
  status: Extract<DataStatus, "SYSTEM" | "SAMPLE">;
  detail: string;
};

export function resolveTickerSnapshot<T>(rows: T[], fallback: T[]): TickerSnapshot<T> {
  if (rows.length === 0) {
    return {
      rows: fallback,
      status: "SAMPLE",
      detail: "Ticker API không có dữ liệu; đang hiển thị dữ liệu mẫu.",
    };
  }

  return {
    rows,
    status: "SYSTEM",
    detail: "Được tải từ /api/market/ticker.",
  };
}
