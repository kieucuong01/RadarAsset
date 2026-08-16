import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/provider";

import { StrategyLab } from "./StrategyLab";

describe("StrategyLab", () => {
  it("renders the DB-backed strategy workflow without browser-storage copy", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <StrategyLab onUsePreset={() => undefined} />
      </I18nProvider>,
    );

    expect(html).toContain("Thư viện chiến lược");
    expect(html).toContain("Thiết kế chiến lược");
    expect(html).toContain("Chiến lược của tôi (0)");
    expect(html).not.toContain("trình duyệt này");
  });

  it("passes the active UI locale into custom strategy descriptions", () => {
    const source = readFileSync(resolve("src/components/StrategyLab.tsx"), "utf8");

    expect(source).toContain("describeCustomStrategy(draft, locale)");
  });

  it("initializes a new draft lazily without synchronizing currency on locale changes", () => {
    const source = readFileSync(resolve("src/components/StrategyLab.tsx"), "utf8");

    expect(source).toContain(
      'createInitialStrategyBuilderState(t("strategyLab.defaultName"), locale)',
    );
    expect(source).not.toContain('currency: "USD"');
  });
});
