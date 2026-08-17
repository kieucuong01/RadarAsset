import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PortfolioChangeDigest } from "./PortfolioChangeDigest";

describe("PortfolioChangeDigest", () => {
  it("renders a bounded numeric portfolio change and analysis affordance", () => {
    const html = renderToStaticMarkup(
      <PortfolioChangeDigest
        changes={[
          {
            symbol: "BTC",
            assetName: "Bitcoin",
            changeType: "stance_action",
            previousStance: "NEUTRAL",
            currentStance: "CONSTRUCTIVE",
            previousAction: "HOLD",
            currentAction: "REVIEW_INCREASE",
            scoreDelta: "18",
            portfolioWeightPct: "25",
            reason: {
              metricCode: "crypto.etf.net_flow_usd",
              rawValue: "120",
              unit: "USD_MILLION",
              contribution: "15",
            },
          },
        ]}
        status="ready"
        locale="vi"
        onSelect={() => undefined}
      />,
    );

    expect(html).toContain("Thay đổi quan trọng với danh mục");
    expect(html).toContain("Trung tính → Có cơ sở tăng");
    expect(html).toContain("25%");
    expect(html).toContain("120 triệu USD");
    expect(html).toContain("Mở phân tích chi tiết");
  });

  it("explains the accumulating comparison state", () => {
    const html = renderToStaticMarkup(
      <PortfolioChangeDigest
        changes={[]}
        status="accumulating"
        locale="vi"
        onSelect={() => undefined}
      />,
    );

    expect(html).toContain("Cần thêm một bản tin hằng ngày");
  });
});
