import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/provider";
import { STRATEGY_CATALOG } from "@/lib/backtest/strategy-catalog";

import { StrategyLab } from "./StrategyLab";
import {
  StrategyBuilderPanel,
  type StrategyBuilderState,
} from "./strategy-lab/StrategyBuilderPanel";
import { StrategyLibraryPanel } from "./strategy-lab/StrategyLibraryPanel";
import { SavedStrategiesPanel } from "./strategy-lab/SavedStrategiesPanel";

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

  it("passes the active UI locale into custom strategy descriptions", () => {
    const source = readFileSync(
      resolve("src/components/strategy-lab/StrategyBuilderPanel.tsx"),
      "utf8",
    );

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

describe("StrategyLibraryPanel", () => {
  it("renders catalog education and filter controls", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <StrategyLibraryPanel
          query=""
          family="all"
          onQueryChange={() => undefined}
          onFamilyChange={() => undefined}
          onBuild={() => undefined}
          onCustomize={() => undefined}
          onUsePreset={() => undefined}
        />
      </I18nProvider>,
    );

    expect(html).toContain("Tìm chiến lược");
    expect(html).toContain("Nhóm phân tích");
    expect(html).toContain("Phân tích cơ bản");
    expect(html).toContain("Chiến lược hệ thống");
    expect(html).toContain("MA Crossover");
    expect(html).toContain("Logic mua / bán");
  });
});

describe("StrategyBuilderPanel", () => {
  it("renders the technical builder fields and normalized preview", () => {
    const strategy = STRATEGY_CATALOG[0];
    const builder: StrategyBuilderState = {
      name: "Chiến lược tùy chỉnh",
      symbol: "BTC",
      kind: "catalog_preset",
      strategyCode: strategy.code,
      strategyParameters: { ...strategy.defaultParameters },
      amount: 400,
      currency: "USD",
      dayOfMonth: 1,
      priceOperator: "crosses_below",
      priceValue: 50_000,
      action: "sell",
      sizePct: 100,
      metric: "pb",
      fundamentalOperator: "lt",
      fundamentalValue: 4,
    };
    const html = renderToStaticMarkup(
      <I18nProvider>
        <StrategyBuilderPanel
          builder={builder}
          setBuilder={() => undefined}
          selectedDefinition={strategy}
          saving={false}
          editing={false}
          onSelectCatalog={() => undefined}
          onSave={() => undefined}
        />
      </I18nProvider>,
    );

    expect(html).toContain("Tên chiến lược");
    expect(html).toContain("Mã tài sản");
    expect(html).toContain("Chỉ báo kỹ thuật");
    expect(html).toContain("MA Crossover");
    expect(html).toContain("Quy tắc đã chuẩn hóa");
    expect(html).toContain("Lưu chiến lược");
  });
});

describe("SavedStrategiesPanel", () => {
  const handlers = {
    onCreate: () => undefined,
    onArchive: () => undefined,
    onEdit: () => undefined,
    onUseBacktest: () => undefined,
  };

  it("renders loading and empty DB-backed states", () => {
    const loading = renderToStaticMarkup(
      <I18nProvider>
        <SavedStrategiesPanel strategies={[]} loading {...handlers} />
      </I18nProvider>,
    );
    const empty = renderToStaticMarkup(
      <I18nProvider>
        <SavedStrategiesPanel strategies={[]} loading={false} {...handlers} />
      </I18nProvider>,
    );

    expect(loading).toContain("Đang tải chiến lược từ không gian làm việc…");
    expect(empty).toContain("Chưa có chiến lược tự thiết kế");
  });

  it("renders an active persisted strategy", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <SavedStrategiesPanel
          strategies={[
            {
              id: "strategy-1",
              name: "DCA BTC",
              description: "BTC",
              family: "systematic",
              status: "active",
              createdAt: "2026-08-16T00:00:00.000Z",
              updatedAt: "2026-08-16T00:00:00.000Z",
              versions: [
                {
                  id: "version-1",
                  version: "1.0.0",
                  kind: "scheduled_dca",
                  rule: {
                    schemaVersion: 1,
                    kind: "scheduled_dca",
                    contributionAmount: 400,
                    currency: "USD",
                    frequency: "monthly",
                    dayOfMonth: 1,
                  },
                  implementationHash: "a".repeat(64),
                  status: "active",
                  executionCode: "custom:dca",
                  createdAt: "2026-08-16T00:00:00.000Z",
                },
              ],
            },
          ]}
          loading={false}
          {...handlers}
        />
      </I18nProvider>,
    );

    expect(html).toContain("DCA BTC");
    expect(html).toContain("Đã lưu theo tenant với lịch sử phiên bản bất biến.");
    expect(html).toContain("Sửa");
    expect(html).toContain("Xóa");
  });
});
