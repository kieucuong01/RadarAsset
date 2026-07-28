import type {
  AssetIntelligenceResponse,
  ForecastPointInput,
  InsightEvidenceInput,
  InvestmentThesisInput,
  InvestorInsightInput,
} from "./types";

const STANCE_BY_SCORE: Array<[number, InvestmentThesisInput["stance"]]> = [
  [72, "accumulate"],
  [58, "hold"],
  [45, "watch"],
  [35, "trim"],
  [0, "avoid"],
];

function round(value: number, digits = 2) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function uniqueCompact(values: Array<string | null | undefined>, limit: number) {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]),
  ).slice(0, limit);
}

function stanceFromScore(score: number): InvestmentThesisInput["stance"] {
  return STANCE_BY_SCORE.find(([floor]) => score >= floor)?.[1] ?? "watch";
}

export function buildAssetIntelligence(input: {
  symbol: string;
  name: string;
  latestPrice: number;
  insights: InvestorInsightInput[];
  evidence: InsightEvidenceInput[];
  thesis: InvestmentThesisInput | null;
  forecasts: ForecastPointInput[];
}): AssetIntelligenceResponse {
  const sentimentBreakdown = input.insights.reduce(
    (acc, insight) => {
      acc[insight.sentiment] += 1;
      return acc;
    },
    { bull: 0, bear: 0, neutral: 0 },
  );

  if (input.insights.length === 0 && !input.thesis && input.forecasts.length === 0) {
    return {
      symbol: input.symbol,
      name: input.name,
      latestPrice: input.latestPrice,
      score: 50,
      stance: "watch",
      summary: `No active research is available for ${input.symbol}. Keep it on watch until evidence is imported.`,
      sentimentBreakdown,
      topCatalysts: [],
      topRisks: [],
      evidenceCount: 0,
      thesis: null,
      forecasts: [],
      recentInsights: [],
      evidence: [],
    };
  }

  const weightedSentiment = input.insights.reduce((sum, insight) => {
    const direction = insight.sentiment === "bull" ? 1 : insight.sentiment === "bear" ? -1 : 0;
    return sum + direction * clamp(insight.confidence) * 0.2;
  }, 0);
  const avgConfidence =
    input.insights.reduce((sum, insight) => sum + clamp(insight.confidence), 0) /
    Math.max(input.insights.length, 1);
  const thesisScore = input.thesis ? (clamp(input.thesis.conviction) - 50) * 0.35 : 0;
  const evidenceScore = Math.min(input.evidence.length * 1.5, 5);
  const forecastScore =
    input.forecasts.length === 0
      ? 0
      : input.forecasts.reduce((sum, forecast) => {
          const expectedReturn =
            input.latestPrice === 0
              ? 0
              : ((forecast.targetPrice - input.latestPrice) / input.latestPrice) * 100;
          return sum + Math.max(Math.min(expectedReturn, 12), -12) * 0.25;
        }, 0) / input.forecasts.length;
  const score = round(
    clamp(
      50 +
        weightedSentiment / Math.max(input.insights.length, 1) +
        thesisScore +
        evidenceScore +
        forecastScore,
    ),
    0,
  );

  const forecasts = input.forecasts.map((forecast) => ({
    ...forecast,
    expectedReturnPct:
      input.latestPrice === 0
        ? 0
        : round(((forecast.targetPrice - input.latestPrice) / input.latestPrice) * 100),
  }));

  const derivedStance = input.thesis?.stance ?? stanceFromScore(score);
  const topCatalysts = uniqueCompact(
    input.insights.map((insight) => insight.catalyst),
    4,
  );
  const topRisks = uniqueCompact(
    input.insights.map((insight) => insight.risk),
    4,
  );
  const summary =
    input.thesis?.thesis ??
    `${input.symbol} research score is ${score}/100 with ${avgConfidence.toFixed(0)}% average source confidence.`;

  return {
    symbol: input.symbol,
    name: input.name,
    latestPrice: input.latestPrice,
    score,
    stance: derivedStance,
    summary,
    sentimentBreakdown,
    topCatalysts,
    topRisks,
    evidenceCount: input.evidence.length,
    thesis: input.thesis,
    forecasts,
    recentInsights: input.insights,
    evidence: input.evidence,
  };
}
