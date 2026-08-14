import { getPrisma } from "@/lib/db/prisma";

import type {
  SmartInsightsDataHealthResponse,
  SmartInsightSourceHealth,
} from "./smart-insights-types";

type SourcePolicy = Pick<
  SmartInsightSourceHealth,
  "sourceCode" | "sourceName" | "market" | "collectionMode" | "parserVersion"
> & { freshnessSlaMinutes: number };

const SOURCE_POLICIES = [
  {
    sourceCode: "alternative-fng",
    sourceName: "Alternative.me Crypto Fear and Greed",
    market: "crypto",
    collectionMode: "api",
    parserVersion: "alternative-fng-v1",
    freshnessSlaMinutes: 2_880,
  },
  {
    sourceCode: "bitinfocharts-top-addresses",
    sourceName: "BitInfoCharts Richest Bitcoin Addresses",
    market: "crypto",
    collectionMode: "scrapling",
    parserVersion: "bitinfocharts-v1",
    freshnessSlaMinutes: 2_880,
  },
  {
    sourceCode: "cftc-disaggregated",
    sourceName: "CFTC Disaggregated Commitments of Traders",
    market: "gold",
    collectionMode: "api",
    parserVersion: "cftc-disaggregated-v1",
    freshnessSlaMinutes: 14_400,
  },
  {
    sourceCode: "cftc-legacy",
    sourceName: "CFTC Legacy Commitments of Traders",
    market: "gold",
    collectionMode: "api",
    parserVersion: "cftc-legacy-v1",
    freshnessSlaMinutes: 14_400,
  },
  {
    sourceCode: "coinmetrics-community",
    sourceName: "Coin Metrics Community API",
    market: "crypto",
    collectionMode: "api",
    parserVersion: "coinmetrics-v1",
    freshnessSlaMinutes: 2_880,
  },
  {
    sourceCode: "coinshares-weekly",
    sourceName: "CoinShares Digital Asset Fund Flows",
    market: "crypto",
    collectionMode: "scrapling",
    parserVersion: "coinshares-v1",
    freshnessSlaMinutes: 10_080,
  },
  {
    sourceCode: "cryptocraft",
    sourceName: "CryptoCraft Economic Calendar",
    market: "macro",
    collectionMode: "scrapling",
    parserVersion: "cryptocraft-v1",
    freshnessSlaMinutes: 120,
  },
  {
    sourceCode: "defillama-chains",
    sourceName: "DefiLlama Chains",
    market: "crypto",
    collectionMode: "api",
    parserVersion: "defillama-chains-v1",
    freshnessSlaMinutes: 1_440,
  },
  {
    sourceCode: "defillama-stablecoins",
    sourceName: "DefiLlama Stablecoins",
    market: "crypto",
    collectionMode: "api",
    parserVersion: "defillama-stablecoins-v1",
    freshnessSlaMinutes: 2_880,
  },
  {
    sourceCode: "deribit-public",
    sourceName: "Deribit Public API",
    market: "crypto",
    collectionMode: "api",
    parserVersion: "deribit-v1",
    freshnessSlaMinutes: 1_440,
  },
  {
    sourceCode: "farside-btc-etf",
    sourceName: "Farside Bitcoin ETF Flows",
    market: "crypto",
    collectionMode: "scrapling",
    parserVersion: "farside-btc-v1",
    freshnessSlaMinutes: 2_880,
  },
  {
    sourceCode: "farside-eth-etf",
    sourceName: "Farside Ethereum ETF Flows",
    market: "crypto",
    collectionMode: "scrapling",
    parserVersion: "farside-eth-v1",
    freshnessSlaMinutes: 2_880,
  },
  {
    sourceCode: "farside-sol-etf",
    sourceName: "Farside Solana ETF Flows",
    market: "crypto",
    collectionMode: "scrapling",
    parserVersion: "farside-sol-v1",
    freshnessSlaMinutes: 2_880,
  },
  {
    sourceCode: "fred",
    sourceName: "Federal Reserve Economic Data",
    market: "macro",
    collectionMode: "api",
    parserVersion: "fred-v1",
    freshnessSlaMinutes: 4_320,
  },
  {
    sourceCode: "mempool-btc-large-addresses",
    sourceName: "mempool.space BTC Large Addresses",
    market: "crypto",
    collectionMode: "api",
    parserVersion: "mempool-btc-large-addresses-v1",
    freshnessSlaMinutes: 2_880,
  },
  {
    sourceCode: "mempool-space",
    sourceName: "mempool.space",
    market: "crypto",
    collectionMode: "api",
    parserVersion: "mempool-v1",
    freshnessSlaMinutes: 1_440,
  },
] as const satisfies readonly SourcePolicy[];

const PUBLIC_ERROR_CODES = new Set([
  "CONFIGURATION_ERROR",
  "DUPLICATE_CONFLICT",
  "HTTP_ERROR",
  "INTERNAL_ERROR",
  "INVALID_RESPONSE",
  "INVALID_TIMESTAMP",
  "INVALID_UNIT",
  "MISSING_REQUIRED_FIELD",
  "MISSING_TABLE",
  "NETWORK_ERROR",
  "OCR_LAYOUT_DRIFT",
  "OCR_LOW_CONFIDENCE",
  "RATE_LIMITED",
  "RECONCILIATION_FAILED",
  "REDIRECT_REJECTED",
  "RESPONSE_TOO_LARGE",
  "SOURCE_NOT_IMPLEMENTED",
  "TIMEOUT",
  "UPSTREAM_SERVER_ERROR",
]);

function publicErrorCode(value: string | null | undefined): string | null {
  return value && PUBLIC_ERROR_CODES.has(value) ? value : null;
}

export async function loadSmartInsightsDataHealth(
  now = new Date(),
): Promise<SmartInsightsDataHealthResponse> {
  const prisma = getPrisma();
  const sourceCodes = SOURCE_POLICIES.map((source) => source.sourceCode);
  const [providers, recentRuns] = await Promise.all([
    prisma.dataProvider.findMany({
      where: { code: { in: sourceCodes } },
      select: {
        id: true,
        code: true,
        status: true,
        metricObservations: {
          where: { qualityStatus: { in: ["passed", "warning"] } },
          orderBy: [{ observedAt: "desc" }, { effectiveAt: "desc" }],
          take: 1,
          select: {
            effectiveAt: true,
            observedAt: true,
            metricDefinition: { select: { freshnessSlaMinutes: true } },
          },
        },
        rawInsightSnapshots: {
          where: { status: "quarantined" },
          orderBy: { observedAt: "desc" },
          take: 1,
          select: { observedAt: true },
        },
      },
    }),
    prisma.providerRun.findMany({
      where: { provider: { in: sourceCodes } },
      orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
      select: {
        provider: true,
        status: true,
        errorCode: true,
        finishedAt: true,
        createdAt: true,
      },
    }),
  ]);
  const providerByCode = new Map(providers.map((provider) => [provider.code, provider]));
  const latestRunByCode = new Map<string, (typeof recentRuns)[number]>();
  for (const run of recentRuns) {
    if (!latestRunByCode.has(run.provider)) latestRunByCode.set(run.provider, run);
  }

  const sources = SOURCE_POLICIES.map((policy): SmartInsightSourceHealth => {
    const provider = providerByCode.get(policy.sourceCode);
    const observation = provider?.metricObservations[0];
    const quarantine = provider?.rawInsightSnapshots[0];
    const latestRun = latestRunByCode.get(policy.sourceCode);
    const enabled = provider?.status === "active";
    const quarantineIsLatest =
      quarantine !== undefined &&
      (observation === undefined || quarantine.observedAt > observation.observedAt);
    const lastStatus = !enabled
      ? "unavailable"
      : quarantineIsLatest
        ? "quarantined"
        : observation
          ? "validated"
          : "unavailable";
    const slaMinutes =
      observation?.metricDefinition.freshnessSlaMinutes ?? policy.freshnessSlaMinutes;
    const fresh =
      enabled &&
      observation !== undefined &&
      now.getTime() - observation.observedAt.getTime() <= slaMinutes * 60_000;

    return {
      sourceCode: policy.sourceCode,
      sourceName: policy.sourceName,
      market: policy.market,
      collectionMode: policy.collectionMode,
      parserVersion: policy.parserVersion,
      lastEffectiveAt: observation?.effectiveAt.toISOString() ?? null,
      lastObservedAt: observation?.observedAt.toISOString() ?? null,
      lastStatus,
      lastErrorCode: publicErrorCode(latestRun?.errorCode),
      freshness: !enabled || !observation ? "UNAVAILABLE" : fresh ? "FRESH" : "STALE",
    };
  });

  return { generatedAt: now.toISOString(), sources };
}
