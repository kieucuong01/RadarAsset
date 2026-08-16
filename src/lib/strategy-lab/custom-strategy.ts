import { z } from "zod";

import { normalizeStrategyParameters, strategyDefinition } from "@/lib/backtest/strategy-catalog";
import {
  formatCount,
  formatMoney,
  formatPercent,
  formatPrice,
  formatRatio,
} from "@/lib/financial-format";
import type { Locale } from "@/lib/i18n/dictionary";

const baseRule = {
  schemaVersion: z.literal(1),
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(120),
  symbol: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .transform((value) => value.toUpperCase()),
};

const catalogPresetSchema = z
  .object({
    ...baseRule,
    kind: z.literal("catalog_preset"),
    strategyCode: z.string().trim().min(1),
    strategyVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    strategyParameters: z.record(z.string(), z.unknown()),
  })
  .strict();

const scheduledDcaSchema = z
  .object({
    ...baseRule,
    kind: z.literal("scheduled_dca"),
    amount: z.number().positive().max(1_000_000_000),
    currency: z.enum(["USD", "VND"]),
    frequency: z.literal("monthly"),
    dayOfMonth: z.number().int().min(1).max(28),
  })
  .strict();

const priceThresholdSchema = z
  .object({
    ...baseRule,
    kind: z.literal("price_threshold"),
    operator: z.enum(["crosses_above", "crosses_below"]),
    value: z.number().positive(),
    currency: z.enum(["USD", "VND"]),
    action: z.enum(["buy", "sell"]),
    sizePct: z.number().positive().max(100),
  })
  .strict();

const fundamentalThresholdSchema = z
  .object({
    ...baseRule,
    kind: z.literal("fundamental_threshold"),
    metric: z.enum(["pb", "pe", "roe"]),
    operator: z.enum(["lt", "lte", "gt", "gte"]),
    value: z.number().finite(),
    action: z.enum(["buy", "sell"]),
  })
  .strict();

const customStrategyInputSchema = z.discriminatedUnion("kind", [
  catalogPresetSchema,
  scheduledDcaSchema,
  priceThresholdSchema,
  fundamentalThresholdSchema,
]);

export type CustomStrategyInput = z.input<typeof customStrategyInputSchema>;
export type CustomStrategy = z.output<typeof customStrategyInputSchema> & {
  readiness: StrategyReadinessStatus;
};
export type CatalogStrategyPreset = Extract<CustomStrategy, { kind: "catalog_preset" }>;
export type StrategyReadinessStatus = "executable" | "engine_required" | "data_required";

export function customStrategyReadiness(input: CustomStrategyInput | CustomStrategy) {
  if (input.kind === "catalog_preset") {
    return { status: "executable" as const, detail: "Có thể chạy bằng engine hiện tại." };
  }
  if (input.kind === "fundamental_threshold") {
    return {
      status: "data_required" as const,
      detail: "Cần dữ liệu báo cáo tài chính point-in-time trước khi backtest.",
    };
  }
  return {
    status: "executable" as const,
    detail: "Có thể chạy bằng custom-rule engine hiện tại.",
  };
}

export function normalizeCustomStrategy(input: unknown): CustomStrategy {
  const parsed = customStrategyInputSchema.parse(input);
  if (parsed.kind !== "catalog_preset") {
    return { ...parsed, readiness: customStrategyReadiness(parsed).status } as CustomStrategy;
  }
  strategyDefinition(parsed.strategyCode, parsed.strategyVersion);
  return {
    ...parsed,
    strategyParameters: normalizeStrategyParameters(parsed.strategyCode, parsed.strategyParameters),
    readiness: "executable",
  } as CatalogStrategyPreset;
}

const OPERATOR_LABELS = {
  crosses_above: "cắt lên",
  crosses_below: "cắt xuống",
  lt: "nhỏ hơn",
  lte: "nhỏ hơn hoặc bằng",
  gt: "lớn hơn",
  gte: "lớn hơn hoặc bằng",
} as const;

export function describeCustomStrategy(
  input: CustomStrategyInput | CustomStrategy,
  locale: Locale = "vi",
) {
  const rule = normalizeCustomStrategy(input);
  if (rule.kind === "catalog_preset") {
    const name = strategyDefinition(rule.strategyCode, rule.strategyVersion).name;
    return locale === "vi"
      ? `${rule.symbol}: ${name} với tham số đã lưu.`
      : `${rule.symbol}: ${name} with saved parameters.`;
  }
  if (rule.kind === "scheduled_dca") {
    return `${locale === "vi" ? "Mua" : "Buy"} ${rule.symbol} ${locale === "vi" ? "trị giá" : "worth"} ${formatMoney(rule.amount, { locale, currency: rule.currency })} ${locale === "vi" ? "vào ngày" : "on day"} ${formatCount(rule.dayOfMonth)} ${locale === "vi" ? "hàng tháng" : "monthly"}.`;
  }
  if (rule.kind === "price_threshold") {
    const threshold = formatPrice(rule.value, { locale, currency: rule.currency });
    return `${rule.action === "buy" ? (locale === "vi" ? "Mua" : "Buy") : locale === "vi" ? "Bán" : "Sell"} ${formatPercent(rule.sizePct)} ${rule.symbol} ${locale === "vi" ? "khi giá" : "when price"} ${OPERATOR_LABELS[rule.operator]} ${threshold}.`;
  }
  return `${rule.action === "buy" ? (locale === "vi" ? "Mua" : "Buy") : locale === "vi" ? "Bán" : "Sell"} ${rule.symbol} ${locale === "vi" ? "khi" : "when"} ${rule.metric.toUpperCase()} ${OPERATOR_LABELS[rule.operator]} ${formatRatio(rule.value)}.`;
}

const storageSchema = z
  .object({
    version: z.literal(1),
    strategies: z.array(z.unknown()).max(100),
  })
  .strict();

export function serializeCustomStrategies(strategies: readonly CustomStrategyInput[]) {
  return JSON.stringify({
    version: 1,
    strategies: strategies.map((strategy) => {
      const { readiness: _readiness, ...source } = normalizeCustomStrategy(strategy);
      return source;
    }),
  });
}

export function parseStoredCustomStrategies(raw: string | null): CustomStrategy[] {
  if (!raw) return [];
  try {
    const stored = storageSchema.parse(JSON.parse(raw));
    return stored.strategies.flatMap((item) => {
      try {
        return [normalizeCustomStrategy(item)];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}
