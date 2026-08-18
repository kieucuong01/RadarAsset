import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OptimizerProposal } from "@/lib/backtest/optimizer-client";
import { I18nProvider } from "@/lib/i18n/provider";

const state = vi.hoisted(() => ({
  proposalInjected: false,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const resolved = typeof initial === "function" ? (initial as () => T)() : initial;
      if (resolved === "risk_parity") {
        return actual.useState("risk_tolerance" as T);
      }
      if (resolved === 1) {
        return actual.useState(1.234567 as T);
      }
      if (resolved === null && !state.proposalInjected) {
        state.proposalInjected = true;
        return actual.useState(proposal as T);
      }
      return actual.useState(initial);
    },
  };
});

vi.mock("recharts", () => {
  const Container = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Axis = ({
    tickFormatter,
    unit,
  }: {
    tickFormatter?: (value: number) => string;
    unit?: string;
  }) => <span data-axis>{`${tickFormatter?.(5) ?? 5}${unit ?? ""}`}</span>;
  return {
    CartesianGrid: Container,
    Cell: Container,
    LabelList: Container,
    Pie: Container,
    PieChart: Container,
    ResponsiveContainer: Container,
    Scatter: Container,
    ScatterChart: Container,
    Tooltip: Container,
    XAxis: Axis,
    YAxis: Axis,
    ZAxis: Container,
  };
});

const proposal = {
  method: "risk_tolerance",
  source: {
    library: "PyPortfolioOpt",
    version: "1.5.6",
    repository: "https://github.com/robertmartin8/PyPortfolioOpt",
    directory: "quant-worker",
    license: "MIT",
  },
  weightsBps: { BTC: 10_000 },
  totalWeightBps: 10_000,
  expectedReturnPct: 8,
  volatilityPct: 20,
  sharpe: 0.4,
  observationCount: 120,
  assetMetrics: [{ symbol: "BTC", expectedReturnPct: 8, volatilityPct: 20 }],
  correlationMatrix: [{ symbol: "BTC", correlations: { BTC: 1 } }],
  validation: {
    split: "chronological_70_30",
    trainObservationCount: 84,
    testObservationCount: 36,
    inSample: {
      expectedReturnPct: 8,
      volatilityPct: 20,
      sharpe: 0.4,
      maxDrawdownPct: -10,
    },
    outOfSample: {
      expectedReturnPct: 7,
      volatilityPct: 21,
      sharpe: 0.3,
      maxDrawdownPct: -12,
    },
  },
  datasetVersionIds: { BTC: "dataset-btc" },
  warnings: [],
} satisfies OptimizerProposal;

import { PortfolioOptimizerWorkbench } from "./PortfolioOptimizerWorkbench";

describe("PortfolioOptimizerWorkbench formatting", () => {
  beforeEach(() => {
    state.proposalInjected = false;
  });

  it("renders each risk-return axis tick with exactly one percent suffix", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <PortfolioOptimizerWorkbench />
      </I18nProvider>,
    );

    expect(html).not.toContain("5%%");
    expect(html.match(/data-axis="true">5%<\/span>/g) ?? []).toHaveLength(2);
    expect(html).toContain("Phân bổ tối ưu");
    expect(html).toContain("Phân bổ tài sản");
    expect(html).toContain("Rủi ro / Lợi nhuận — Lợi nhuận kỳ vọng và biến động");
    expect(html).toContain("Ma trận tương quan lịch sử");
    expect(html).toContain("Chi tiết phân bổ");
  });

  it("formats the visible Markowitz risk tolerance as a ratio", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <PortfolioOptimizerWorkbench />
      </I18nProvider>,
    );

    expect(html).toContain("Mức chịu rủi ro: 1.2346");
    expect(html).not.toContain("Mức chịu rủi ro: 1.234567");
  });

  it("starts with the default daily diversified portfolio window", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <PortfolioOptimizerWorkbench />
      </I18nProvider>,
    );

    expect(html).toContain('id="optimizer-from"');
    expect(html).toContain('value="2021-01-01"');
    expect(html).toContain('id="optimizer-to"');
    expect(html).toContain('value="2026-01-01"');
    expect(html).toContain("Chỉnh sửa danh mục");
    expect(html).toContain("VNINDEX");
    expect(html).toContain("XAU");
    expect(html).toContain("BTC");
  });
});
