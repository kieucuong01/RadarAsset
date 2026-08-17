import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/provider";

import { BacktestResultsEmpty } from "./BacktestResultsEmpty";

describe("BacktestResultsEmpty", () => {
  it("renders a run prompt without fabricated performance or trades", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <BacktestResultsEmpty />
      </I18nProvider>,
    );

    expect(html).toContain("Danh mục đang chạy");
    expect(html).toContain("Chạy kiểm định danh mục");
    expect(html).toContain("Đường vốn &amp; sụt giảm");
    expect(html).toContain("Danh sách lệnh");
    expect(html).not.toMatch(/\+\d|Sharpe\s+\d|BTC.*PnL/);
  });
});
