import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/provider";

import { BacktestWorkbench } from "./BacktestWorkbench";

describe("BacktestWorkbench", () => {
  it("renders the original-style backtest shell with configuration and output regions", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <BacktestWorkbench />
      </I18nProvider>,
    );

    expect(html).toContain('aria-label="Cấu hình backtest"');
    expect(html).toContain('aria-label="Kết quả backtest"');
    expect(html).toContain("Danh mục đang chạy");
    expect(html).toContain("Equity Curve &amp; Drawdown");
    expect(html).toContain("Danh sách lệnh");
    expect(html).toContain("Run Portfolio Backtest");
  });
});
