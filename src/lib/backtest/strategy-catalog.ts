import { z } from "zod";

const SOURCE_ATTRIBUTION =
  "Adapted from Stock-Prediction-Models agent notebooks (Apache License 2.0).";
const MODIFICATION_NOTICE =
  "Logic was rewritten for causal, long-only, next-bar execution in DataVest.";

// Generated from canonicalDescriptor() with SHA-256. Keeping the catalog module
// browser-safe allows the Backtest UI to render the same immutable catalog.
const IMPLEMENTATION_HASHES: Record<string, string> = {
  "ma_crossover@1.0.0": "0e66f071f42c9ef90aecdf91ddbc5eed69872bcf2dd6d1dc4177240827a9a541",
  "turtle_breakout@1.0.0": "83fdbb7f003132239ab26a0aefa638ddb0ab7ea973fde49d21cd2391d2494d2f",
  "signal_rolling_reversal@1.0.0":
    "059784ca9863c91bd298f0b100c04cc7aa22abb2511a3ca6313a276d3143aca9",
  "abcd_causal@1.0.0": "ea97244d5e5dad14ed2686d3b913fd7b7605d9c6e5bfbfb683835b55e578ca7b",
  "ema_trend@1.0.0": "8840d8ad711a583f6f0c1da991b60f5085b9bd7f463bb9a2b653a1c9f4fea44d",
  "rsi_mean_reversion@1.0.0": "edf42f3f9a5a8e7920d7702d198de264b13b5d928c4e3c1cd3000046720426af",
  "bollinger_mean_reversion@1.0.0":
    "eea61cec25fcb4565e4fb09b47b0c3f699bbfa1445dbf9099f58d95a457a2b97",
  "macd_momentum@1.0.0": "75512f6248bf9164a85526a75dabc71aa6e09f320ab37b86c7619d0015a0be49",
  "atr_breakout@1.0.0": "0b915452fd6946b76e6c12f8450b46d9d40668a812c5377e53362804f747c291",
};

type StrategyMarket = "vn_equity" | "crypto_spot" | "metal_spot";
type StrategyTimeframe = "1d";
type StrategyParameterDescriptor = {
  name: string;
  label: string;
  type: "integer" | "number";
  min: number;
  max: number;
  default: number;
};

type StrategyDefinitionInput = {
  code: string;
  version: string;
  name: string;
  category: "rule_based";
  supportedMarkets: readonly StrategyMarket[];
  supportedTimeframes: readonly StrategyTimeframe[];
  requiredWarmup: string;
  parameterSchema: readonly StrategyParameterDescriptor[];
  defaultParameters: Readonly<Record<string, number>>;
  validator: z.ZodTypeAny;
  sourceAttribution?: string;
  modificationNotice?: string;
};

export type StrategyDefinition = StrategyDefinitionInput & {
  sourceAttribution: string;
  modificationNotice: string;
  implementationHash: string;
};
export type StrategyCode = StrategyDefinition["code"];
export type StrategyParameterSchema = StrategyDefinition["parameterSchema"];

export const STRATEGY_CATALOG: readonly StrategyDefinition[] = [
  makeDefinition({
    code: "ma_crossover",
    version: "1.0.0",
    name: "MA Crossover",
    category: "rule_based",
    supportedMarkets: ["vn_equity", "crypto_spot", "metal_spot"],
    supportedTimeframes: ["1d"],
    requiredWarmup: "slowPeriod",
    parameterSchema: [
      { name: "fastPeriod", label: "Fast SMA", type: "integer", min: 2, max: 200, default: 5 },
      { name: "slowPeriod", label: "Slow SMA", type: "integer", min: 3, max: 400, default: 20 },
    ],
    defaultParameters: { fastPeriod: 5, slowPeriod: 20 },
    validator: z
      .object({
        fastPeriod: z.number().int().min(2).max(200),
        slowPeriod: z.number().int().min(3).max(400),
      })
      .strict()
      .superRefine((value, context) => {
        if (value.fastPeriod >= value.slowPeriod) {
          context.addIssue({
            code: "custom",
            path: ["fastPeriod"],
            message: "Fast period must be lower than slow period.",
          });
        }
      }),
  }),
  makeDefinition({
    code: "turtle_breakout",
    version: "1.0.0",
    name: "Turtle Breakout",
    category: "rule_based",
    supportedMarkets: ["vn_equity", "crypto_spot", "metal_spot"],
    supportedTimeframes: ["1d"],
    requiredWarmup: "max(entryPeriod, exitPeriod) + 1",
    parameterSchema: [
      {
        name: "entryPeriod",
        label: "Entry lookback",
        type: "integer",
        min: 2,
        max: 250,
        default: 20,
      },
      {
        name: "exitPeriod",
        label: "Exit lookback",
        type: "integer",
        min: 2,
        max: 250,
        default: 10,
      },
    ],
    defaultParameters: { entryPeriod: 20, exitPeriod: 10 },
    validator: z
      .object({
        entryPeriod: z.number().int().min(2).max(250),
        exitPeriod: z.number().int().min(2).max(250),
      })
      .strict(),
  }),
  makeDefinition({
    code: "signal_rolling_reversal",
    version: "1.0.0",
    name: "Signal Rolling Reversal",
    category: "rule_based",
    supportedMarkets: ["vn_equity", "crypto_spot", "metal_spot"],
    supportedTimeframes: ["1d"],
    requiredWarmup: "confirmationBars + 1",
    parameterSchema: [
      {
        name: "confirmationBars",
        label: "Confirmation bars",
        type: "integer",
        min: 2,
        max: 20,
        default: 4,
      },
    ],
    defaultParameters: { confirmationBars: 4 },
    validator: z.object({ confirmationBars: z.number().int().min(2).max(20) }).strict(),
  }),
  makeDefinition({
    code: "abcd_causal",
    version: "1.0.0",
    name: "ABCD Causal Pattern",
    category: "rule_based",
    supportedMarkets: ["vn_equity", "crypto_spot", "metal_spot"],
    supportedTimeframes: ["1d"],
    requiredWarmup: "pivotLeftBars + pivotRightBars + 4",
    parameterSchema: [
      {
        name: "pivotLeftBars",
        label: "Pivot left bars",
        type: "integer",
        min: 1,
        max: 10,
        default: 3,
      },
      {
        name: "pivotRightBars",
        label: "Pivot confirmation bars",
        type: "integer",
        min: 1,
        max: 10,
        default: 3,
      },
      {
        name: "retracementMin",
        label: "Retracement minimum",
        type: "number",
        min: 0.1,
        max: 1.5,
        default: 0.382,
      },
      {
        name: "retracementMax",
        label: "Retracement maximum",
        type: "number",
        min: 0.2,
        max: 2,
        default: 0.886,
      },
      {
        name: "extensionMin",
        label: "Extension minimum",
        type: "number",
        min: 0.5,
        max: 3,
        default: 1.13,
      },
      {
        name: "extensionMax",
        label: "Extension maximum",
        type: "number",
        min: 0.75,
        max: 4,
        default: 1.618,
      },
    ],
    defaultParameters: {
      pivotLeftBars: 3,
      pivotRightBars: 3,
      retracementMin: 0.382,
      retracementMax: 0.886,
      extensionMin: 1.13,
      extensionMax: 1.618,
    },
    validator: z
      .object({
        pivotLeftBars: z.number().int().min(1).max(10),
        pivotRightBars: z.number().int().min(1).max(10),
        retracementMin: z.number().min(0.1).max(1.5),
        retracementMax: z.number().min(0.2).max(2),
        extensionMin: z.number().min(0.5).max(3),
        extensionMax: z.number().min(0.75).max(4),
      })
      .strict()
      .superRefine((value, context) => {
        if (value.retracementMin >= value.retracementMax) {
          context.addIssue({
            code: "custom",
            path: ["retracementMin"],
            message: "Retracement minimum must be lower than maximum.",
          });
        }
        if (value.extensionMin >= value.extensionMax) {
          context.addIssue({
            code: "custom",
            path: ["extensionMin"],
            message: "Extension minimum must be lower than maximum.",
          });
        }
      }),
  }),
  makeDefinition({
    code: "ema_trend",
    version: "1.0.0",
    name: "EMA Trend",
    category: "rule_based",
    supportedMarkets: ["vn_equity", "crypto_spot", "metal_spot"],
    supportedTimeframes: ["1d"],
    requiredWarmup: "slowPeriod + 1",
    parameterSchema: [
      { name: "fastPeriod", label: "Fast EMA", type: "integer", min: 2, max: 100, default: 12 },
      { name: "slowPeriod", label: "Slow EMA", type: "integer", min: 3, max: 250, default: 26 },
    ],
    defaultParameters: { fastPeriod: 12, slowPeriod: 26 },
    validator: z
      .object({
        fastPeriod: z.number().int().min(2).max(100),
        slowPeriod: z.number().int().min(3).max(250),
      })
      .strict()
      .refine((value) => value.fastPeriod < value.slowPeriod, {
        message: "Fast period must be lower than slow period.",
      }),
    sourceAttribution: "Technical indicators powered by talipp (MIT).",
    modificationNotice: "Causal close signal with next-bar execution.",
  }),
  makeDefinition({
    code: "rsi_mean_reversion",
    version: "1.0.0",
    name: "RSI Mean Reversion",
    category: "rule_based",
    supportedMarkets: ["vn_equity", "crypto_spot", "metal_spot"],
    supportedTimeframes: ["1d"],
    requiredWarmup: "period + 1",
    parameterSchema: [
      { name: "period", label: "RSI period", type: "integer", min: 2, max: 100, default: 14 },
      { name: "oversold", label: "Oversold", type: "number", min: 1, max: 50, default: 30 },
      { name: "overbought", label: "Recovery", type: "number", min: 50, max: 99, default: 55 },
    ],
    defaultParameters: { period: 14, oversold: 30, overbought: 55 },
    validator: z
      .object({
        period: z.number().int().min(2).max(100),
        oversold: z.number().min(1).max(50),
        overbought: z.number().min(50).max(99),
      })
      .strict()
      .refine((value) => value.oversold < value.overbought, {
        message: "Oversold must be lower than overbought.",
      }),
    sourceAttribution: "Technical indicators powered by talipp (MIT).",
    modificationNotice: "Long-only mean-reversion signal with next-bar execution.",
  }),
  makeDefinition({
    code: "bollinger_mean_reversion",
    version: "1.0.0",
    name: "Bollinger Mean Reversion",
    category: "rule_based",
    supportedMarkets: ["vn_equity", "crypto_spot", "metal_spot"],
    supportedTimeframes: ["1d"],
    requiredWarmup: "period",
    parameterSchema: [
      { name: "period", label: "Band period", type: "integer", min: 2, max: 200, default: 20 },
      {
        name: "standardDeviations",
        label: "Standard deviations",
        type: "number",
        min: 0.5,
        max: 5,
        default: 2,
      },
    ],
    defaultParameters: { period: 20, standardDeviations: 2 },
    validator: z
      .object({
        period: z.number().int().min(2).max(200),
        standardDeviations: z.number().min(0.5).max(5),
      })
      .strict(),
    sourceAttribution: "Technical indicators powered by talipp (MIT).",
    modificationNotice: "Long-only lower-band entry and center-band exit.",
  }),
  makeDefinition({
    code: "macd_momentum",
    version: "1.0.0",
    name: "MACD Momentum",
    category: "rule_based",
    supportedMarkets: ["vn_equity", "crypto_spot", "metal_spot"],
    supportedTimeframes: ["1d"],
    requiredWarmup: "slowPeriod + signalPeriod",
    parameterSchema: [
      { name: "fastPeriod", label: "Fast EMA", type: "integer", min: 2, max: 100, default: 12 },
      { name: "slowPeriod", label: "Slow EMA", type: "integer", min: 3, max: 250, default: 26 },
      { name: "signalPeriod", label: "Signal EMA", type: "integer", min: 2, max: 100, default: 9 },
    ],
    defaultParameters: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
    validator: z
      .object({
        fastPeriod: z.number().int().min(2).max(100),
        slowPeriod: z.number().int().min(3).max(250),
        signalPeriod: z.number().int().min(2).max(100),
      })
      .strict()
      .refine((value) => value.fastPeriod < value.slowPeriod, {
        message: "Fast period must be lower than slow period.",
      }),
    sourceAttribution: "Technical indicators powered by talipp (MIT).",
    modificationNotice: "Causal histogram crossover with next-bar execution.",
  }),
  makeDefinition({
    code: "atr_breakout",
    version: "1.0.0",
    name: "ATR Breakout",
    category: "rule_based",
    supportedMarkets: ["vn_equity", "crypto_spot", "metal_spot"],
    supportedTimeframes: ["1d"],
    requiredWarmup: "max(atrPeriod, breakoutPeriod, exitPeriod)",
    parameterSchema: [
      { name: "atrPeriod", label: "ATR period", type: "integer", min: 2, max: 100, default: 14 },
      {
        name: "breakoutPeriod",
        label: "Breakout lookback",
        type: "integer",
        min: 2,
        max: 250,
        default: 20,
      },
      {
        name: "exitPeriod",
        label: "Exit lookback",
        type: "integer",
        min: 2,
        max: 250,
        default: 10,
      },
      { name: "atrMultiplier", label: "ATR buffer", type: "number", min: 0, max: 5, default: 0.5 },
    ],
    defaultParameters: { atrPeriod: 14, breakoutPeriod: 20, exitPeriod: 10, atrMultiplier: 0.5 },
    validator: z
      .object({
        atrPeriod: z.number().int().min(2).max(100),
        breakoutPeriod: z.number().int().min(2).max(250),
        exitPeriod: z.number().int().min(2).max(250),
        atrMultiplier: z.number().min(0).max(5),
      })
      .strict(),
    sourceAttribution: "Technical indicators powered by talipp (MIT).",
    modificationNotice: "ATR-buffered breakout with prior-bar levels and next-bar execution.",
  }),
] as const;

function makeDefinition(input: StrategyDefinitionInput): StrategyDefinition {
  const implementationHash = IMPLEMENTATION_HASHES[`${input.code}@${input.version}`];
  if (!implementationHash) {
    throw new Error(`Missing implementation hash for ${input.code}@${input.version}.`);
  }
  return {
    ...input,
    sourceAttribution: input.sourceAttribution ?? SOURCE_ATTRIBUTION,
    modificationNotice: input.modificationNotice ?? MODIFICATION_NOTICE,
    implementationHash,
  };
}

export function strategyDefinition(code: string, version: string) {
  const definition = STRATEGY_CATALOG.find(
    (item) => item.code === code && item.version === version,
  );
  if (!definition) throw new Error(`Strategy ${code}@${version} not found.`);
  return definition;
}

export function listStrategyCatalog() {
  return STRATEGY_CATALOG.map(
    ({ validator: _validator, requiredWarmup: _requiredWarmup, ...definition }) => ({
      ...definition,
      status: "active" as const,
      origin: "built_in" as const,
    }),
  );
}

export function normalizeStrategyParameters(code: string, input: unknown) {
  const definition = STRATEGY_CATALOG.find((item) => item.code === code);
  if (!definition) throw new Error(`Strategy ${code} not found.`);
  const parsed = definition.validator.parse(input) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(parsed).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export type StrategyVersionRecord = Record<string, unknown>;

export interface StrategyCatalogRepository {
  findByCodeVersion(input: {
    code: string;
    version: string;
  }): Promise<StrategyVersionRecord | null>;
  create(input: StrategyVersionRecord): Promise<StrategyVersionRecord>;
}

function persistenceRecord(definition: StrategyDefinition): StrategyVersionRecord {
  return {
    code: definition.code,
    version: definition.version,
    name: definition.name,
    category: definition.category,
    status: "active",
    parameterSchema: definition.parameterSchema,
    defaultParameters: definition.defaultParameters,
    supportedMarkets: definition.supportedMarkets,
    supportedTimeframes: definition.supportedTimeframes,
    implementationHash: definition.implementationHash,
    sourceAttribution: definition.sourceAttribution,
    modificationNotice: definition.modificationNotice,
  };
}

const IMMUTABLE_FIELDS = [
  "name",
  "category",
  "status",
  "parameterSchema",
  "defaultParameters",
  "supportedMarkets",
  "supportedTimeframes",
  "implementationHash",
  "sourceAttribution",
  "modificationNotice",
] as const;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function syncStrategyCatalog(repository: StrategyCatalogRepository) {
  const synced: StrategyVersionRecord[] = [];
  for (const definition of STRATEGY_CATALOG) {
    const expected = persistenceRecord(definition);
    const existing = await repository.findByCodeVersion(definition);
    if (!existing) {
      synced.push(await repository.create(expected));
      continue;
    }
    const drifted = IMMUTABLE_FIELDS.find(
      (field) => stableJson(existing[field]) !== stableJson(expected[field]),
    );
    if (drifted) {
      throw new Error(
        `Strategy catalog drift for ${definition.code}@${definition.version}: ${drifted}`,
      );
    }
    synced.push(existing);
  }
  return synced;
}
