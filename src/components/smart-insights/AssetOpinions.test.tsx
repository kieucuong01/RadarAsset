import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AssetOpinionModel } from "@/lib/smart-insights-client";

import { AssetOpinions } from "./AssetOpinions";

function opinion(overrides: Partial<AssetOpinionModel> = {}): AssetOpinionModel {
  return {
    symbol: "BTC",
    assetName: "Bitcoin",
    stance: "CONSTRUCTIVE",
    quantScore: "32.50",
    confidence: "72.00",
    horizon: "WEEKS_1_4",
    portfolioWeightPct: "18.00",
    personalizedAction: "HOLD",
    pillars: [
      {
        code: "trend",
        score: "45.00",
        weight: "0.40",
        confidence: "80.00",
        factIds: ["e1"],
        series: [
          { ts: "2026-08-14T00:00:00Z", value: 40 },
          { ts: "2026-08-15T00:00:00Z", value: 45 },
        ],
      },
    ],
    thesis: "Xu hướng BTC đang mang tính xây dựng.",
    bullCase: "Dòng tiền 1.00 tiếp tục hỗ trợ.",
    baseCase: "Theo dõi xác nhận dòng tiền 1.00.",
    bearCase: "Dòng tiền 1.00 đảo chiều.",
    invalidationConditions: ["Dòng tiền 1.00 không còn hiệu lực."],
    evidence: [
      {
        id: "e1",
        metricCode: "crypto.etf_flow",
        displayValue: "1.00",
        delta: null,
        percentile: null,
        impact: "supporting",
        sourceCode: "farside",
        sourceUrl: "https://example.test/farside",
        effectiveAt: "2026-08-15T00:00:00Z",
        observedAt: "2026-08-15T00:00:00Z",
        freshness: "fresh",
      },
    ],
    dataCoverage: "0.80",
    freshness: "fresh",
    explanationStatus: "accepted",
    failedGates: [],
    ...overrides,
  };
}

describe("AssetOpinions", () => {
  it("renders table, mobile cards, three scenarios, and numerical evidence", () => {
    const html = renderToStaticMarkup(
      <AssetOpinions opinions={[opinion()]} locale="vi" onEvidence={() => undefined} />,
    );
    expect(html).toContain("Quan điểm AI theo tài sản");
    expect(html).toContain("hidden md:block");
    expect(html).toContain("md:hidden");
    expect(html).toContain("Kịch bản cơ sở");
    expect(html).toContain("Nguồn &amp; độ mới");
    expect(html).toContain("1.00");
    expect(html).not.toContain("animationDuration");
  });

  it("shows explicit quant-only and insufficient states without sample prose", () => {
    const html = renderToStaticMarkup(
      <AssetOpinions
        opinions={[
          opinion({
            symbol: "XAU",
            assetName: "Gold",
            thesis: null,
            explanationStatus: "quant_only",
          }),
          opinion({
            symbol: "VNINDEX",
            assetName: "VN-Index",
            stance: "INSUFFICIENT_DATA",
            thesis: null,
            personalizedAction: "NO_ACTION_INSUFFICIENT_DATA",
            explanationStatus: "insufficient_data",
            failedGates: ["SOURCE_FAMILIES_MINIMUM_2"],
          }),
        ]}
        locale="vi"
        onEvidence={() => undefined}
      />,
    );
    expect(html).toContain("Chỉ có quan điểm định lượng");
    expect(html).toContain("Chưa đủ bằng chứng");
    expect(html).not.toContain("Dữ liệu mẫu");
  });

  it("renders a useful empty state without fetching", () => {
    const html = renderToStaticMarkup(
      <AssetOpinions opinions={[]} locale="vi" onEvidence={() => undefined} />,
    );
    expect(html).toContain("Chưa có quan điểm theo tài sản");
  });
});
