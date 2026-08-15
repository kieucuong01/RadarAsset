import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { assertSeedDatabaseAllowed, resetDemoIdentity } from "../src/lib/backend/seed-safety";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for Prisma seed.");
}
if (process.env.NODE_ENV === "production") {
  throw new Error("The development seed is disabled in production.");
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Prisma seed.`);
  return value;
}

requiredEnvironment("BETTER_AUTH_URL");
requiredEnvironment("BETTER_AUTH_SECRET");
const demoPassword = requiredEnvironment("DEV_DEMO_PASSWORD");
const allowedSeedDatabase = requiredEnvironment("DEV_SEED_DATABASE");
assertSeedDatabaseAllowed(connectionString, allowedSeedDatabase);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const demoEmail = "demo@radarasset.local";

const assetSeed = [
  {
    symbol: "BTC",
    name: "Bitcoin",
    assetClass: "crypto",
    market: "crypto_spot",
    currency: "USDT",
    price: 67420,
    cost: 54200,
    qty: 0.85,
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    assetClass: "crypto",
    market: "crypto_spot",
    currency: "USDT",
    price: 3512,
    cost: 2980,
    qty: 12.4,
  },
  {
    symbol: "FPT",
    name: "FPT Corporation",
    assetClass: "equity",
    market: "vn_equity",
    currency: "VND",
    price: 150,
    cost: 120,
    qty: 100,
  },
  {
    symbol: "VCB",
    name: "Vietcombank",
    assetClass: "equity",
    market: "vn_equity",
    currency: "VND",
    price: 70,
    cost: 65,
    qty: 200,
  },
  {
    symbol: "HPG",
    name: "Hoa Phat Group",
    assetClass: "equity",
    market: "vn_equity",
    currency: "VND",
    price: 28,
    cost: 25,
    qty: 500,
  },
  {
    symbol: "XAU",
    name: "Gold Spot",
    assetClass: "commodity",
    market: "metal_spot",
    currency: "USD",
    price: 2402,
    cost: 2260,
    qty: 6,
  },
  {
    symbol: "VN30",
    name: "VN30 Index",
    assetClass: "index",
    market: "vn_equity",
    currency: "VND",
    price: 1328.2,
    cost: 1268,
    qty: 5,
  },
] as const;

const insightSeed = [
  {
    source: "CryptoQuant",
    symbol: "BTC",
    sentiment: "bull",
    confidence: 82,
    catalyst: "ETF inflows",
    risk: "Fed repricing",
    title: "BTC Spot ETF inflows hit 3-week high as whales reload positions",
    summary:
      "Accumulation addresses gained 18,400 BTC, historically a precursor to upward continuation.",
  },
  {
    source: "SSI Research",
    symbol: "VN30",
    sentiment: "bull",
    confidence: 76,
    catalyst: "Bank earnings rebound",
    risk: "Credit growth disappointment",
    title: "VN30 banking sector projected to lead Q3 earnings rebound",
    summary:
      "Credit growth recovery and stable NIM support double-digit profit growth for top lenders.",
  },
  {
    source: "Bloomberg",
    symbol: "XAU",
    sentiment: "bull",
    confidence: 72,
    catalyst: "Central bank demand",
    risk: "Real yield spike",
    title: "Central banks add 38 tonnes of gold in May",
    summary: "PBoC and RBI lead inflows; gold breaks out of 6-week consolidation above $2,400.",
  },
  {
    source: "Reuters",
    symbol: null,
    sentiment: "bear",
    confidence: 68,
    catalyst: null,
    risk: "Higher real yields",
    title: "Hawkish FOMC minutes lift 10Y yields above 4.30%",
    summary: "Stickier core services inflation raises real-yield risk for long-duration assets.",
  },
] as const;

const eventSeed = [
  {
    event: "Core CPI m/m",
    country: "US",
    impact: "high",
    forecast: "0.3%",
    previous: "0.3%",
    eventAt: "2026-06-13T08:30:00.000Z",
  },
  {
    event: "Crude Oil Inventories",
    country: "US",
    impact: "medium",
    forecast: "-1.2M",
    previous: "0.8M",
    eventAt: "2026-06-13T10:00:00.000Z",
  },
  {
    event: "ECB Rate Decision",
    country: "EU",
    impact: "high",
    forecast: "4.25%",
    previous: "4.25%",
    eventAt: "2026-06-14T07:45:00.000Z",
  },
  {
    event: "VN CPI y/y",
    country: "VN",
    impact: "high",
    forecast: "4.2%",
    previous: "4.4%",
    eventAt: "2026-06-19T09:00:00.000Z",
  },
] as const;

function generateBars(price: number, symbolIndex: number) {
  const out: {
    timeframe: string;
    ts: Date;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    source: string;
  }[] = [];
  const start = Date.UTC(2026, 4, 15);
  let close = price * 0.92;

  for (let i = 0; i < 30; i += 1) {
    const drift = 1 + Math.sin(i * 0.61 + symbolIndex) * 0.009 + 0.0025;
    const nextClose = i === 29 ? price : close * drift;
    const open = close;
    const high = Math.max(open, nextClose) * 1.006;
    const low = Math.min(open, nextClose) * 0.994;
    out.push({
      timeframe: "1d",
      ts: new Date(start + i * 24 * 60 * 60 * 1000),
      open,
      high,
      low,
      close: nextClose,
      volume: Math.round((1000000 + symbolIndex * 120000) * (1 + i / 100)),
      source: "seed",
    });
    close = nextClose;
  }

  return out;
}

async function main() {
  await prisma.$transaction((transaction) =>
    resetDemoIdentity(transaction, {
      email: demoEmail,
      organizationSlug: "demo-workspace",
    }),
  );

  await prisma.aiInsight.deleteMany({
    where: {
      researchRunId: null,
      title: { in: insightSeed.map((insight) => insight.title) },
    },
  });
  await prisma.economicEvent.deleteMany({
    where: {
      OR: eventSeed.map((event) => ({
        event: event.event,
        eventAt: new Date(event.eventAt),
      })),
    },
  });

  const { auth } = await import("../src/lib/auth");
  const signUp = await auth.api.signUpEmail({
    body: {
      email: demoEmail,
      password: demoPassword,
      name: "Demo Investor",
    },
  });
  const user = signUp.user;

  const organization = await auth.api.createOrganization({
    body: {
      name: "RadarAsset Demo",
      slug: "demo-workspace",
      userId: user.id,
    },
  });
  if (!organization) {
    throw new Error("Failed to create the demo workspace.");
  }

  const assetBySymbol = new Map<string, { id: string }>();
  for (const [index, asset] of assetSeed.entries()) {
    const created = await prisma.asset.upsert({
      where: { symbol: asset.symbol },
      create: {
        symbol: asset.symbol,
        name: asset.name,
        assetClass: asset.assetClass,
        market: asset.market,
        currency: asset.currency,
        provider: "seed",
        providerSymbol: asset.symbol,
      },
      update: {
        name: asset.name,
        assetClass: asset.assetClass,
        market: asset.market,
        currency: asset.currency,
        provider: "seed",
        providerSymbol: asset.symbol,
      },
      select: { id: true },
    });
    await prisma.marketBar.deleteMany({
      where: { assetId: created.id, source: "seed" },
    });
    await prisma.marketBar.createMany({
      data: generateBars(asset.price, index).map((bar) => ({
        ...bar,
        assetId: created.id,
      })),
    });
    assetBySymbol.set(asset.symbol, created);
  }

  const portfolio = await prisma.portfolio.findUniqueOrThrow({
    where: {
      organizationId_name: {
        organizationId: organization.id,
        name: "Main Portfolio",
      },
    },
  });

  for (const asset of assetSeed) {
    const assetId = assetBySymbol.get(asset.symbol)?.id;
    if (!assetId || asset.qty <= 0) continue;
    const openingFee = Math.max(1, asset.cost * asset.qty * 0.0002);
    await prisma.portfolioPosition.create({
      data: {
        portfolioId: portfolio.id,
        assetId,
        quantity: asset.qty,
        averageCost: (asset.cost * asset.qty + openingFee) / asset.qty,
      },
    });
    await prisma.portfolioTransaction.create({
      data: {
        portfolioId: portfolio.id,
        assetId,
        type: "buy",
        quantity: asset.qty,
        price: asset.cost,
        fee: openingFee,
        note: "Seed opening position",
        executedAt: new Date("2026-05-15T09:30:00.000Z"),
      },
    });
  }

  for (const item of [
    { symbol: "BTC", alert: 70000 },
    { symbol: "ETH", alert: 3800 },
    { symbol: "FPT", alert: 155 },
    { symbol: "VCB", alert: 75 },
    { symbol: "XAU", alert: 2450 },
    { symbol: "VN30", alert: 1350 },
  ]) {
    const assetId = assetBySymbol.get(item.symbol)?.id;
    if (!assetId) continue;
    await prisma.watchlistItem.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        assetId,
        alert: item.alert,
      },
    });
  }

  const btcAssetId = assetBySymbol.get("BTC")?.id;
  const vn30AssetId = assetBySymbol.get("VN30")?.id;
  const goldAssetId = assetBySymbol.get("XAU")?.id;

  await prisma.investmentThesis.deleteMany({
    where: {
      researchRunId: null,
      source: "seed-research",
      assetId: { in: [vn30AssetId, goldAssetId].filter((id): id is string => Boolean(id)) },
    },
  });
  if (btcAssetId) {
    await prisma.modelEvaluation.deleteMany({
      where: {
        assetId: btcAssetId,
        model: "kronos-small",
        task: "directional_forecast",
      },
    });
  }

  const seedSentimentRun = await prisma.researchRun.create({
    data: {
      organizationId: organization.id,
      userId: user.id,
      assetId: btcAssetId,
      source: "seed-research",
      kind: "sentiment",
      status: "succeeded",
      parameters: {
        dataStatus: "sample",
        method: "deterministic local fixture",
        topic: "Bitcoin BTC investment sentiment catalysts risks",
        sources: ["reddit", "x", "youtube", "hackernews", "web"],
      },
      summary:
        "Retail and expert conversations remain constructive on BTC, driven by ETF flows and supply tightness, with macro rate risk as the main counterweight.",
      startedAt: new Date("2026-07-27T01:00:00.000Z"),
      finishedAt: new Date("2026-07-27T01:02:30.000Z"),
      providerRuns: {
        create: [
          {
            provider: "reddit",
            status: "succeeded",
            recordsFetched: 42,
            startedAt: new Date("2026-07-27T01:00:05.000Z"),
            finishedAt: new Date("2026-07-27T01:00:45.000Z"),
          },
          {
            provider: "web",
            status: "succeeded",
            recordsFetched: 18,
            startedAt: new Date("2026-07-27T01:00:45.000Z"),
            finishedAt: new Date("2026-07-27T01:01:25.000Z"),
          },
        ],
      },
    },
  });

  const seedThesisRun = await prisma.researchRun.create({
    data: {
      organizationId: organization.id,
      userId: user.id,
      assetId: btcAssetId,
      source: "seed-research",
      kind: "investment_thesis",
      status: "succeeded",
      parameters: {
        dataStatus: "sample",
        method: "deterministic thesis fixture",
        arithmetic: "exact",
        output: "investor memo",
      },
      summary:
        "BTC thesis is accumulate on pullbacks: strong structural demand, but position sizing should respect inflation-event volatility.",
      startedAt: new Date("2026-07-27T01:03:00.000Z"),
      finishedAt: new Date("2026-07-27T01:05:00.000Z"),
    },
  });

  const kronosRun = await prisma.researchRun.create({
    data: {
      organizationId: organization.id,
      userId: user.id,
      assetId: btcAssetId,
      source: "kronos",
      kind: "forecast",
      status: "succeeded",
      parameters: {
        model: "kronos-small",
        contextBars: 512,
        horizons: ["7d", "30d"],
      },
      summary:
        "Forecast path is mildly positive, but confidence is medium because seeded local history is shallow.",
      startedAt: new Date("2026-07-27T01:05:10.000Z"),
      finishedAt: new Date("2026-07-27T01:05:50.000Z"),
    },
  });

  await prisma.researchRun.create({
    data: {
      organizationId: organization.id,
      userId: user.id,
      source: "seed-provider-health",
      kind: "provider_health",
      status: "succeeded",
      parameters: {
        dataStatus: "sample",
        providers: ["seed", "csv", "future-live-provider"],
        mode: "failover-template",
      },
      summary:
        "Provider manager template is ready for retries, failover diagnostics, and stale data detection.",
      startedAt: new Date("2026-07-27T01:06:00.000Z"),
      finishedAt: new Date("2026-07-27T01:06:20.000Z"),
      providerRuns: {
        create: {
          provider: "seed",
          status: "succeeded",
          recordsFetched: 270,
          startedAt: new Date("2026-07-27T01:06:01.000Z"),
          finishedAt: new Date("2026-07-27T01:06:18.000Z"),
        },
      },
    },
  });

  const insightBySymbol = new Map<string, string>();
  for (const insight of insightSeed) {
    const createdInsight = await prisma.aiInsight.create({
      data: {
        assetId: insight.symbol ? assetBySymbol.get(insight.symbol)?.id : undefined,
        researchRunId: insight.symbol === "BTC" ? seedSentimentRun.id : undefined,
        source: insight.source,
        sentiment: insight.sentiment,
        confidence: insight.confidence,
        catalyst: insight.catalyst,
        risk: insight.risk,
        title: insight.title,
        summary: insight.summary,
        publishedAt: new Date("2026-07-27T01:10:00.000Z"),
      },
      select: { id: true },
    });
    if (insight.symbol) insightBySymbol.set(insight.symbol, createdInsight.id);
  }

  if (btcAssetId) {
    await prisma.evidenceItem.createMany({
      data: [
        {
          researchRunId: seedSentimentRun.id,
          assetId: btcAssetId,
          insightId: insightBySymbol.get("BTC"),
          sourceType: "reddit",
          sourceName: "r/Bitcoin",
          url: "https://example.com/reddit-btc-etf",
          title: "ETF flow discussion clusters around persistent bid",
          excerpt:
            "Investor conversations emphasize ETF demand, exchange outflows, and reluctance to sell core BTC exposure.",
          engagement: 420,
          observedAt: new Date("2026-07-26T22:00:00.000Z"),
        },
        {
          researchRunId: seedSentimentRun.id,
          assetId: btcAssetId,
          insightId: insightBySymbol.get("BTC"),
          sourceType: "web",
          sourceName: "issuer flow table",
          url: "https://example.com/btc-etf-flow-table",
          title: "Issuer flow tables show broad net inflows",
          excerpt:
            "Multiple issuer flow tables point to net accumulation rather than single-fund concentration.",
          engagement: 0,
          observedAt: new Date("2026-07-26T23:30:00.000Z"),
        },
      ],
    });

    await prisma.investmentThesis.create({
      data: {
        assetId: btcAssetId,
        researchRunId: seedThesisRun.id,
        source: "seed-research",
        stance: "accumulate",
        conviction: 78,
        thesis:
          "BTC remains a constructive core allocation while ETF demand absorbs available float; size positions conservatively around CPI and FOMC events.",
        bullCase:
          "Sustained ETF inflows, falling exchange balances, and improved liquidity can push BTC above recent resistance.",
        bearCase:
          "A hot inflation print or liquidity shock can unwind leverage and pull BTC back toward support.",
        actionItems: ["Keep core exposure", "Add on pullbacks", "Avoid leverage into CPI"],
      },
    });

    await prisma.forecastPoint.createMany({
      data: [
        {
          assetId: btcAssetId,
          researchRunId: kronosRun.id,
          horizon: "7d",
          targetPrice: 70400,
          lowerBound: 66000,
          upperBound: 72800,
          confidence: 61,
          model: "kronos-small",
          generatedAt: new Date("2026-07-27T01:05:50.000Z"),
        },
        {
          assetId: btcAssetId,
          researchRunId: kronosRun.id,
          horizon: "30d",
          targetPrice: 73500,
          lowerBound: 61200,
          upperBound: 78800,
          confidence: 54,
          model: "kronos-small",
          generatedAt: new Date("2026-07-27T01:05:50.000Z"),
        },
      ],
    });

    await prisma.modelEvaluation.create({
      data: {
        assetId: btcAssetId,
        model: "kronos-small",
        task: "directional_forecast",
        windowStart: new Date("2026-05-15T00:00:00.000Z"),
        windowEnd: new Date("2026-07-26T00:00:00.000Z"),
        metrics: { hitRate: 0.57, maePct: 4.8, sampleSize: 30 },
      },
    });
  }

  if (vn30AssetId) {
    await prisma.investmentThesis.create({
      data: {
        assetId: vn30AssetId,
        source: "seed-research",
        stance: "hold",
        conviction: 64,
        thesis:
          "VN30 exposure is supported by banking earnings recovery, but liquidity and policy timing argue for measured adds only on pullbacks.",
        bullCase: "Credit growth and stable NIM can drive earnings revisions higher.",
        bearCase: "Foreign outflows or weak macro prints can cap index multiple expansion.",
        actionItems: ["Hold core VN30", "Prefer bank leaders", "Wait for pullbacks below 1,310"],
      },
    });
  }

  if (goldAssetId) {
    await prisma.investmentThesis.create({
      data: {
        assetId: goldAssetId,
        source: "seed-research",
        stance: "hold",
        conviction: 69,
        thesis:
          "Gold remains a useful hedge while central bank demand offsets periods of dollar strength.",
        bullCase: "Central bank accumulation and geopolitical hedging can keep a bid under gold.",
        bearCase: "A real-yield spike can pressure non-yielding assets.",
        actionItems: ["Keep hedge allocation", "Rebalance after sharp rallies"],
      },
    });
  }

  await prisma.economicEvent.createMany({
    data: eventSeed.map((event) => ({
      ...event,
      sourceCode: "seed",
      sourceEventKey: `seed:${event.country}:${event.event}:${event.eventAt}`,
      currency: event.country === "US" ? "USD" : event.country === "EU" ? "EUR" : "VND",
      eventDate: new Date(event.eventAt.slice(0, 10)),
      eventAt: new Date(event.eventAt),
      timeStatus: "timed",
      sourceTimezone: "UTC",
      observedAt: new Date(event.eventAt),
      qualityStatus: "sample",
    })),
  });

  await prisma.quantRun.create({
    data: {
      organizationId: organization.id,
      userId: user.id,
      strategyName: "Seed Momentum Backtest",
      status: "succeeded",
      parameters: { assets: ["BTC", "FPT"], from: "2026-05-15", to: "2026-06-13" },
      metrics: { totalReturn: 12.4, sharpe: 1.38, maxDrawdown: -6.2 },
      startedAt: new Date("2026-06-13T05:00:00.000Z"),
      finishedAt: new Date("2026-06-13T05:00:10.000Z"),
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
