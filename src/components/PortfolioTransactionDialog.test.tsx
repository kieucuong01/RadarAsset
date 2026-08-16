import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ useStateCall: 0 }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const values = [true, false, null, null, null, "buy", "BTC", "2", "100", "0"];
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const call = state.useStateCall++;
      const resolved = typeof initial === "function" ? (initial as () => T)() : initial;
      return [call < values.length ? (values[call] as T) : resolved, vi.fn()] as const;
    },
  };
});

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/lib/i18n/context", () => ({
  useI18n: () => ({ locale: "vi" as const, t: (key: string) => key }),
}));

vi.mock("@/components/ui/dialog", () => {
  const Container = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Container,
    DialogContent: Container,
    DialogDescription: Container,
    DialogFooter: Container,
    DialogHeader: Container,
    DialogTitle: Container,
  };
});

import { PortfolioTransactionDialog } from "./PortfolioTransactionDialog";

describe("PortfolioTransactionDialog", () => {
  beforeEach(() => {
    state.useStateCall = 0;
  });

  it("keeps the holding currency in a preview when it differs from the portfolio base", () => {
    const html = renderToStaticMarkup(
      <PortfolioTransactionDialog
        holdings={[
          {
            assetId: "asset-btc",
            ticker: "BTC",
            name: "Bitcoin",
            qty: 1,
            price: 100,
            cost: 90,
            value: 100,
            pnl: 10,
            pnlPct: 11.11,
            alloc: 100,
            sentiment: "Bullish",
            category: "Crypto",
            currency: "USDT",
          },
        ]}
        disabled={false}
        timeframe="1M"
        onRecorded={() => undefined}
        portfolioCurrency="VND"
      />,
    );

    expect(html).toContain("common.fee (USDT)");
    expect(html).toContain("200 USDT");
    expect(html).not.toContain("200 VND");
  });
});
