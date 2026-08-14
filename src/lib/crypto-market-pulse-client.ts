import { z } from "zod";

const datedValue = z.object({
  effectiveAt: z.string(),
  value: z.number(),
  classification: z.string(),
});

const flowValue = z.number().nullable();

export const cryptoMarketPulseSchema = z.object({
  generatedAt: z.string(),
  fearGreed: z.object({
    status: z.enum(["system", "unavailable"]),
    sourceCode: z.literal("alternative-fng"),
    sourceUrl: z.string(),
    latest: datedValue.nullable(),
    series: z.array(datedValue),
  }),
  etfFlows: z.object({
    status: z.enum(["system", "partial", "unavailable"]),
    sourceCodes: z.array(z.string()),
    series: z.array(
      z.object({
        effectiveAt: z.string(),
        btc: flowValue,
        eth: flowValue,
        sol: flowValue,
        total: z.number(),
      }),
    ),
    summaries: z.array(
      z.object({
        asset: z.enum(["BTC", "ETH", "SOL"]),
        latest: flowValue,
        fiveDay: flowValue,
        thirtyDay: flowValue,
        latestEffectiveAt: z.string().nullable(),
      }),
    ),
  }),
  fundFlows: z.object({
    status: z.enum(["system", "unavailable"]),
    sourceCode: z.literal("coinshares-weekly"),
    sourceUrl: z.string(),
    series: z.array(
      z.object({
        effectiveAt: z.string(),
        total: z.number(),
        assets: z.array(z.object({ label: z.string(), value: z.number() })),
      }),
    ),
    latestBreakdown: z.array(z.object({ label: z.string(), value: z.number() })),
  }),
});

export type CryptoMarketPulseModel = z.infer<typeof cryptoMarketPulseSchema>;

export async function fetchCryptoMarketPulse(
  signal?: AbortSignal,
): Promise<CryptoMarketPulseModel> {
  const response = await fetch("/api/smart-insights/crypto-market-pulse", {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Crypto Market Pulse request failed (${response.status}).`);
  return cryptoMarketPulseSchema.parse(await response.json());
}
