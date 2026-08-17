import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PortfolioResponse, WatchlistItemResponse } from "@/lib/backend/types";
import type { AssetOpinionModel, EvidenceModel } from "@/lib/smart-insights-client";

import { AssetOpinionFormula } from "./AssetOpinionCalculation";
import { AssetOpinionDetailContent } from "./AssetOpinionDetail";
import { AssetOpinionScenarios } from "./AssetOpinionModalContent";
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

const watchlist: WatchlistItemResponse[] = [
  {
    id: "watch-eth",
    sym: "ETH",
    name: "Ethereum",
    price: 3_250,
    chg: 2.1,
    alert: 0,
    sentiment: "bull",
    datasetState: "ready",
    ingestionRequestId: null,
    backtestableTimeframes: ["1d"],
    currency: "USDT",
    hasMarketQuote: true,
  },
];

const portfolio: PortfolioResponse = {
  portfolioId: "portfolio-1",
  portfolioName: "Main",
  baseCurrency: "VND",
  totalValue: 100_000_000,
  totalCost: 90_000_000,
  unrealizedPnL: 10_000_000,
  realizedPnL: 0,
  totalPnL: 10_000_000,
  totalPnLPct: 11.11,
  cumulativeBuyCapital: 90_000_000,
  dayChangePct: 0.5,
  allocation: [{ category: "Stocks", value: 100_000_000 }],
  holdings: [
    {
      assetId: "asset-fpt",
      ticker: "FPT",
      name: "FPT Corporation",
      qty: 100,
      price: 100_000,
      cost: 90_000,
      value: 10_000_000,
      pnl: 1_000_000,
      pnlPct: 11.11,
      alloc: 10,
      sentiment: "Bullish",
      category: "Stocks",
      currency: "VND",
    },
  ],
  transactions: [],
  performance: [],
  riskMetrics: [],
  dataAsOf: "2026-08-16T00:00:00Z",
  dataSource: "test",
};

describe("AssetOpinions", () => {
  it("shows bounded realized shadow performance in the analysis modal", () => {
    const html = renderToStaticMarkup(
      <AssetOpinionDetailContent
        opinion={opinion({
          performance: {
            status: "limited",
            horizons: [
              {
                horizonSessions: 5,
                sampleSize: 12,
                hitRate: "0.5833",
                averageReturn: "0.021",
                averageExcessReturn: "0.008",
              },
            ],
          },
        })}
        portfolioState="available"
        locale="vi"
        onEvidence={() => undefined}
      />,
    );

    expect(html).toContain("Hiệu quả lịch sử · Shadow");
    expect(html).toContain("Mẫu còn ít");
    expect(html).toContain("58.33%");
    expect(html).toContain("Vượt mốc tham chiếu");
  });

  it("merges followed assets with opinion actions and protects holdings and representatives", () => {
    const html = renderToStaticMarkup(
      <AssetOpinions
        opinions={[opinion()]}
        portfolioState="available"
        locale="vi"
        onEvidence={() => undefined}
        watchlist={watchlist}
        watchlistAvailable
        watchlistError={null}
        portfolio={portfolio}
        portfolioAvailable
        onWatchlistSaved={() => undefined}
        onRemoveTrackedAsset={async () => undefined}
        onPortfolioRecorded={() => undefined}
      />,
    );

    expect(html).toContain("Thêm mã");
    expect(html).toContain('data-asset-icon="BTC"');
    expect(html).toContain('data-asset-icon="ETH"');
    expect(html).toContain('data-asset-icon="FPT"');
    expect(html).toContain('aria-label="Mua ETH"');
    expect(html).toContain('aria-label="Kiểm định ETH"');
    expect(html).toContain('aria-label="Xóa ETH"');
    expect(html).toContain('aria-label="Bán FPT"');
    expect(html).not.toContain('aria-label="Xóa FPT"');
    expect(html).not.toContain('aria-label="Xóa BTC"');
    expect(html).toContain("Chưa có quan điểm hôm nay");
  });

  it("shows one today-level notice when the entire briefing is missing", () => {
    const html = renderToStaticMarkup(
      <AssetOpinions
        opinions={[]}
        portfolioState="missing"
        locale="vi"
        onEvidence={() => undefined}
        generationState="idle"
        analysisDate="2026-08-17"
        today="2026-08-17"
        briefingAvailable={false}
        watchlist={watchlist}
        watchlistAvailable
      />,
    );

    expect(html.match(/Chưa có bản phân tích hôm nay/g)).toHaveLength(1);
    expect(html).not.toContain("Chưa có quan điểm hôm nay");
  });

  it("labels an omitted symbol against the selected historical date", () => {
    const html = renderToStaticMarkup(
      <AssetOpinions
        opinions={[opinion()]}
        portfolioState="available"
        locale="vi"
        onEvidence={() => undefined}
        analysisDate="2026-08-16"
        today="2026-08-17"
        briefingAvailable
        watchlist={watchlist}
        watchlistAvailable
        onRefresh={() => undefined}
      />,
    );

    expect(html).toContain("Chưa có quan điểm cho ngày đã chọn");
    expect(html).not.toContain("Cập nhật AI");
  });

  it("advertises row and card analysis while keeping details closed by default", () => {
    const html = renderToStaticMarkup(
      <AssetOpinions
        opinions={[opinion()]}
        portfolioState="available"
        locale="vi"
        onEvidence={() => undefined}
      />,
    );
    expect(html).toContain("Quan điểm AI theo tài sản");
    expect(html).toContain('data-testid="asset-opinion-table"');
    expect(html).toContain('data-testid="asset-opinion-cards"');
    expect(html).toContain("Xem phân tích");
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("AI đã phân tích");
    expect(html).not.toContain('data-testid="asset-opinion-detail"');
    expect(html).not.toContain("Nguồn &amp; độ mới");
  });

  it("organizes an open opinion around thesis, calculation, scenarios, and on-demand sources", () => {
    const html = renderToStaticMarkup(
      <AssetOpinionDetailContent
        opinion={opinion()}
        portfolioState="available"
        locale="vi"
        onEvidence={() => undefined}
      />,
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain("Luận điểm");
    expect(html).toContain("Cách tính");
    expect(html).toContain("Kịch bản &amp; điều kiện");
    expect(html).toContain("Nguồn dữ liệu (2)");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-testid="asset-opinion-sources"');
    expect(html).not.toContain("Nguồn &amp; độ mới");
    expect(html).not.toContain(">Fresh<");
    expect(html).not.toContain("Cách tính chi tiết");
    expect(html).not.toContain("Kịch bản cơ sở");
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
      <AssetOpinionDetailContent
        opinion={opinion({
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
        })}
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
      <AssetOpinionDetailContent
        opinion={opinion({ portfolioWeightPct: "0" })}
        portfolioState="missing"
        locale="vi"
        onEvidence={() => undefined}
      />,
    );

    expect(html).toContain("Chưa có danh mục để tính mức phơi nhiễm");
    expect(html).toContain("Tỷ trọng hiện tại");
  });

  it("labels altcoin factors and data-backed change conditions in Vietnamese", () => {
    const ethOpinion = opinion({
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
          evidenceId: "etf",
          metricCode: "crypto.etf.net_flow_usd",
          pillarCode: "etf_flow",
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
    });
    const html = renderToStaticMarkup(
      <>
        <AssetOpinionFormula opinion={ethOpinion} locale="vi" />
        <AssetOpinionScenarios opinion={ethOpinion} locale="vi" />
      </>,
    );

    expect(html).toContain("Xu hướng BTC");
    expect(html).toContain("Luân chuyển Altcoin");
    expect(html).toContain("Dòng tiền ETF");
    expect(html).toContain("Cung tiền M2 4 tuần");
    expect(html).toContain("Xu hướng BTC chuyển sang âm");
    expect(html).toContain("Altcoin Season giảm xuống dưới 75");
    expect(html).toContain("Dòng tiền ETF ETH chuyển sang âm");
  });

  it("renders default representative assets for guests without fetching", () => {
    const html = renderToStaticMarkup(
      <AssetOpinions
        opinions={[]}
        portfolioState="missing"
        locale="vi"
        onEvidence={() => undefined}
        generationState="idle"
        onRefresh={() => undefined}
        guestPreview
      />,
    );
    expect(html).toContain("Quan điểm AI theo tài sản");
    expect(html).toContain("BTC");
    expect(html).toContain("ETH");
    expect(html).toContain("VNINDEX");
    expect(html).toContain("VN30");
    expect(html).toContain("XAU");
    expect(html).toContain("Đăng nhập để xem quan điểm định lượng");
    expect(html).toContain("Nội dung minh họa không thay thế phân tích theo tài khoản của bạn.");
    expect(html).not.toContain("Chưa có quan điểm hôm nay");
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
