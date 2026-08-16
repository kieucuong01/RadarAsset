import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { listStrategyCatalog } from "@/lib/backtest/strategy-catalog";

const repoRoot = process.cwd();

function source(path: string) {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("daily-only timeframe scope", () => {
  it("publishes only 1d as a user-facing strategy timeframe", () => {
    const strategies = listStrategyCatalog();
    expect(strategies).not.toHaveLength(0);
    expect(strategies.every((strategy) => strategy.supportedTimeframes.join(",") === "1d")).toBe(
      true,
    );
  });

  it("does not expose 1h in TypeScript UI/API boundaries", () => {
    const checkedFiles = [
      "src/app/api/market/ingestion-requests/route.ts",
      "src/app/api/watchlist/route.ts",
      "src/components/portfolio-backtest-builder/PortfolioSetupPanel.tsx",
      "src/components/portfolio-optimizer/OptimizerConfigurationPanel.tsx",
      "src/components/FavoriteAssetDialog.tsx",
      "src/lib/backtest/client.ts",
      "src/lib/backtest/contracts.ts",
      "src/lib/backtest/data-readiness-client.ts",
      "src/lib/backtest/optimizer-client.ts",
      "src/lib/backend/market-repository.ts",
      "src/lib/backend/provider-catalog.ts",
      "src/lib/backend/quant-assets.ts",
      "src/lib/backend/quant-optimizer.ts",
      "src/lib/backend/types.ts",
      "src/lib/watchlist-client.ts",
    ];

    for (const file of checkedFiles) {
      const content = source(file);
      expect(content, file).not.toContain('"1h"');
      expect(content, file).not.toContain("four-hourly");
      expect(content, file).not.toContain("observed_4h");
      expect(content, file).not.toContain('"hourly" | "daily"');
      expect(content, file).not.toContain('z.enum(["hourly"');
    }
  });
});
