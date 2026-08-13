import { z } from "zod";

const finitePositive = z.number().finite().positive().max(1_000_000_000_000);

const priceThresholdRuleSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("price_threshold"),
    operator: z.enum(["crosses_above", "crosses_below"]),
    threshold: finitePositive,
    currency: z.enum(["USD", "VND"]),
    action: z.enum(["buy", "sell"]),
    sizePct: z.number().finite().gt(0).max(100),
  })
  .strict();

const scheduledDcaRuleSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("scheduled_dca"),
    contributionAmount: finitePositive,
    currency: z.enum(["USD", "VND"]),
    frequency: z.literal("monthly"),
    dayOfMonth: z.number().int().min(1).max(28),
  })
  .strict();

export const executableRuleSchema = z.discriminatedUnion("kind", [
  priceThresholdRuleSchema,
  scheduledDcaRuleSchema,
]);

export type PriceThresholdRule = z.output<typeof priceThresholdRuleSchema>;
export type ScheduledDcaRule = z.output<typeof scheduledDcaRuleSchema>;
export type ExecutableRule = z.output<typeof executableRuleSchema>;

export const createCustomStrategySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2_000).optional(),
    rule: executableRuleSchema,
  })
  .strict();

export type CreateCustomStrategyInput = z.output<typeof createCustomStrategySchema>;

export const createCustomStrategyVersionSchema = z.object({ rule: executableRuleSchema }).strict();

export type CreateCustomStrategyVersionInput = z.output<typeof createCustomStrategyVersionSchema>;

export function normalizeExecutableRule(input: unknown): ExecutableRule {
  return executableRuleSchema.parse(input);
}

export function nextSemanticVersion(previous: string | null): string {
  if (previous === null) return "1.0.0";
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(previous);
  if (!match) throw new Error("Previous strategy version is invalid.");
  const [major, minor, patch] = match.slice(1).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) {
    throw new Error("Previous strategy version is invalid.");
  }
  return `${major}.${minor}.${patch + 1}`;
}
