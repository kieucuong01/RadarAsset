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
    DialogTrigger: Container,
  };
});

import { PortfolioTransactionDialog } from "./PortfolioTransactionDialog";

describe("PortfolioTransactionDialog", () => {
  beforeEach(() => {
    state.useStateCall = 0;
  });

  it("normalizes a USDT holding to the supported USD transaction currency", () => {
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

    expect(html).toContain("common.fee (USD)");
    expect(html).toContain("200 USD");
    expect(html).not.toContain("200 VND");
  });

  it("supports one externally controlled dialog without rendering a duplicate trigger", () => {
    const html = renderToStaticMarkup(
      <PortfolioTransactionDialog
        open
        onOpenChange={() => undefined}
        trigger={null}
        holdings={[]}
        disabled={false}
        timeframe="1M"
        onRecorded={() => undefined}
        preset={{ side: "buy", symbol: "XAU", price: null }}
      />,
    );

    expect(html).toContain("transactionsDialog.title");
    expect(html).not.toContain("transactionsDialog.add");
    expect(html).not.toContain("transactionsDialog.reviewSignal");
  });
});
