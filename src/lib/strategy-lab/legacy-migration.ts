import type { CreateCustomStrategyInput } from "@/lib/custom-strategies/contracts";
import {
  parseStoredCustomStrategies,
  serializeCustomStrategies,
} from "@/lib/strategy-lab/custom-strategy";

const LEGACY_KEY = "radarasset.strategy-lab.v1";
const MARKER_KEY = "radarasset.strategy-lab.db-migration.v1";

type StorageAdapter = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export async function migrateLegacyStrategies(
  storage: StorageAdapter,
  create: (input: CreateCustomStrategyInput) => Promise<unknown>,
) {
  if (storage.getItem(MARKER_KEY) === "complete") {
    return { imported: 0, skipped: 0, failed: 0 };
  }
  const strategies = parseStoredCustomStrategies(storage.getItem(LEGACY_KEY));
  const unsupported = strategies
    .filter((strategy) => strategy.kind === "fundamental_threshold")
    .map(({ readiness: _readiness, ...strategy }) => strategy);
  const executable = strategies.flatMap((strategy): CreateCustomStrategyInput[] => {
    if (strategy.kind === "scheduled_dca") {
      return [
        {
          name: strategy.name,
          description: strategy.symbol,
          rule: {
            schemaVersion: 1,
            kind: "scheduled_dca",
            contributionAmount: strategy.amount,
            currency: strategy.currency,
            frequency: "monthly",
            dayOfMonth: strategy.dayOfMonth,
          },
        },
      ];
    }
    if (strategy.kind === "price_threshold") {
      return [
        {
          name: strategy.name,
          description: strategy.symbol,
          rule: {
            schemaVersion: 1,
            kind: "price_threshold",
            operator: strategy.operator,
            threshold: strategy.value,
            currency: strategy.currency,
            action: strategy.action,
            sizePct: strategy.sizePct,
          },
        },
      ];
    }
    return [];
  });
  const skipped = strategies.length - executable.length;
  let imported = 0;
  for (const input of executable) {
    try {
      await create(input);
      imported += 1;
    } catch {
      return { imported, skipped, failed: 1 };
    }
  }
  if (unsupported.length > 0) {
    storage.setItem(LEGACY_KEY, serializeCustomStrategies(unsupported));
  } else {
    storage.removeItem(LEGACY_KEY);
  }
  storage.setItem(MARKER_KEY, "complete");
  return { imported, skipped, failed: 0 };
}
