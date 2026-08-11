const MIN_OBSERVATIONS = 30;
const ITERATIONS = 500;
const GRADIENT_STEP = 1;

export type OptimizerInput = {
  returnsBySymbol: Record<string, number[]>;
  riskAversion: number;
  maxWeightBps: number;
  totalWeightBps?: number;
  periodsPerYear?: number;
};

export type OptimizerResult = {
  weightsBps: Record<string, number>;
  expectedReturnPct: number;
  volatilityPct: number;
  sharpe: number | null;
  observationCount: number;
  warnings: string[];
};

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

function projectCappedSimplex(values: number[], cap: number) {
  if (cap * values.length < 1 - 1e-12) {
    throw new Error("Maximum asset weight cannot satisfy the portfolio total.");
  }
  let lower = Math.min(...values.map((value) => value - cap));
  let upper = Math.max(...values);
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const lambda = (lower + upper) / 2;
    const total = values.reduce(
      (sum, value) => sum + Math.min(cap, Math.max(0, value - lambda)),
      0,
    );
    if (total > 1) lower = lambda;
    else upper = lambda;
  }
  const lambda = (lower + upper) / 2;
  const projected = values.map((value) => Math.min(cap, Math.max(0, value - lambda)));
  const total = projected.reduce((sum, value) => sum + value, 0);
  return projected.map((value) => value / total);
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

export function optimizeMeanVariance(input: OptimizerInput): OptimizerResult {
  const symbols = Object.keys(input.returnsBySymbol).sort();
  if (symbols.length < 1 || symbols.length > 10) throw new Error("Expected 1 to 10 assets.");
  if (!Number.isFinite(input.riskAversion) || input.riskAversion < 1 || input.riskAversion > 10) {
    throw new Error("Risk aversion must be between 1 and 10.");
  }
  const totalWeightBps = input.totalWeightBps ?? 10_000;
  if (!Number.isInteger(totalWeightBps) || totalWeightBps < 1 || totalWeightBps > 10_000) {
    throw new Error("Total optimized weight must be between 1 and 10,000 basis points.");
  }
  if (
    !Number.isInteger(input.maxWeightBps) ||
    input.maxWeightBps < 1 ||
    input.maxWeightBps > 10_000 ||
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
  const matrix = series.map((left, leftIndex) =>
    series.map((right, rightIndex) => covariance(left, right, means[leftIndex], means[rightIndex])),
  );
  const cap = input.maxWeightBps / totalWeightBps;
  let weights = projectCappedSimplex(Array(symbols.length).fill(1 / symbols.length), cap);
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const gradient = means.map(
      (expectedReturn, index) => expectedReturn - input.riskAversion * dot(matrix[index], weights),
    );
    weights = projectCappedSimplex(
      weights.map((weight, index) => weight + GRADIENT_STEP * gradient[index]),
      cap,
    );
  }

  const periodsPerYear = input.periodsPerYear ?? 252;
  if (!Number.isFinite(periodsPerYear) || periodsPerYear <= 0) {
    throw new Error("Periods per year must be positive.");
  }
  const periodReturn = dot(means, weights);
  const variance = Math.max(
    0,
    weights.reduce((total, weight, index) => total + weight * dot(matrix[index], weights), 0),
  );
  const annualVolatility = Math.sqrt(variance * periodsPerYear);
  const annualReturn = periodReturn * periodsPerYear;
  const singular = variance <= 1e-18;

  return {
    weightsBps: basisPoints(symbols, weights, totalWeightBps, input.maxWeightBps),
    expectedReturnPct: annualReturn * 100,
    volatilityPct: singular ? 0 : annualVolatility * 100,
    sharpe: singular ? null : annualReturn / annualVolatility,
    observationCount: observations,
    warnings: singular ? ["SINGULAR_COVARIANCE"] : [],
  };
}
