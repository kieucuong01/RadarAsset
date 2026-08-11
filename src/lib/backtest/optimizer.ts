import PortfolioAllocation from "portfolio-allocation";

import {
  OPTIMIZER_METHOD_LABELS,
  OPTIMIZER_SOURCES,
  type OptimizerMethod,
} from "./optimizer-methods";

const MIN_OBSERVATIONS = 30;
const BASIS_POINTS = 10_000;
const EPSILON = 1e-10;

export { OPTIMIZER_METHODS, OPTIMIZER_SOURCES } from "./optimizer-methods";

export type OptimizerInput = {
  returnsBySymbol: Record<string, number[]>;
  method: OptimizerMethod;
  maxWeightBps: number;
  totalWeightBps?: number;
  periodsPerYear?: number;
  targetReturnPct?: number;
  targetVolatilityPct?: number;
  riskTolerance?: number;
};

export type OptimizerResult = {
  method: OptimizerMethod;
  source: (typeof OPTIMIZER_SOURCES)["portfolioAllocation"];
  weightsBps: Record<string, number>;
  expectedReturnPct: number;
  volatilityPct: number;
  sharpe: number | null;
  observationCount: number;
  assetMetrics: Array<{
    symbol: string;
    expectedReturnPct: number;
    volatilityPct: number;
  }>;
  correlationMatrix: Array<{
    symbol: string;
    correlations: Record<string, number>;
  }>;
  warnings: string[];
};

type PortfolioAllocationOptions = {
  constraints?: {
    minWeights?: number[];
    maxWeights?: number[];
    return?: number;
    volatility?: number;
    riskTolerance?: number;
  };
  optimizationMethod?: "automatic" | "critical-line" | "gsmo";
  optimizationMethodParams?: {
    epsGsmo?: number;
    maxIterGsmo?: number;
  };
};

type PortfolioAllocationApi = {
  equalWeights(nbAssets: number): number[];
  inverseVolatilityWeights(variances: number[]): number[];
  globalMinimumVarianceWeights(
    covarianceMatrix: number[][],
    options?: PortfolioAllocationOptions,
  ): number[];
  maximumSharpeRatioWeights(
    expectedReturns: number[],
    covarianceMatrix: number[][],
    riskFreeRate: number,
    options?: PortfolioAllocationOptions,
  ): number[];
  meanVarianceOptimizationWeights(
    expectedReturns: number[],
    covarianceMatrix: number[][],
    options: PortfolioAllocationOptions,
  ): number[];
  equalRiskContributionWeights(
    covarianceMatrix: number[][],
    options?: PortfolioAllocationOptions,
  ): number[];
  mostDiversifiedWeights(
    covarianceMatrix: number[][],
    options?: PortfolioAllocationOptions,
  ): number[];
  minimumCorrelationWeights(covarianceMatrix: number[][]): number[];
};

const allocationLibrary = PortfolioAllocation as PortfolioAllocationApi;

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function covariance(left: number[], right: number[], leftMean: number, rightMean: number) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += (left[index] - leftMean) * (right[index] - rightMean);
  }
  return total / Math.max(1, left.length - 1);
}

function dot(left: number[], right: number[]) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function rounded(value: number, decimals: number) {
  return Number(value.toFixed(decimals));
}

function clampedCorrelation(value: number) {
  return Math.min(1, Math.max(-1, value));
}

function assetMetrics(
  symbols: string[],
  means: number[],
  covarianceMatrix: number[][],
  periodsPerYear: number,
) {
  return symbols.map((symbol, index) => ({
    symbol,
    expectedReturnPct: rounded(means[index] * periodsPerYear * 100, 2),
    volatilityPct: rounded(
      Math.sqrt(Math.max(0, covarianceMatrix[index][index]) * periodsPerYear) * 100,
      2,
    ),
  }));
}

function correlationMatrix(symbols: string[], covarianceMatrix: number[][]) {
  const variances = covarianceMatrix.map((row, index) => Math.max(0, row[index]));
  return symbols.map((symbol, leftIndex) => ({
    symbol,
    correlations: Object.fromEntries(
      symbols.map((rightSymbol, rightIndex) => {
        const denominator = Math.sqrt(variances[leftIndex] * variances[rightIndex]);
        const value =
          denominator <= EPSILON
            ? leftIndex === rightIndex
              ? 1
              : 0
            : covarianceMatrix[leftIndex][rightIndex] / denominator;
        return [rightSymbol, rounded(clampedCorrelation(value), 4)];
      }),
    ),
  }));
}

function normalizedWeights(weights: number[]) {
  if (weights.some((weight) => !Number.isFinite(weight) || weight < -EPSILON)) {
    throw new Error("PortfolioAllocation returned invalid weights.");
  }
  const cleaned = weights.map((weight) => Math.max(0, weight));
  const total = cleaned.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("PortfolioAllocation returned zero weights.");
  }
  return cleaned.map((weight) => weight / total);
}

function assertCapSupport(method: OptimizerMethod, weights: number[], cap: number) {
  const breached = weights.some((weight) => weight > cap + EPSILON);
  if (!breached) return;
  throw new Error(`${OPTIMIZER_METHOD_LABELS[method]} does not support max-weight repair.`);
}

function basisPoints(
  symbols: string[],
  weights: number[],
  totalWeightBps: number,
  maxWeightBps: number,
) {
  const raw = weights.map((weight) => weight * totalWeightBps);
  const rounded = raw.map(Math.floor);
  let remainder = totalWeightBps - rounded.reduce((sum, value) => sum + value, 0);
  const order = symbols
    .map((symbol, index) => ({ symbol, index, fraction: raw[index] - rounded[index] }))
    .sort(
      (left, right) => right.fraction - left.fraction || left.symbol.localeCompare(right.symbol),
    );
  while (remainder > 0) {
    const candidate = order.find((item) => rounded[item.index] < maxWeightBps);
    if (!candidate) throw new Error("Unable to repair optimized basis-point allocation.");
    rounded[candidate.index] += 1;
    remainder -= 1;
    candidate.fraction = -1;
    order.sort(
      (left, right) => right.fraction - left.fraction || left.symbol.localeCompare(right.symbol),
    );
  }
  return Object.fromEntries(symbols.map((symbol, index) => [symbol, rounded[index]]));
}

function optimizerWeights(
  input: OptimizerInput,
  means: number[],
  covarianceMatrix: number[][],
  totalWeightBps: number,
  periodsPerYear: number,
) {
  const method = input.method;
  if (means.length === 1) return [1];

  const cap = input.maxWeightBps / totalWeightBps;
  const constraints = { maxWeights: Array(means.length).fill(cap) };
  const constrainedOptions: PortfolioAllocationOptions = {
    constraints,
    optimizationMethod: "automatic",
    optimizationMethodParams: { epsGsmo: 1e-10, maxIterGsmo: 10_000 },
  };

  if (method === "equal_weight") {
    const weights = normalizedWeights(allocationLibrary.equalWeights(means.length));
    assertCapSupport(method, weights, cap);
    return weights;
  }

  if (method === "inverse_volatility") {
    const variances = covarianceMatrix.map((row, index) => row[index]);
    const weights = normalizedWeights(allocationLibrary.inverseVolatilityWeights(variances));
    assertCapSupport(method, weights, cap);
    return weights;
  }

  if (method === "minimum_variance") {
    return normalizedWeights(
      allocationLibrary.globalMinimumVarianceWeights(covarianceMatrix, constrainedOptions),
    );
  }

  if (method === "maximum_sharpe") {
    try {
      return normalizedWeights(
        allocationLibrary.maximumSharpeRatioWeights(means, covarianceMatrix, 0, constrainedOptions),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (
        means.some((expectedReturn) => expectedReturn > 0) &&
        !message.includes("minimum return constraint")
      ) {
        throw error;
      }
      return {
        weights: normalizedWeights(
          allocationLibrary.globalMinimumVarianceWeights(covarianceMatrix, constrainedOptions),
        ),
        warnings: ["MAX_SHARPE_FALLBACK_MIN_VARIANCE"],
      };
    }
  }

  if (method === "target_return") {
    if (!Number.isFinite(input.targetReturnPct)) {
      throw new Error("Target return is required.");
    }
    return normalizedWeights(
      allocationLibrary.meanVarianceOptimizationWeights(means, covarianceMatrix, {
        ...constrainedOptions,
        constraints: {
          ...constraints,
          return: input.targetReturnPct! / 100 / periodsPerYear,
        },
      }),
    );
  }

  if (method === "target_volatility") {
    if (!Number.isFinite(input.targetVolatilityPct) || input.targetVolatilityPct! <= 0) {
      throw new Error("Target volatility is required.");
    }
    return normalizedWeights(
      allocationLibrary.meanVarianceOptimizationWeights(means, covarianceMatrix, {
        ...constrainedOptions,
        constraints: {
          ...constraints,
          volatility: input.targetVolatilityPct! / 100 / Math.sqrt(periodsPerYear),
        },
      }),
    );
  }

  if (method === "risk_tolerance") {
    if (!Number.isFinite(input.riskTolerance) || input.riskTolerance! <= 0) {
      throw new Error("Risk tolerance is required.");
    }
    return normalizedWeights(
      allocationLibrary.meanVarianceOptimizationWeights(means, covarianceMatrix, {
        ...constrainedOptions,
        constraints: {
          ...constraints,
          riskTolerance: input.riskTolerance!,
        },
      }),
    );
  }

  if (method === "risk_parity") {
    return normalizedWeights(
      allocationLibrary.equalRiskContributionWeights(covarianceMatrix, constrainedOptions),
    );
  }

  if (method === "most_diversified") {
    return normalizedWeights(
      allocationLibrary.mostDiversifiedWeights(covarianceMatrix, constrainedOptions),
    );
  }

  const weights = normalizedWeights(allocationLibrary.minimumCorrelationWeights(covarianceMatrix));
  assertCapSupport(method, weights, cap);
  return weights;
}

export function optimizePortfolioAllocation(input: OptimizerInput): OptimizerResult {
  const symbols = Object.keys(input.returnsBySymbol).sort();
  if (symbols.length < 1 || symbols.length > 10) throw new Error("Expected 1 to 10 assets.");
  const totalWeightBps = input.totalWeightBps ?? BASIS_POINTS;
  if (!Number.isInteger(totalWeightBps) || totalWeightBps < 1 || totalWeightBps > BASIS_POINTS) {
    throw new Error("Total optimized weight must be between 1 and 10,000 basis points.");
  }
  if (
    !Number.isInteger(input.maxWeightBps) ||
    input.maxWeightBps < 1 ||
    input.maxWeightBps > BASIS_POINTS ||
    input.maxWeightBps * symbols.length < totalWeightBps
  ) {
    throw new Error("Maximum asset weight cannot satisfy the portfolio total.");
  }
  const observations = input.returnsBySymbol[symbols[0]]?.length ?? 0;
  if (observations < MIN_OBSERVATIONS) {
    throw new Error("Optimizer requires at least 30 overlapping return observations.");
  }
  const series = symbols.map((symbol) => input.returnsBySymbol[symbol]);
  if (
    series.some(
      (values) => values.length !== observations || values.some((value) => !Number.isFinite(value)),
    )
  ) {
    throw new Error("Return series must be finite and aligned.");
  }

  const means = series.map(mean);
  const covarianceMatrix = series.map((left, leftIndex) =>
    series.map((right, rightIndex) => covariance(left, right, means[leftIndex], means[rightIndex])),
  );
  const periodsPerYear = input.periodsPerYear ?? 252;
  if (!Number.isFinite(periodsPerYear) || periodsPerYear <= 0) {
    throw new Error("Periods per year must be positive.");
  }
  const weightsResult = optimizerWeights(
    input,
    means,
    covarianceMatrix,
    totalWeightBps,
    periodsPerYear,
  );
  const weights = Array.isArray(weightsResult) ? weightsResult : weightsResult.weights;
  const optimizerWarnings = Array.isArray(weightsResult) ? [] : weightsResult.warnings;

  const periodReturn = dot(means, weights);
  const variance = Math.max(
    0,
    weights.reduce(
      (total, weight, index) => total + weight * dot(covarianceMatrix[index], weights),
      0,
    ),
  );
  const annualVolatility = Math.sqrt(variance * periodsPerYear);
  const annualReturn = periodReturn * periodsPerYear;
  const singular = variance <= 1e-18;

  return {
    method: input.method,
    source: OPTIMIZER_SOURCES.portfolioAllocation,
    weightsBps: basisPoints(symbols, weights, totalWeightBps, input.maxWeightBps),
    expectedReturnPct: annualReturn * 100,
    volatilityPct: singular ? 0 : annualVolatility * 100,
    sharpe: singular ? null : annualReturn / annualVolatility,
    observationCount: observations,
    assetMetrics: assetMetrics(symbols, means, covarianceMatrix, periodsPerYear),
    correlationMatrix: correlationMatrix(symbols, covarianceMatrix),
    warnings: [...optimizerWarnings, ...(singular ? ["SINGULAR_COVARIANCE"] : [])],
  };
}
