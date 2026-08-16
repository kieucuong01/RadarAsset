import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const COMPONENT_ROOT = resolve("src/components");
const STRATEGY_LAB_ROOT = resolve(COMPONENT_ROOT, "strategy-lab");

describe("Strategy Lab component boundaries", () => {
  it("keeps the workflow orchestrator small", () => {
    const source = readFileSync(resolve(COMPONENT_ROOT, "StrategyLab.tsx"), "utf8");
    expect(source.split(/\r?\n/).length).toBeLessThanOrEqual(420);
  });

  it.each(["StrategyLibraryPanel", "StrategyBuilderPanel", "SavedStrategiesPanel"])(
    "owns the %s panel in its domain module",
    (name) => {
      expect(existsSync(resolve(STRATEGY_LAB_ROOT, `${name}.tsx`))).toBe(true);
    },
  );

  it("keeps persistence and migration dependencies in the orchestrator", () => {
    const orchestrator = readFileSync(resolve(COMPONENT_ROOT, "StrategyLab.tsx"), "utf8");
    expect(orchestrator).toContain('from "@/lib/strategy-lab/client"');
    expect(orchestrator).toContain('from "@/lib/strategy-lab/legacy-migration"');

    for (const name of ["StrategyLibraryPanel", "StrategyBuilderPanel", "SavedStrategiesPanel"]) {
      const path = resolve(STRATEGY_LAB_ROOT, `${name}.tsx`);
      if (!existsSync(path)) continue;
      const source = readFileSync(path, "utf8");
      expect(source).not.toContain("@/lib/strategy-lab/legacy-migration");
      expect(source).not.toMatch(
        /\b(createCustomStrategy|createCustomStrategyVersion|archiveCustomStrategy|listCustomStrategies)\b/,
      );
    }
  });

  it("keeps library filters above tab content so switching tabs does not reset them", () => {
    const source = readFileSync(resolve(COMPONENT_ROOT, "StrategyLab.tsx"), "utf8");
    expect(source).toContain("const [libraryQuery, setLibraryQuery]");
    expect(source).toContain("const [libraryFamily, setLibraryFamily]");
  });
});
