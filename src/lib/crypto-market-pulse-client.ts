import { z } from "zod";

const datedValue = z.object({
  effectiveAt: z.string(),
  value: z.number(),
  classification: z.string(),
});

const flowValue = z.number().nullable();
const timestamp = z.string().min(1);
const finite = z.number().finite();
const sourceStatus = z.enum(["system", "partial", "unavailable"]);
const cbbiComponentCode = z.enum([
  "pi_cycle",
  "rupl_nupl",
  "rhodl",
  "puell",
  "two_year_ma",
  "trolololo",
  "mvrv",
  "reserve_risk",
  "woobull",
]);
const cbbiComponents = z
  .array(z.object({ code: cbbiComponentCode, value: finite.min(0).max(100) }))
  .max(9)
  .superRefine((items, context) => {
    if (new Set(items.map((item) => item.code)).size !== items.length) {
      context.addIssue({ code: "custom", message: "CBBI components must be unique." });
    }
  });
const cbbiPoint = z.object({
  effectiveAt: timestamp,
  confidence: finite.min(0).max(100),
  components: cbbiComponents,
});
const liquidationSide = z.object({
  priceUsd: finite.nonnegative(),
  levelUsd: finite.nonnegative(),
  distanceRatio: finite,
});
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
  marginBorrow: z.object({
    status: sourceStatus,
    sourceCode: z.literal("coinglass-margin-borrow"),
    sourceUrl: z.string().min(1),
    observedAt: timestamp.nullable(),
    series: z.array(
      z.object({
        effectiveAt: timestamp,
        annualizedRate: finite.nullable(),
        dailyRate: finite.nullable(),
        hourlyRate: finite.nullable(),
      }),
    ),
  }),
  liquidationMaxPain: z
    .object({
      status: sourceStatus,
      sourceCode: z.literal("coinglass-liquidation-maxpain"),
      sourceUrl: z.string().min(1),
      observedAt: timestamp.nullable(),
      rows: z.array(
        z.object({
          asset: z.enum(["BTC", "ETH", "SOL"]),
          range: z.literal("24h"),
          effectiveAt: timestamp,
          currentPriceUsd: finite.nonnegative().nullable(),
          long: liquidationSide.nullable(),
          short: liquidationSide.nullable(),
        }),
      ),
    })
    .superRefine((value, context) => {
      if (new Set(value.rows.map((row) => row.asset)).size !== value.rows.length) {
        context.addIssue({ code: "custom", message: "Liquidation assets must be unique." });
      }
    }),
  cycleIndicators: z.object({
    altcoinSeason: z.object({
      status: sourceStatus,
      sourceCode: z.literal("blockchaincenter-altcoin-season"),
      sourceUrl: z.string().min(1),
      observedAt: timestamp.nullable(),
      latest: z
        .object({
          effectiveAt: timestamp,
          season90d: finite.min(0).max(100).nullable(),
          month: finite.min(0).max(100).nullable(),
          year: finite.min(0).max(100).nullable(),
          classification: z
            .enum(["bitcoin_season", "neutral", "altcoin_season"])
            .nullable(),
        })
        .nullable(),
      series: z.array(
        z.object({
          effectiveAt: timestamp,
          season90d: finite.min(0).max(100).nullable(),
          month: finite.min(0).max(100).nullable(),
          year: finite.min(0).max(100).nullable(),
        }),
      ),
    }),
    cbbi: z
      .object({
        status: sourceStatus,
        sourceCode: z.literal("cbbi-public"),
        sourceUrl: z.string().min(1),
        observedAt: timestamp.nullable(),
        latest: cbbiPoint.nullable(),
        series: z.array(cbbiPoint),
      })
      .superRefine((value, context) => {
        if (value.status === "system" && value.latest?.components.length !== 9) {
          context.addIssue({
            code: "custom",
            message: "System CBBI data requires exactly nine components.",
          });
        }
      }),
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
