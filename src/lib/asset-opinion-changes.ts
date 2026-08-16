export type OpinionChangeInput = {
  symbol: string;
  assetName: string;
  stance: string;
  personalizedAction: string;
  quantScore: string | null;
  portfolioWeightPct: string;
  decisionInputs: Array<{
    metricCode: string;
    rawValue: string;
    unit: string;
    contribution: string;
  }>;
};

export type PortfolioOpinionChange = {
  symbol: string;
  assetName: string;
  changeType: "stance_action" | "score";
  previousStance: string;
  currentStance: string;
  previousAction: string;
  currentAction: string;
  scoreDelta: string | null;
  portfolioWeightPct: string;
  reason: {
    metricCode: string;
    rawValue: string;
    unit: string;
    contribution: string;
  } | null;
};

function finite(value: string | null): number | null {
  if (value == null || !/^-?(?:\d+|\d*\.\d+)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function strongestReason(opinion: OpinionChangeInput): PortfolioOpinionChange["reason"] {
  const row =
    opinion.decisionInputs
      .map((input) => ({ input, contribution: finite(input.contribution) }))
      .filter(
        (item): item is { input: (typeof opinion.decisionInputs)[number]; contribution: number } =>
          Number.isFinite(item.contribution),
      )
      .sort(
        (left, right) =>
          Math.abs(right.contribution) - Math.abs(left.contribution) ||
          left.input.metricCode.localeCompare(right.input.metricCode),
      )[0]?.input ?? null;
  if (!row) return null;
  return {
    metricCode: row.metricCode,
    rawValue: row.rawValue,
    unit: row.unit,
    contribution: row.contribution,
  };
}

export function derivePortfolioOpinionChanges(
  current: OpinionChangeInput[],
  previous: OpinionChangeInput[] | null,
  limit = 3,
): PortfolioOpinionChange[] {
  if (!previous || limit <= 0) return [];
  const previousBySymbol = new Map(previous.map((row) => [row.symbol, row]));
  const currentBySymbol = new Map(current.map((row) => [row.symbol, row]));
  return [...currentBySymbol.values()]
    .flatMap((row): PortfolioOpinionChange[] => {
      const before = previousBySymbol.get(row.symbol);
      if (!before) return [];
      const stanceActionChanged =
        row.stance !== before.stance || row.personalizedAction !== before.personalizedAction;
      const currentScore = finite(row.quantScore);
      const previousScore = finite(before.quantScore);
      const scoreDelta =
        currentScore == null || previousScore == null ? null : currentScore - previousScore;
      if (!stanceActionChanged && (scoreDelta == null || Math.abs(scoreDelta) < 0.0001)) return [];
      return [
        {
          symbol: row.symbol,
          assetName: row.assetName,
          changeType: stanceActionChanged ? "stance_action" : "score",
          previousStance: before.stance,
          currentStance: row.stance,
          previousAction: before.personalizedAction,
          currentAction: row.personalizedAction,
          scoreDelta: scoreDelta == null ? null : String(scoreDelta),
          portfolioWeightPct: row.portfolioWeightPct,
          reason: strongestReason(row),
        },
      ];
    })
    .sort((left, right) => {
      const held =
        Number(finite(right.portfolioWeightPct)! > 0) -
        Number(finite(left.portfolioWeightPct)! > 0);
      if (held) return held;
      const kind =
        Number(right.changeType === "stance_action") - Number(left.changeType === "stance_action");
      if (kind) return kind;
      const magnitude =
        Math.abs(finite(right.scoreDelta) ?? 0) - Math.abs(finite(left.scoreDelta) ?? 0);
      return magnitude || left.symbol.localeCompare(right.symbol);
    })
    .slice(0, Math.min(limit, 3));
}
