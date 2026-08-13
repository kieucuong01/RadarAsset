import { z } from "zod";

import {
  createCustomStrategySchema,
  createCustomStrategyVersionSchema,
  executableRuleSchema,
  type CreateCustomStrategyInput,
  type CreateCustomStrategyVersionInput,
} from "@/lib/custom-strategies/contracts";

const versionSchema = z
  .object({
    id: z.string(),
    version: z.string(),
    kind: z.enum(["price_threshold", "scheduled_dca"]),
    rule: executableRuleSchema,
    implementationHash: z.string().length(64),
    status: z.enum(["active", "retired"]),
    executionCode: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const customStrategySummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    family: z.enum(["technical", "systematic"]),
    status: z.enum(["active", "archived"]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    versions: z.array(versionSchema),
  })
  .strict();

export type CustomStrategySummary = z.infer<typeof customStrategySummarySchema>;

async function parseResponse(response: Response) {
  if (!response.ok) throw new Error("CUSTOM_STRATEGY_REQUEST_FAILED");
  return customStrategySummarySchema.parse(await response.json());
}

export async function listCustomStrategies(fetcher: typeof fetch = fetch) {
  const response = await fetcher("/api/quant/custom-strategies", { cache: "no-store" });
  if (!response.ok) throw new Error("CUSTOM_STRATEGY_REQUEST_FAILED");
  return z
    .array(customStrategySummarySchema)
    .max(100)
    .parse(await response.json());
}

export async function createCustomStrategy(
  input: CreateCustomStrategyInput,
  fetcher: typeof fetch = fetch,
) {
  const payload = createCustomStrategySchema.parse(input);
  return parseResponse(
    await fetcher("/api/quant/custom-strategies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function createCustomStrategyVersion(
  id: string,
  input: CreateCustomStrategyVersionInput,
  fetcher: typeof fetch = fetch,
) {
  const payload = createCustomStrategyVersionSchema.parse(input);
  return parseResponse(
    await fetcher(`/api/quant/custom-strategies/${encodeURIComponent(id)}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function archiveCustomStrategy(id: string, fetcher: typeof fetch = fetch) {
  return parseResponse(
    await fetcher(`/api/quant/custom-strategies/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  );
}
