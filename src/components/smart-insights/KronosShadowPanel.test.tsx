import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/DataStatusBadge", () => ({
  DataStatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

import type { KronosShadowModel } from "@/lib/smart-insights-client";

import { KronosShadowPanel } from "./KronosShadowPanel";

const view: KronosShadowModel = {
  asset: "BTC",
  model: "kronos-small",
  state: "READY_SHADOW",
  decisionUse: "NONE",
  completedOos: 180,
  minimumOos: 180,
  generatedAt: "2026-08-14T00:00:00Z",
  modelRevision: "901c26c",
  forecasts: [1, 3, 7].map((days) => ({
    days: days as 1 | 3 | 7,
    median: 100 + days,
    lower: 90 + days,
    upper: 110 + days,
    forecastFor: `2026-08-${14 + days}T00:00:00Z`,
  })),
  metrics: [
    {
      model: "kronos-small",
      mae: 5,
      mase: 0.8,
      directionalAccuracy: 0.57,
      spearmanIc: 0.1,
      intervalCoverage: 0.8,
      calibrationError: 0,
    },
    {
      model: "random-walk",
      mae: 6,
      mase: 1,
      directionalAccuracy: 0.5,
      spearmanIc: 0,
      intervalCoverage: null,
      calibrationError: null,
    },
  ],
  rollingErrors: [
    {
      ts: "2026-08-14T00:00:00Z",
      horizon: 7,
      model: "kronos-small",
      absoluteError: 5,
      directionCorrect: true,
      volatilityRegime: "NORMAL",
    },
  ],
  history: [
    {
      generatedAt: "2026-08-07T00:00:00Z",
      forecastFor: "2026-08-14T00:00:00Z",
      days: 7,
      predicted: 100,
      realized: 105,
    },
  ],
  methodology: "kronos-btc-shadow-v1",
};

describe("KronosShadowPanel", () => {
  it("keeps the experimental disclaimer and chart/table hierarchy visible", () => {
    const html = renderToStaticMarkup(<KronosShadowPanel data={view} state="loaded" locale="vi" />);
    expect(html).toContain("SHADOW / KHÔNG DÙNG CHO QUYẾT ĐỊNH");
    expect(html).toContain("Khoảng dự báo BTC");
    expect(html).toContain("Sai số rolling");
    expect(html).toContain("So sánh benchmark");
    expect(html).toContain("Lịch sử dự báo");
    expect(html).toContain("180 / 180");
    expect(html).not.toMatch(/mua|bán|khuyến nghị/i);
    expect(html).not.toContain("animationDuration");
  });

  it("renders explicit unavailable and failed states without fake data", () => {
    const unavailable = renderToStaticMarkup(
      <KronosShadowPanel
        data={{ ...view, state: "UNAVAILABLE", forecasts: [], metrics: [], history: [] }}
        state="loaded"
        locale="vi"
      />,
    );
    const failed = renderToStaticMarkup(
      <KronosShadowPanel data={null} state="failed" locale="vi" />,
    );
    expect(unavailable).toContain("Chưa có đánh giá shadow");
    expect(failed).toContain("Không thể tải đánh giá shadow");
    expect(unavailable).not.toContain("Dữ liệu mẫu");
  });

  it("uses compact stacked rows for forecast history on mobile", () => {
    const html = renderToStaticMarkup(<KronosShadowPanel data={view} state="loaded" locale="en" />);
    expect(html).toContain("sm:hidden");
    expect(html).toContain("hidden sm:block");
    expect(html).toContain("SHADOW / NOT USED IN DECISIONS");
  });
});
