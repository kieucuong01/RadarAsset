import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const I18N_ROOT = join(process.cwd(), "src", "lib", "i18n");

describe("i18n module boundaries", () => {
  it("keeps the public dictionary module as a small composition layer", () => {
    const source = readFileSync(join(I18N_ROOT, "dictionary.ts"), "utf8");
    expect(source.split(/\r?\n/).length).toBeLessThanOrEqual(100);
  });

  it.each(["vi", "en"])("has all %s domain dictionaries", (locale) => {
    for (const domain of ["common", "portfolio", "quant", "smart-insights"]) {
      expect(existsSync(join(I18N_ROOT, "dictionaries", locale, `${domain}.ts`))).toBe(true);
    }
  });
});
