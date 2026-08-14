import { z } from "zod";

const datedValue = z.object({
  effectiveAt: z.string(),
  value: z.number(),
  classification: z.string(),
});

const flowValue = z.number().nullable();
const nullableCount = z.number().int().nonnegative().nullable();
const nullableRatio = z.number().min(0).max(1).nullable();
const largeAddressHorizon = z.object({
  netAccumulationBtc: z.number().nullable(),
  accumulationBreadth: nullableRatio,
  distributionBreadth: nullableRatio,
  accumulatingCount: nullableCount,
  distributingCount: nullableCount,
  unchangedCount: nullableCount,
});

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
  largeAddressActivity: z
    .object({
      status: z.enum(["system", "partial", "unavailable"]),
      sourceCodes: z.array(z.string()),
      effectiveAt: z.string().nullable(),
      universeObservedAt: z.string().nullable(),
      score: z.number().min(-100).max(100).nullable(),
      state: z.enum(["accumulation", "neutral", "distribution", "calibrating", "unavailable"]),
      confidence: z.number().min(0).max(100).nullable(),
      calibrationStatus: z.enum(["calibrating", "calibrated", "unavailable"]),
      horizons: z.object({
        oneDay: largeAddressHorizon,
        sevenDay: largeAddressHorizon,
        thirtyDay: largeAddressHorizon,
      }),
      exchangeFlows: z.array(
        z.object({
          effectiveAt: z.string(),
          toExchangeBtc: z.number(),
          fromExchangeBtc: z.number(),
          pressureBtc: z.number(),
        }),
      ),
      concentrationSeries: z.array(
        z.object({ effectiveAt: z.string(), top10Ratio: z.number().min(0).max(1) }),
      ),
      breadthSeries: z.array(
        z.object({
          effectiveAt: z.string(),
          netAccumulationBtc: z.number(),
          accumulationBreadth: z.number().min(0).max(1),
          distributionBreadth: z.number().min(0).max(1),
          accumulatingCount: z.number().int().nonnegative(),
          distributingCount: z.number().int().nonnegative(),
          unchangedCount: z.number().int().nonnegative(),
        }),
      ),
      notableActivity: z.array(
        z.object({
          effectiveAt: z.string(),
          address: z.string(),
          valueBtc: z.number().nonnegative(),
          direction: z.enum(["incoming", "outgoing"]),
          counterparty: z.string(),
          txid: z.string(),
          sourceUrl: z.string(),
          explorerUrl: z.string(),
        }),
      ),
      entrantsExits: z
        .object({
          entrantCount: z.number().int().nonnegative(),
          exitCount: z.number().int().nonnegative(),
          entrantBalanceBtc: z.number().nonnegative(),
          exitBalanceBtc: z.number().nonnegative(),
        })
        .nullable(),
      qualityFlags: z.array(z.string()),
      sources: z.array(
        z.object({
          sourceCode: z.string(),
          sourceUrl: z.string(),
          observedAt: z.string().nullable(),
        }),
      ),
      methodologyVersion: z.string().nullable(),
    })
    .optional(),
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
