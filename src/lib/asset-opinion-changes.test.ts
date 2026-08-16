import { describe, expect, it } from "vitest";

import { derivePortfolioOpinionChanges, type OpinionChangeInput } from "./asset-opinion-changes";

function opinion(symbol: string, overrides: Partial<OpinionChangeInput> = {}): OpinionChangeInput {
  return {
    symbol,
    assetName: symbol,
    stance: "NEUTRAL",
    personalizedAction: "HOLD",
    quantScore: "0",
    portfolioWeightPct: "0",
    decisionInputs: [],
    ...overrides,
  };
}

describe("derivePortfolioOpinionChanges", () => {
  it("returns an accumulating state when no previous briefing exists", () => {
    expect(derivePortfolioOpinionChanges([opinion("BTC")], null)).toEqual([]);
  });

  it("ranks held assets first and stance/action changes before score-only changes", () => {
    const previous = [opinion("BTC"), opinion("ETH"), opinion("XAU")];
    const current = [
      opinion("XAU", { quantScore: "15" }),
      opinion("ETH", { stance: "CONSTRUCTIVE", personalizedAction: "REVIEW_INCREASE" }),
      opinion("BTC", { portfolioWeightPct: "20", quantScore: "5" }),
    ];

    expect(derivePortfolioOpinionChanges(current, previous).map((row) => row.symbol)).toEqual([
      "BTC",
      "ETH",
      "XAU",
    ]);
    expect(derivePortfolioOpinionChanges(current, previous)[1]?.changeType).toBe("stance_action");
  });

  it("is bounded and attaches the strongest current numeric decision input", () => {
    const previous = ["BTC", "ETH", "SOL", "XAU"].map((symbol) => opinion(symbol));
    const current = previous.map((row, index) =>
      opinion(row.symbol, {
        quantScore: String(index + 1),
        decisionInputs: [
          { metricCode: "weak", rawValue: "1", unit: "INDEX", contribution: "2" },
          { metricCode: "strong", rawValue: "120", unit: "USD_MILLION", contribution: "-12" },
        ],
      }),
    );

    const changes = derivePortfolioOpinionChanges(current, previous);

    expect(changes).toHaveLength(3);
    expect(changes[0]?.reason).toEqual({
      metricCode: "strong",
      rawValue: "120",
      unit: "USD_MILLION",
      contribution: "-12",
    });
  });

  it("strips internal decision input fields from the public change reason", () => {
    const previous = [opinion("BTC")];
    const current = [
      opinion("BTC", {
        quantScore: "5",
        decisionInputs: [
          {
            metricCode: "crypto.fear_greed.index",
            rawValue: "34",
            unit: "INDEX",
            contribution: "6.17",
            evidenceId: "evidence-a",
            pillarCode: "sentiment_onchain",
            normalizedScore: "52.33",
          } as OpinionChangeInput["decisionInputs"][number],
        ],
      }),
    ];

    expect(derivePortfolioOpinionChanges(current, previous)[0]?.reason).toEqual({
      metricCode: "crypto.fear_greed.index",
      rawValue: "34",
      unit: "INDEX",
      contribution: "6.17",
    });
  });

  it("omits unchanged and invalid-score assets", () => {
    const previous = [opinion("BTC"), opinion("ETH", { quantScore: null })];
    const current = [opinion("BTC"), opinion("ETH", { quantScore: "not-a-number" })];

    expect(derivePortfolioOpinionChanges(current, previous)).toEqual([]);
  });
});
