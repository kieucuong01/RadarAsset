import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FactorLabRows } from "./FactorLab";

function textContent(html: string): string {
  return html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "");
}

describe("FactorLabRows financial formatting", () => {
  it("trims score and percent precision without duplicate units", () => {
    const text = textContent(
      renderToStaticMarkup(
        <table>
          <tbody>
            <FactorLabRows
              rows={[
                {
                  symbol: "VN30",
                  compositeScore: 87.50001,
                  momentumScore: 92.34567,
                  lowVolatilityScore: 71,
                  trendScore: 63.33333,
                  liquidityScore: 100,
                  momentum126dPct: 12.34567,
                  volatility63dPct: 20,
                },
              ]}
            />
          </tbody>
        </table>,
      ),
    );

    expect(text).toContain("VN3087.592.357163.3310012.35%20%");
    expect(text).not.toContain("87.50");
    expect(text).not.toContain("20.00%");
    expect(text).not.toContain("%%");
  });
});
