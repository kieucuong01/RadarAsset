import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/provider";

import { OptimizerConfigurationPanel } from "./OptimizerConfigurationPanel";

describe("OptimizerConfigurationPanel asset editing", () => {
  it("shows inline guidance while the asset editor is open", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <OptimizerConfigurationPanel
          timeframe="1d"
          from="2021-01-01"
          to="2026-01-01"
          method="risk_parity"
          targetReturnPct={8}
          targetVolatilityPct={20}
          markowitzRiskTolerance={1}
          maxWeightPct={70}
          selectedSymbols={["VNINDEX", "XAU", "BTC"]}
          assets={[]}
          loading={false}
          editingAssets
          onTimeframeChange={vi.fn()}
          onFromChange={vi.fn()}
          onToChange={vi.fn()}
          onMethodChange={vi.fn()}
          onTargetReturnChange={vi.fn()}
          onTargetVolatilityChange={vi.fn()}
          onRiskToleranceChange={vi.fn()}
          onMaxWeightChange={vi.fn()}
          onEditAssets={vi.fn()}
          onAssetAdd={vi.fn()}
          onAssetRemove={vi.fn()}
          onOptimize={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(html).toContain("Cách chỉnh sửa danh mục");
    expect(html).toContain("Thêm hoặc xóa mã rồi bấm Tính phân bổ tối ưu");
    expect(html).toContain("VNINDEX");
    expect(html).toContain("XAU");
    expect(html).toContain("BTC");
  });
});
