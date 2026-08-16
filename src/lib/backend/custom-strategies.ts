import type { Prisma } from "@prisma/client";

import type { TenantContext } from "@/lib/auth/tenant-context";
import {
  createCustomStrategySchema,
  createCustomStrategyVersionSchema,
  nextSemanticVersion,
  normalizeExecutableRule,
  type CreateCustomStrategyInput,
  type ExecutableRule,
} from "@/lib/custom-strategies/contracts";
import { implementationHash } from "@/lib/custom-strategies/hash";
import { getPrisma } from "@/lib/db/prisma";

export type CustomStrategyVersionSummary = {
  id: string;
  version: string;
  kind: ExecutableRule["kind"];
  rule: ExecutableRule;
  implementationHash: string;
  status: "active" | "retired";
  executionCode: string | null;
  createdAt: string;
};

export type CustomStrategySummary = {
  id: string;
  name: string;
  description: string | null;
  family: "technical" | "systematic";
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
  versions: CustomStrategyVersionSummary[];
};

export type TenantStrategyCatalogItem = {
  code: string;
  version: string;
  name: string;
  category: string;
  status: "active";
  parameterSchema: [];
  defaultParameters: Record<string, unknown>;
  supportedMarkets: string[];
  supportedTimeframes: Array<"1d">;
  implementationHash: string;
  sourceAttribution: null;
  modificationNotice: null;
  origin: "custom";
};

type CustomStrategyRecord = {
  id: string;
  name: string;
  description: string | null;
  family: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  versions: Array<{
    id: string;
    version: string;
    kind: string;
    ruleDefinition: unknown;
    implementationHash: string;
    status: string;
    createdAt: Date;
    executionVersion: { code: string; version: string } | null;
  }>;
};

function familyForRule(rule: ExecutableRule): "technical" | "systematic" {
  return rule.kind === "scheduled_dca" ? "systematic" : "technical";
}

function customStrategySummary(record: CustomStrategyRecord): CustomStrategySummary {
  if (record.family !== "technical" && record.family !== "systematic") {
    throw new Error("Custom strategy family is invalid.");
  }
  if (record.status !== "active" && record.status !== "archived") {
    throw new Error("Custom strategy status is invalid.");
  }
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    family: record.family,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    versions: record.versions.map((version) => {
      if (version.status !== "active" && version.status !== "retired") {
        throw new Error("Custom strategy version status is invalid.");
      }
      return {
        id: version.id,
        version: version.version,
        kind: normalizeExecutableRule(version.ruleDefinition).kind,
        rule: normalizeExecutableRule(version.ruleDefinition),
        implementationHash: version.implementationHash,
        status: version.status,
        executionCode: version.executionVersion?.code ?? null,
        createdAt: version.createdAt.toISOString(),
      };
    }),
  };
}

const strategyInclude = {
  versions: {
    orderBy: { createdAt: "desc" as const },
    include: { executionVersion: { select: { code: true, version: true } } },
  },
} satisfies Prisma.CustomStrategyInclude;

async function loadCustomStrategy(
  context: TenantContext,
  id: string,
  client = getPrisma(),
): Promise<CustomStrategySummary> {
  const strategy = await client.customStrategy.findFirst({
    where: { id, organizationId: context.organizationId },
    include: strategyInclude,
  });
  if (!strategy) throw new Error("Custom strategy not found.");
  return customStrategySummary(strategy);
}

async function createImmutableVersion(
  client: Pick<ReturnType<typeof getPrisma>, "customStrategyVersion" | "strategyVersion">,
  input: {
    customStrategyId: string;
    organizationId: string;
    name: string;
    previousVersion: string | null;
    rule: ExecutableRule;
  },
) {
  const version = nextSemanticVersion(input.previousVersion);
  const hash = implementationHash(input.rule);
  const customVersion = await client.customStrategyVersion.create({
    data: {
      customStrategyId: input.customStrategyId,
      version,
      kind: input.rule.kind,
      ruleDefinition: input.rule as Prisma.InputJsonValue,
      implementationHash: hash,
      status: "active",
    },
  });
  await client.strategyVersion.create({
    data: {
      code: `custom:${customVersion.id}`,
      version: customVersion.version,
      name: input.name,
      category: "custom_rule",
      organizationId: input.organizationId,
      customStrategyVersionId: customVersion.id,
      parameterSchema: [],
      defaultParameters: input.rule as Prisma.InputJsonValue,
      supportedMarkets: ["vn_equity", "crypto_spot", "metal_spot"],
      supportedTimeframes: ["1d"],
      implementationHash: hash,
      status: "active",
    },
  });
  return customVersion;
}

async function lockCustomStrategy(client: Prisma.TransactionClient, key: string) {
  await client.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))
  `;
}

export async function createCustomStrategy(context: TenantContext, input: unknown) {
  const normalized = createCustomStrategySchema.parse(input);
  const hash = implementationHash(normalized.rule);
  const strategyId = await getPrisma().$transaction(async (tx) => {
    await lockCustomStrategy(
      tx,
      `custom-strategy:${context.organizationId}:${normalized.name.toLocaleLowerCase()}:${hash}`,
    );
    const existing = await tx.customStrategy.findFirst({
      where: {
        organizationId: context.organizationId,
        status: "active",
        name: { equals: normalized.name, mode: "insensitive" },
        versions: { some: { implementationHash: hash } },
      },
      select: { id: true },
    });
    if (existing) return existing.id;
    const strategy = await tx.customStrategy.create({
      data: {
        organizationId: context.organizationId,
        createdByUserId: context.userId,
        name: normalized.name,
        description: normalized.description ?? null,
        family: familyForRule(normalized.rule),
        status: "active",
      },
    });
    await createImmutableVersion(tx, {
      customStrategyId: strategy.id,
      organizationId: context.organizationId,
      name: normalized.name,
      previousVersion: null,
      rule: normalized.rule,
    });
    return strategy.id;
  });
  return loadCustomStrategy(context, strategyId);
}

export async function createCustomStrategyVersion(
  context: TenantContext,
  id: string,
  input: unknown,
) {
  const payload = zVersionPayload(input);
  const hash = implementationHash(payload.rule);
  const strategyId = await getPrisma().$transaction(async (tx) => {
    await lockCustomStrategy(tx, `custom-strategy-version:${context.organizationId}:${id}`);
    const strategy = await tx.customStrategy.findFirst({
      where: { id, organizationId: context.organizationId, status: "active" },
      select: {
        id: true,
        name: true,
        versions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { version: true, implementationHash: true },
        },
      },
    });
    if (!strategy) throw new Error("Custom strategy not found.");
    if (strategy.versions[0]?.implementationHash === hash) return strategy.id;
    await createImmutableVersion(tx, {
      customStrategyId: strategy.id,
      organizationId: context.organizationId,
      name: strategy.name,
      previousVersion: strategy.versions[0]?.version ?? null,
      rule: payload.rule,
    });
    return strategy.id;
  });
  return loadCustomStrategy(context, strategyId);
}

function zVersionPayload(input: unknown): { rule: ExecutableRule } {
  return createCustomStrategyVersionSchema.parse(input);
}

export async function listCustomStrategies(context: TenantContext) {
  const strategies = await getPrisma().customStrategy.findMany({
    where: { organizationId: context.organizationId },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: strategyInclude,
  });
  return strategies.map(customStrategySummary);
}

export async function listTenantCustomStrategyCatalog(
  context: TenantContext,
): Promise<TenantStrategyCatalogItem[]> {
  const versions = await getPrisma().strategyVersion.findMany({
    where: {
      organizationId: context.organizationId,
      status: "active",
      customStrategyVersion: { customStrategy: { status: "active" } },
    },
    orderBy: [{ name: "asc" }, { version: "desc" }],
    select: {
      code: true,
      version: true,
      name: true,
      category: true,
      status: true,
      parameterSchema: true,
      defaultParameters: true,
      supportedMarkets: true,
      supportedTimeframes: true,
      implementationHash: true,
    },
  });

  return versions.map((version) => {
    const defaultParameters = normalizeExecutableRule(version.defaultParameters);
    const supportedTimeframes = stringArray(version.supportedTimeframes).filter(
      (timeframe): timeframe is "1d" => timeframe === "1d",
    );
    if (version.status !== "active" || !Array.isArray(version.parameterSchema)) {
      throw new Error("Custom strategy execution registry is invalid.");
    }
    return {
      code: version.code,
      version: version.version,
      name: version.name,
      category: version.category,
      status: "active",
      parameterSchema: [],
      defaultParameters,
      supportedMarkets: stringArray(version.supportedMarkets),
      supportedTimeframes,
      implementationHash: version.implementationHash,
      sourceAttribution: null,
      modificationNotice: null,
      origin: "custom",
    };
  });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export async function archiveCustomStrategy(context: TenantContext, id: string) {
  const existing = await getPrisma().customStrategy.findFirst({
    where: { id, organizationId: context.organizationId },
    select: { id: true },
  });
  if (!existing) throw new Error("Custom strategy not found.");
  await getPrisma().customStrategy.update({ where: { id }, data: { status: "archived" } });
  return loadCustomStrategy(context, id);
}

export type { CreateCustomStrategyInput };
