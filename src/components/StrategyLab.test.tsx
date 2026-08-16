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
    expect(html).toContain("Tìm chiến lược");
    expect(html).toContain("Nhóm phân tích");
    expect(html).toContain("Phân tích cơ bản");
    expect(html).toContain("Chiến lược hệ thống");
    expect(html).toContain("MA Crossover");
    expect(html).not.toContain("trình duyệt này");
  });
});
