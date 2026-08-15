import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AssetOpinionModel, EvidenceModel } from "@/lib/smart-insights-client";

import { AssetOpinions } from "./AssetOpinions";
import { formatEvidenceDisplayValue } from "./evidence-display-value";

function opinion(overrides: Partial<AssetOpinionModel> = {}): AssetOpinionModel {
  return {
    symbol: "BTC",
    assetName: "Bitcoin",
    stance: "CONSTRUCTIVE",
    quantScore: "32.50",
    confidence: "72.00",
    horizon: "WEEKS_1_4",
    portfolioWeightPct: "18.00",
    unrealizedReturn: "0.12",
    riskTolerance: "moderate",
    personalizedAction: "HOLD",
    pillars: [
      {
        code: "trend",
        score: "45.00",
        weight: "0.40",
        confidence: "80.00",
        availableInputWeight: "1.00",
        contribution: "18.00",
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
    quantInvalidationConditions: ["ASSET_SCORE_BELOW_15"],
    formula: "asset_score = Σ(pillar_score × pillar_weight) ÷ data_coverage",
    totalContribution: "26.00",
    decisionInputs: [
      {
        evidenceId: "e1",
        metricCode: "crypto.etf.net_flow_usd",
        pillarCode: "fund_flow",
        rawValue: "1.00",
        unit: "USD_MILLION",
        normalizedScore: "60.00",
        inputWeight: "0.75",
        weightedScore: "45.00",
        pillarWeight: "0.30",
        contribution: "13.50",
        normalizationMethod: "empirical_percentile",
        percentile: "0.80",
        lookback: "90D",
      },
      {
        evidenceId: "e2",
        metricCode: "macro.real_yield.10y_pct",
        pillarCode: "macro",
        rawValue: "2.10",
        unit: "PERCENT",
        normalizedScore: "-40.00",
        inputWeight: "0.25",
        weightedScore: "-10.00",
        pillarWeight: "0.15",
        contribution: "-1.50",
        normalizationMethod: "empirical_percentile",
        percentile: "0.90",
        lookback: null,
      },
    ],
    supportingEvidenceIds: ["e1"],
    contradictingEvidenceIds: ["e2"],
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
        usedInDecision: true,
      },
      {
        id: "e2",
        metricCode: "macro.real_yield.10y_pct",
        displayValue: "2.10%",
        delta: null,
        percentile: "0.90",
        impact: "contradicting",
        sourceCode: "fred",
        sourceUrl: "https://example.test/fred",
        effectiveAt: "2026-08-15T00:00:00Z",
        observedAt: "2026-08-15T00:00:00Z",
        freshness: "fresh",
        usedInDecision: true,
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
      <AssetOpinions
        opinions={[opinion()]}
        portfolioState="available"
        locale="vi"
        onEvidence={() => undefined}
      />,
    );
    expect(html).toContain("Quan điểm AI theo tài sản");
    expect(html).toContain("hidden md:block");
    expect(html).toContain("md:hidden");
    expect(html).toContain("Kịch bản cơ sở");
    expect(html).toContain("Quan điểm định lượng chung");
    expect(html).toContain("Quan điểm theo danh mục");
    expect(html).toContain("Tỷ trọng hiện tại");
    expect(html).toContain("Khẩu vị rủi ro");
    expect(html).toContain("Nguồn &amp; độ mới");
    expect(html).toContain("AI đã phân tích");
    expect(html).toContain("Vì các số liệu này");
    expect(html).toContain("Yếu tố phản biện");
    expect(html).toContain("Điều kiện đổi quan điểm");
    expect(html).toContain("Cách tính chi tiết");
    expect(html).toContain("Điểm chuẩn hóa");
    expect(html).toContain("Đóng góp");
    expect(html).toContain("1.00");
    expect(html).not.toContain("animationDuration");
  });

  it("formats decision evidence from raw values and preserves unmatched provider values", () => {
    const html = renderToStaticMarkup(
      <AssetOpinions
        opinions={[
          opinion({
            quantScore: "-16.7700",
            portfolioWeightPct: "39.2",
            decisionInputs: [
              {
                ...opinion().decisionInputs[0],
                rawValue: "120.250000",
                contribution: "-16.7700",
              },
            ],
            supportingEvidenceIds: ["e1"],
            contradictingEvidenceIds: [],
            evidence: [
              {
                ...opinion().evidence[0],
                displayValue: "120.250000",
              },
              {
                ...opinion().evidence[0],
                id: "provider-only",
                displayValue: "$95.4m",
                impact: "neutral",
                sourceCode: "provider",
              },
            ],
          }),
        ]}
        portfolioState="available"
        locale="vi"
        onEvidence={() => undefined}
      />,
    );

    expect(html).toContain("−16.77");
    expect(html).toContain("39.2%");
    expect(html).toContain("120.25 triệu USD");
    expect(html).not.toContain("120.250000");
    expect(html).toContain("$95.4m");
  });

  it("formats evidence drawer raw values and preserves provider display values without metadata", () => {
    const evidence: EvidenceModel = {
      id: "drawer-raw",
      metricCode: "crypto.etf.net_flow_usd",
      asset: "BTC",
      rawValue: "120.250000",
      displayValue: "120.250000",
      unit: "USD_MILLION",
      effectiveStart: "2026-08-15T00:00:00Z",
      effectiveEnd: "2026-08-15T00:00:00Z",
      observedAt: "2026-08-15T00:00:00Z",
      sourceCode: "farside",
      sourceUrl: null,
      methodologyVersion: "v1",
      warnings: [],
      formula: null,
      history: [],
    };
    expect(formatEvidenceDisplayValue(evidence, "en")).toBe("120.25 USD million");
    expect(formatEvidenceDisplayValue(evidence, "en")).not.toBe("120.250000");
    expect(
      formatEvidenceDisplayValue(
        { ...evidence, rawValue: "", unit: "", displayValue: "$95.4m" },
        "en",
      ),
    ).toBe("$95.4m");
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
        portfolioState="available"
        locale="vi"
        onEvidence={() => undefined}
      />,
    );
    expect(html).toContain("Chỉ có quan điểm định lượng");
    expect(html).toContain("Chưa đủ bằng chứng");
    expect(html).toContain("Phân tích định lượng");
    expect(html).toContain("Chưa đủ dữ liệu");
    expect(html).toContain("Cần ít nhất 2 nhóm nguồn dữ liệu độc lập");
    expect(html).not.toContain("AI đã phân tích");
    expect(html).not.toContain("Dòng tiền 1.00 tiếp tục hỗ trợ");
    expect(html).not.toContain("Dữ liệu mẫu");
  });

  it("labels technical quant opinions and states their confidence limitation", () => {
    const technicalInput = {
      ...opinion().decisionInputs[0],
      metricCode: "market.return_20d",
      pillarCode: "trend",
    };
    const html = renderToStaticMarkup(
      <AssetOpinions
        opinions={[
          opinion({
            symbol: "XAU",
            assetName: "Gold",
            explanationStatus: "quant_only",
            decisionInputs: [
              technicalInput,
              { ...technicalInput, evidenceId: "e2", metricCode: "market.return_60d" },
              { ...technicalInput, evidenceId: "e3", metricCode: "market.ma_50_position" },
            ],
            evidence: [
              opinion().evidence[0],
              { ...opinion().evidence[1], id: "e2", metricCode: "market.return_60d" },
              { ...opinion().evidence[1], id: "e3", metricCode: "market.ma_50_position" },
            ],
            supportingEvidenceIds: ["e1"],
            contradictingEvidenceIds: ["e2"],
          }),
        ]}
        portfolioState="available"
        locale="vi"
        onEvidence={() => undefined}
      />,
    );

    expect(html).toContain("Quant kỹ thuật");
    expect(html).toContain("Độ tin cậy được giới hạn");
    expect(html).toContain("vĩ mô/lợi suất và vị thế CFTC");
  });

  it("distinguishes a missing portfolio from a real zero-weight asset", () => {
    const html = renderToStaticMarkup(
      <AssetOpinions
        opinions={[opinion({ portfolioWeightPct: "0" })]}
        portfolioState="missing"
        locale="vi"
        onEvidence={() => undefined}
      />,
    );

    expect(html).toContain("Chưa có danh mục để tính mức phơi nhiễm");
    expect(html).toContain("Tỷ trọng hiện tại");
  });

  it("labels altcoin factors and data-backed change conditions in Vietnamese", () => {
    const html = renderToStaticMarkup(
      <AssetOpinions
        opinions={[
          opinion({
            symbol: "ETH",
            assetName: "Ethereum",
            pillars: [
              { ...opinion().pillars[0], code: "btc_trend" },
              { ...opinion().pillars[0], code: "altcoin_rotation" },
              { ...opinion().pillars[0], code: "etf_flow" },
              { ...opinion().pillars[0], code: "macro" },
            ],
            decisionInputs: [
              {
                ...opinion().decisionInputs[0],
                metricCode: "crypto.btc.return_20d",
                pillarCode: "btc_trend",
              },
              {
                ...opinion().decisionInputs[0],
                evidenceId: "rotation",
                metricCode: "crypto.cycle.altcoin_season.index",
                pillarCode: "altcoin_rotation",
              },
              {
                ...opinion().decisionInputs[0],
                evidenceId: "m2",
                metricCode: "macro.m2_change_4w",
                pillarCode: "macro",
              },
            ],
            quantInvalidationConditions: [
              "BTC_TREND_TURNS_NEGATIVE",
              "ALTCOIN_SEASON_BELOW_75",
              "ETH_ETF_FLOW_TURNS_NEGATIVE",
            ],
          }),
        ]}
        portfolioState="available"
        locale="vi"
        onEvidence={() => undefined}
      />,
    );

    expect(html).toContain("Xu hướng BTC");
    expect(html).toContain("Luân chuyển Altcoin");
    expect(html).toContain("Dòng tiền ETF");
    expect(html).toContain("Cung tiền M2 4 tuần");
    expect(html).toContain("Xu hướng BTC chuyển sang âm");
    expect(html).toContain("Altcoin Season giảm xuống dưới 75");
    expect(html).toContain("Dòng tiền ETF ETH chuyển sang âm");
  });

  it("renders a useful empty state without fetching", () => {
    const html = renderToStaticMarkup(
      <AssetOpinions
        opinions={[]}
        portfolioState="missing"
        locale="vi"
        onEvidence={() => undefined}
        generationState="idle"
        onRefresh={() => undefined}
      />,
    );
    expect(html).toContain("Chưa tạo quan điểm theo tài sản");
    expect(html).toContain("Tạo quan điểm AI");
  });

  it("explains generating and failed states with a retry action", () => {
    const generating = renderToStaticMarkup(
      <AssetOpinions
        opinions={[]}
        portfolioState="available"
        locale="vi"
        onEvidence={() => undefined}
        generationState="generating"
        onRefresh={() => undefined}
      />,
    );
    const failed = renderToStaticMarkup(
      <AssetOpinions
        opinions={[]}
        portfolioState="available"
        locale="vi"
        onEvidence={() => undefined}
        generationState="failed"
        onRefresh={() => undefined}
      />,
    );

    expect(generating).toContain("Đang tổng hợp dữ liệu định lượng");
    expect(failed).toContain("Không thể tạo quan điểm");
    expect(failed).toContain("Thử lại");
    expect(generating).not.toContain("Dữ liệu mẫu");
  });
});
