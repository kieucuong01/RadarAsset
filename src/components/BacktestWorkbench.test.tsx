import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BacktestWorkbench } from "./BacktestWorkbench";

describe("BacktestWorkbench", () => {
  it("renders the original-style backtest shell with configuration and output regions", () => {
    const html = renderToStaticMarkup(<BacktestWorkbench />);

    expect(html).toContain('aria-label="Backtest configuration"');
    expect(html).toContain('aria-label="Backtest output"');
    expect(html).toContain("Active Portfolio");
    expect(html).toContain("Equity Curve &amp; Drawdown");
    expect(html).toContain("Trade List");
    expect(html).toContain("Run Portfolio Backtest");
  });
});
