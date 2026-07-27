import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for Prisma seed.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const demoEmail = "demo@radarasset.local";

const assetSeed = [
  { symbol: "BTC", name: "Bitcoin", assetClass: "crypto", price: 67420, cost: 54200, qty: 0.85 },
  { symbol: "ETH", name: "Ethereum", assetClass: "crypto", price: 3512, cost: 2980, qty: 12.4 },
  { symbol: "SPY", name: "S&P 500 ETF", assetClass: "etf", price: 528.1, cost: 510.2, qty: 45 },
  { symbol: "QQQ", name: "Nasdaq 100 ETF", assetClass: "etf", price: 452.3, cost: 438.8, qty: 18 },
  {
    symbol: "NVDA",
    name: "NVIDIA Corp.",
    assetClass: "equity",
    price: 1142.5,
    cost: 720.3,
    qty: 28,
  },
  { symbol: "TSLA", name: "Tesla Inc.", assetClass: "equity", price: 178.4, cost: 220.1, qty: 22 },
  { symbol: "GOLD", name: "Gold Spot", assetClass: "commodity", price: 2402, cost: 2260, qty: 6 },
  { symbol: "VN30", name: "VN30 Index", assetClass: "index", price: 1328.2, cost: 1268, qty: 5 },
  { symbol: "USDC", name: "USD Cash", assetClass: "cash", price: 1, cost: 1, qty: 20000 },
] as const;

const insightSeed = [
  {
    source: "CryptoQuant",
    symbol: "BTC",
    sentiment: "bull",
    title: "BTC Spot ETF inflows hit 3-week high as whales reload positions",
    summary:
      "Accumulation addresses gained 18,400 BTC, historically a precursor to upward continuation.",
  },
  {
    source: "SSI Research",
    symbol: "VN30",
    sentiment: "bull",
    title: "VN30 banking sector projected to lead Q3 earnings rebound",
    summary:
      "Credit growth recovery and stable NIM support double-digit profit growth for top lenders.",
  },
  {
    source: "Bloomberg",
    symbol: "GOLD",
    sentiment: "bull",
    title: "Central banks add 38 tonnes of gold in May",
    summary: "PBoC and RBI lead inflows; gold breaks out of 6-week consolidation above $2,400.",
  },
  {
    source: "Reuters",
    symbol: null,
    sentiment: "bear",
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
    impact: "mid",
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
  await prisma.portfolioTransaction.deleteMany();
  await prisma.portfolioPosition.deleteMany();
  await prisma.marketBar.deleteMany();
  await prisma.watchlistItem.deleteMany();
  await prisma.aiInsight.deleteMany();
  await prisma.economicEvent.deleteMany();
  await prisma.quantRun.deleteMany();
  await prisma.portfolio.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.appUser.deleteMany({ where: { email: demoEmail } });

  const user = await prisma.appUser.create({
    data: {
      email: demoEmail,
      name: "Demo Investor",
    },
  });

  const assetBySymbol = new Map<string, { id: string }>();
  for (const [index, asset] of assetSeed.entries()) {
    const created = await prisma.asset.create({
      data: {
        symbol: asset.symbol,
        name: asset.name,
        assetClass: asset.assetClass,
        currency: "USD",
        provider: "seed",
        providerSymbol: asset.symbol,
        bars: {
          createMany: {
            data: generateBars(asset.price, index),
          },
        },
      },
      select: { id: true },
    });
    assetBySymbol.set(asset.symbol, created);
  }

  const portfolio = await prisma.portfolio.create({
    data: {
      userId: user.id,
      name: "Demo Multi-Asset Portfolio",
      baseCurrency: "USD",
    },
  });

  for (const asset of assetSeed) {
    const assetId = assetBySymbol.get(asset.symbol)?.id;
    if (!assetId || asset.qty <= 0) continue;
    const openingFee = asset.symbol === "USDC" ? 0 : Math.max(1, asset.cost * asset.qty * 0.0002);
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
    { symbol: "NVDA", alert: 1200 },
    { symbol: "TSLA", alert: 165 },
    { symbol: "GOLD", alert: 2450 },
    { symbol: "VN30", alert: 1350 },
  ]) {
    const assetId = assetBySymbol.get(item.symbol)?.id;
    if (!assetId) continue;
    await prisma.watchlistItem.create({
      data: {
        userId: user.id,
        assetId,
        alert: item.alert,
      },
    });
  }

  for (const insight of insightSeed) {
    await prisma.aiInsight.create({
      data: {
        assetId: insight.symbol ? assetBySymbol.get(insight.symbol)?.id : undefined,
        source: insight.source,
        sentiment: insight.sentiment,
        title: insight.title,
        summary: insight.summary,
        publishedAt: new Date("2026-06-13T04:00:00.000Z"),
      },
    });
  }

  await prisma.economicEvent.createMany({
    data: eventSeed.map((event) => ({
      ...event,
      eventAt: new Date(event.eventAt),
    })),
  });

  await prisma.quantRun.create({
    data: {
      userId: user.id,
      strategyName: "Seed Momentum Backtest",
      status: "succeeded",
      parameters: { assets: ["BTC", "SPY"], from: "2026-05-15", to: "2026-06-13" },
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
