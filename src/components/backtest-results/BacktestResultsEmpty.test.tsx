import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BacktestResultsEmpty } from "./BacktestResultsEmpty";

describe("BacktestResultsEmpty", () => {
  it("renders a run prompt without fabricated performance or trades", () => {
    const html = renderToStaticMarkup(<BacktestResultsEmpty />);

    expect(html).toContain("Active Portfolio");
    expect(html).toContain("Run a portfolio backtest");
    expect(html).toContain("Equity Curve &amp; Drawdown");
    expect(html).toContain("Trade List");
    expect(html).not.toMatch(/\+\d|Sharpe\s+\d|BTC.*PnL/);
  });
});
