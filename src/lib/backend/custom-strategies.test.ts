import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => {
  const tx = {
    customStrategy: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    customStrategyVersion: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    strategyVersion: { create: vi.fn() },
    $executeRaw: vi.fn(),
  };
  return { prisma: { ...tx, $transaction: vi.fn() } };
});

vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => prisma }));

import {
  archiveCustomStrategy,
  createCustomStrategy,
  createCustomStrategyVersion,
  listCustomStrategies,
} from "./custom-strategies";
import { implementationHash } from "@/lib/custom-strategies/hash";

const context = { organizationId: "organization-a", userId: "user-a", role: "editor" as const };
const priceRule = {
  schemaVersion: 1,
  kind: "price_threshold" as const,
  operator: "crosses_above" as const,
  threshold: 50_000,
  currency: "USD" as const,
  action: "buy" as const,
  sizePct: 25,
};

describe("tenant custom strategy persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
      callback(prisma),
    );
    prisma.customStrategy.create.mockResolvedValue({ id: "strategy-a" });
    prisma.customStrategyVersion.create.mockResolvedValue({ id: "version-a", version: "1.0.0" });
    prisma.strategyVersion.create.mockResolvedValue({ id: "execution-a" });
    prisma.customStrategy.findFirst.mockResolvedValue({
      id: "strategy-a",
      organizationId: "organization-a",
      name: "BTC entry",
      description: null,
      family: "technical",
      status: "active",
      createdAt: new Date("2026-08-12T00:00:00.000Z"),
      updatedAt: new Date("2026-08-12T00:00:00.000Z"),
      versions: [
        {
          id: "version-a",
          version: "1.0.0",
          kind: "price_threshold",
          ruleDefinition: priceRule,
          implementationHash: "a".repeat(64),
          status: "active",
          createdAt: new Date("2026-08-12T00:00:00.000Z"),
          executionVersion: { code: "custom:version-a", version: "1.0.0" },
        },
      ],
    });
    prisma.customStrategy.findMany.mockResolvedValue([]);
  });

  it("creates a strategy, immutable rule version, and tenant execution registry atomically", async () => {
    prisma.customStrategy.findFirst.mockResolvedValueOnce(null);
    await createCustomStrategy(context, { name: "BTC entry", rule: priceRule });

    expect(prisma.customStrategy.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "organization-a",
        createdByUserId: "user-a",
        name: "BTC entry",
        family: "technical",
      }),
    });
    expect(prisma.customStrategyVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customStrategyId: "strategy-a",
        version: "1.0.0",
        kind: "price_threshold",
        ruleDefinition: priceRule,
      }),
    });
    expect(prisma.strategyVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: "custom:version-a",
        organizationId: "organization-a",
        customStrategyVersionId: "version-a",
        category: "custom_rule",
        defaultParameters: priceRule,
      }),
    });
  });

  it("reuses an identical tenant strategy submitted twice", async () => {
    prisma.customStrategy.findFirst.mockResolvedValueOnce({ id: "strategy-a" });

    await createCustomStrategy(context, { name: "BTC entry", rule: priceRule });

    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.customStrategy.create).not.toHaveBeenCalled();
    expect(prisma.customStrategyVersion.create).not.toHaveBeenCalled();
  });

  it("reuses the latest immutable version when its rule hash is unchanged", async () => {
    prisma.customStrategy.findFirst.mockResolvedValueOnce({
      id: "strategy-a",
      name: "BTC entry",
      versions: [{ version: "1.0.0", implementationHash: implementationHash(priceRule) }],
    });

    await createCustomStrategyVersion(context, "strategy-a", { rule: priceRule });

    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.customStrategyVersion.create).not.toHaveBeenCalled();
  });

  it("does not expose another organization's strategy for versioning", async () => {
    prisma.customStrategy.findFirst.mockResolvedValueOnce(null);

    await expect(
      createCustomStrategyVersion(context, "strategy-b", { rule: priceRule }),
    ).rejects.toThrow("Custom strategy not found.");
    expect(prisma.customStrategyVersion.create).not.toHaveBeenCalled();
  });

  it("returns only strategies belonging to the active organization", async () => {
    await listCustomStrategies(context);

    expect(prisma.customStrategy.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "organization-a" },
        take: 100,
      }),
    );
  });

  it("archives only a strategy owned by the active organization", async () => {
    prisma.customStrategy.update.mockResolvedValue({ id: "strategy-a" });

    await archiveCustomStrategy(context, "strategy-a");

    expect(prisma.customStrategy.update).toHaveBeenCalledWith({
      where: { id: "strategy-a" },
      data: { status: "archived" },
    });
  });
});
