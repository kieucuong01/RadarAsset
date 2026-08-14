import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) =>
  readFileSync(join(process.cwd(), "src", "components", "smart-insights", name), "utf8");

describe("Macro Quant Pulse tabs", () => {
  it("preserves the existing regime content and adds accessible event and energy tabs", () => {
    const source = read("MacroQuantPulseTabs.tsx");
    expect(source).toContain('defaultValue="regime"');
    for (const value of ["regime", "events", "energy"])
      expect(source).toContain(`value="${value}"`);
    expect(source).toContain("{regimeContent}");
    expect(source).toContain("TabsTrigger");
  });

  it("uses chart-first panels with explicit units, as-of, methodology and no sample fallback", () => {
    const events = read("EventRiskPanel.tsx");
    const energy = read("EnergyPulsePanel.tsx");
    for (const source of [events, energy]) {
      expect(source).toContain("ResponsiveContainer");
      expect(source).toContain("isAnimationActive={false}");
      expect(source).toContain("methodology");
      expect(source).toContain("asOf");
      expect(source).not.toContain("Dữ liệu mẫu");
      expect(source).not.toContain("SAMPLE");
    }
    expect(events.match(/<article/g)?.length ?? 0).toBeLessThanOrEqual(4);
    expect(energy.match(/<article/g)?.length ?? 0).toBeLessThanOrEqual(4);
  });

  it("provides compact mobile evidence rows and does not fetch inside presentation panels", () => {
    const source = read("EventRiskPanel.tsx") + read("EnergyPulsePanel.tsx");
    expect(source).toContain("md:hidden");
    expect(source).toMatch(/hidden[^\"]*md:block/);
    expect(source).not.toContain("fetch(");
  });
});
