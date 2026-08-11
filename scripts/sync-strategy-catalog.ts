import type { Prisma } from "@prisma/client";

import { getPrisma } from "../src/lib/db/prisma";
import {
  syncStrategyCatalog,
  type StrategyCatalogRepository,
  type StrategyVersionRecord,
} from "../src/lib/backtest/strategy-catalog";

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function toCreateData(record: StrategyVersionRecord): Prisma.StrategyVersionCreateInput {
  return {
    code: String(record.code),
    version: String(record.version),
    name: String(record.name),
    category: String(record.category),
    status: String(record.status),
    parameterSchema: asJson(record.parameterSchema),
    defaultParameters: asJson(record.defaultParameters),
    supportedMarkets: asJson(record.supportedMarkets),
    supportedTimeframes: asJson(record.supportedTimeframes),
    implementationHash: String(record.implementationHash),
    sourceAttribution: record.sourceAttribution == null ? null : String(record.sourceAttribution),
    modificationNotice:
      record.modificationNotice == null ? null : String(record.modificationNotice),
  };
}

async function main() {
  const prisma = getPrisma();
  const repository: StrategyCatalogRepository = {
    findByCodeVersion: ({ code, version }) =>
      prisma.strategyVersion.findUnique({ where: { code_version: { code, version } } }),
    create: (record) => prisma.strategyVersion.create({ data: toCreateData(record) }),
  };

  try {
    const synced = await syncStrategyCatalog(repository);
    console.log(`Synchronized ${synced.length} strategy versions.`);
    for (const record of synced) {
      console.log(`- ${String(record.code)}@${String(record.version)}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
