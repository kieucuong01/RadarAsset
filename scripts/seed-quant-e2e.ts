import { createHash } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@prisma/client";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const parsed = new URL(databaseUrl);
const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname.toLowerCase())) {
  throw new Error("Quant E2E fixtures require a local PostgreSQL database.");
}
if (!databaseName.endsWith("_test")) {
  throw new Error("Quant E2E fixtures require a database ending in _test.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl, options: "-c timezone=UTC" }),
});
const sql = new pg.Pool({ connectionString: databaseUrl, options: "-c timezone=UTC" });
const providerCode = "quant-e2e-fixture";
const symbols = ["E2EVN", "E2EBTC", "E2EXAU"] as const;

function bars(base: number) {
  const start = new Date("2023-08-01T00:00:00.000Z");
  const end = new Date("2026-08-14T00:00:00.000Z");
  const rows = [];
  let index = 0;
  for (let ts = start.getTime(); ts <= end.getTime(); ts += 86_400_000) {
    const trend = base * (1 + index * 0.0002);
    const close = trend * (1 + Math.sin(index / 12) * 0.08);
    rows.push({
      ts: new Date(ts),
      open: close * 0.997,
      high: close * 1.012,
      low: close * 0.988,
      close,
      volume: 10_000 + index * 10,
      source: "test_fixture",
      qualityFlags: [] as Prisma.InputJsonValue,
    });
    index += 1;
  }
  return rows;
}

function normalizeDecimal(value: { toString(): string }) {
  const text = value.toString();
  if (!text.includes(".")) return text;
  return text.replace(/0+$/, "").replace(/\.$/, "");
}

function canonicalChecksum(
  symbol: string,
  rows: Array<{
    timestamp: string;
    open: { toString(): string };
    high: { toString(): string };
    low: { toString(): string };
    close: { toString(): string };
    volume: { toString(): string } | null;
    source: string;
  }>,
) {
  const payload = rows.map((row) => ({
    asset: symbol,
    timestamp: row.timestamp,
    timeframe: "1d",
    open: normalizeDecimal(row.open),
    high: normalizeDecimal(row.high),
    low: normalizeDecimal(row.low),
    close: normalizeDecimal(row.close),
    volume: row.volume ? normalizeDecimal(row.volume) : null,
    source: row.source,
  }));
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function seedAsset(input: {
  symbol: (typeof symbols)[number];
  name: string;
  market: string;
  venue: string;
  currency: string;
  base: number;
  providerId: string;
}) {
  const existing = await prisma.asset.findUnique({
    where: { symbol: input.symbol },
    select: { id: true },
  });
  if (existing) {
    await prisma.strategyAssignment.deleteMany({ where: { assetId: existing.id } });
    await prisma.quantRun.deleteMany({ where: { legs: { some: { assetId: existing.id } } } });
    await prisma.asset.delete({ where: { id: existing.id } });
  }
  const asset = await prisma.asset.create({
    data: {
      symbol: input.symbol,
      canonicalKey: `test_fixture:${input.symbol}`,
      name: input.name,
      assetClass: input.market === "vn_equity" ? "equity" : "spot",
      market: input.market,
      venue: input.venue,
      timezone: input.market === "vn_equity" ? "Asia/Ho_Chi_Minh" : "UTC",
      currency: input.currency,
      maxLeverage: input.market === "vn_equity" ? 2 : 1,
      provider: providerCode,
      providerSymbol: input.symbol,
      listingStatus: "active",
    },
  });
  const instrument = await prisma.providerInstrument.create({
    data: {
      providerId: input.providerId,
      assetId: asset.id,
      providerSymbol: input.symbol,
      metadata: { mode: "test_fixture" },
    },
  });
  await prisma.assetListingPeriod.create({
    data: {
      assetId: asset.id,
      providerInstrumentId: instrument.id,
      providerCode,
      providerSymbol: input.symbol,
      venue: input.venue,
      status: "active",
      validFrom: new Date("2023-08-01T00:00:00.000Z"),
      metadata: { mode: "test_fixture" },
    },
  });
  const dataset = await prisma.dataset.create({
    data: { assetId: asset.id, timeframe: "1d", adjustmentPolicy: "raw" },
  });
  const datasetBars = bars(input.base);
  const version = await prisma.datasetVersion.create({
    data: {
      datasetId: dataset.id,
      providerId: input.providerId,
      version: 1,
      checksum: "pending-test-fixture-checksum",
      coverageStart: datasetBars[0]!.ts,
      coverageEnd: datasetBars.at(-1)!.ts,
      rowCount: datasetBars.length,
      missingBarCount: 0,
      qualityStatus: "passed",
      qualitySummary: { mode: "test_fixture" },
      sourceMetadata: { mode: "test_fixture", calendarVersion: "test-fixture-v1" },
      isActive: true,
    },
  });
  await prisma.datasetBar.createMany({
    data: datasetBars.map((bar) => ({ ...bar, datasetVersionId: version.id })),
  });
  const persistedBars = await sql.query<{
    timestamp: string;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string | null;
    source: string;
  }>(
    `SELECT to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS timestamp,
            open::text, high::text, low::text, close::text, volume::text, source
       FROM dataset_bars WHERE dataset_version_id = $1 ORDER BY ts ASC`,
    [version.id],
  );
  await sql.query("UPDATE dataset_versions SET checksum = $1 WHERE id = $2", [
    canonicalChecksum(input.symbol, persistedBars.rows),
    version.id,
  ]);
}

try {
  const provider = await prisma.dataProvider.upsert({
    where: { code: providerCode },
    update: { name: "Quant E2E Fixture" },
    create: { code: providerCode, name: "Quant E2E Fixture" },
  });
  await Promise.all([
    seedAsset({
      symbol: "E2EVN",
      name: "E2E Vietnam Equity",
      market: "vn_equity",
      venue: "HOSE",
      currency: "VND",
      base: 100,
      providerId: provider.id,
    }),
    seedAsset({
      symbol: "E2EBTC",
      name: "E2E Bitcoin",
      market: "crypto_spot",
      venue: "BINANCE",
      currency: "USDT",
      base: 30_000,
      providerId: provider.id,
    }),
    seedAsset({
      symbol: "E2EXAU",
      name: "E2E Gold Spot",
      market: "metal_spot",
      venue: "OTC",
      currency: "USD",
      base: 1_900,
      providerId: provider.id,
    }),
  ]);
  await prisma.strategyVersion.upsert({
    where: { code_version: { code: "ma_crossover", version: "1.0.0" } },
    update: { status: "active" },
    create: {
      code: "ma_crossover",
      version: "1.0.0",
      name: "Moving Average Crossover",
      category: "rule_based",
      parameterSchema: {} as Prisma.InputJsonValue,
      defaultParameters: { fastPeriod: 10, slowPeriod: 30 },
      supportedMarkets: ["vn_equity", "crypto_spot", "metal_spot"],
      supportedTimeframes: ["1d"],
      implementationHash: "e".repeat(64),
    },
  });
  console.log(`Seeded ${symbols.join(", ")} into ${databaseName}.`);
} finally {
  await prisma.$disconnect();
  await sql.end();
}
