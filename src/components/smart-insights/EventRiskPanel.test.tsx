import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { lineChartData } = vi.hoisted(() => ({ lineChartData: vi.fn() }));

vi.mock("recharts", () => {
  const Container = ({ children }: { children?: ReactNode }) => <>{children}</>;

  return {
    CartesianGrid: () => null,
    Line: () => null,
    LineChart: ({ children, data }: { children?: ReactNode; data: unknown }) => {
      lineChartData(data);
      return <>{children}</>;
    },
    ResponsiveContainer: Container,
    Tooltip: ({ formatter }: { formatter?: (value: number) => [ReactNode, ReactNode] }) => {
      const formatted = formatter?.(12.34567);
      return formatted ? <span>{formatted}</span> : null;
    },
    XAxis: () => null,
    YAxis: () => null,
  };
});

vi.mock("@/components/DataStatusBadge", () => ({
  DataStatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

import type { MacroEventRiskModel } from "@/lib/smart-insights-client";

import { EventRiskPanel } from "./EventRiskPanel";

function textContent(html: string): string {
  return html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&");
}

const model: MacroEventRiskModel = {
  generatedAt: "2026-08-16T00:00:00Z",
  methodology: "macro-event-risk-v1",
  status: "AVAILABLE",
  score: 67.8912,
  freshWeight: 0.678912,
  asOf: "2026-08-16T00:00:00Z",
  components: [
    {
      code: "macro.event.severity",
      value: 12_345.67891,
      weight: 0.333333,
      fresh: true,
      evidenceIds: ["evidence-1"],
    },
  ],
  timeline: [{ ts: "2026-08-15T00:00:00Z", score: 12.34567, category: "geopolitical" }],
  events: [
    {
      id: "event-1",
      category: "geopolitical",
      subcategory: null,
      title: "Event title",
      country: "VN",
      region: null,
      occurredAt: "2026-08-15T00:00:00Z",
      severity: 88.8888,
      corroborationCount: 12_345,
      status: "active",
      qualityFlags: [],
      sources: [
        {
          sourceCode: "source-1",
          sourceUrl: "https://example.test/event",
          observedAt: "2026-08-15T00:00:00Z",
        },
      ],
    },
  ],
  assetImpacts: [
    {
      asset: "BTC",
      direction: "headwind",
      score: -26.7891,
      methodology: "macro-event-asset-impact-v1",
    },
    {
      asset: "XAU",
      direction: "tailwind",
      score: 40.73472,
      methodology: "macro-event-asset-impact-v1",
    },
  ],
};

describe("EventRiskPanel financial formatting", () => {
  it("trims display precision, declares units, and keeps chart series numeric", () => {
    const text = textContent(
      renderToStaticMarkup(<EventRiskPanel data={model} state="loaded" locale="vi" />),
    );

    expect(text).toContain("67.89 /100");
    expect(text).toContain("67.89%");
    expect(text).toContain("BTC impact−26.79 score");
    expect(text).toContain("XAU impact40.73 score");
    expect(text).not.toContain("BTC impact−26.79%");
    expect(text).not.toContain("XAU impact40.73%");
    expect(text).toContain("12,345.6789 · 33.33%");
    expect(text).toContain("88.89/100");
    expect(text).toContain("12,345 nguồn");
    expect(text).toContain("12.35Severity /100");
    expect(text).not.toContain("%%");

    expect(lineChartData).toHaveBeenCalledWith(model.timeline);
    expect(model.timeline[0]?.score).toBeTypeOf("number");
  });
});
