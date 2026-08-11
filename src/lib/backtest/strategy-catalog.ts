import { createHash } from "node:crypto";

import { z } from "zod";

const SOURCE_ATTRIBUTION =
  "Adapted from Stock-Prediction-Models agent notebooks (Apache License 2.0).";
const MODIFICATION_NOTICE =
  "Logic was rewritten for causal, long-only, next-bar execution in RadarAsset.";

type StrategyMarket = "vn_equity" | "crypto_spot" | "metal_spot";
type StrategyTimeframe = "1d" | "1h";
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
    supportedTimeframes: ["1d", "1h"],
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
    supportedTimeframes: ["1d", "1h"],
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
    supportedTimeframes: ["1d", "1h"],
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
    supportedTimeframes: ["1d", "1h"],
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
] as const;

function canonicalDescriptor(definition: StrategyDefinitionInput) {
  return JSON.stringify({
    code: definition.code,
    version: definition.version,
    name: definition.name,
    category: definition.category,
    supportedMarkets: definition.supportedMarkets,
    supportedTimeframes: definition.supportedTimeframes,
    requiredWarmup: definition.requiredWarmup,
    parameterSchema: definition.parameterSchema,
    defaultParameters: definition.defaultParameters,
    sourceAttribution: SOURCE_ATTRIBUTION,
    modificationNotice: MODIFICATION_NOTICE,
  });
}

function makeDefinition(input: StrategyDefinitionInput): StrategyDefinition {
  return {
    ...input,
    sourceAttribution: SOURCE_ATTRIBUTION,
    modificationNotice: MODIFICATION_NOTICE,
    implementationHash: createHash("sha256")
      .update(canonicalDescriptor(input), "utf8")
      .digest("hex"),
  };
}

export function strategyDefinition(code: string, version: string) {
  const definition = STRATEGY_CATALOG.find(
    (item) => item.code === code && item.version === version,
  );
  if (!definition) throw new Error(`Strategy ${code}@${version} not found.`);
  return definition;
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
