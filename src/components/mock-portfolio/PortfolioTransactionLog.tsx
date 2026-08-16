import { useMemo } from "react";

import { PortfolioTransactionDialog } from "@/components/PortfolioTransactionDialog";
import type {
  PortfolioHoldingResponse,
  PortfolioResponse,
  PortfolioTimeframe,
} from "@/lib/backend/types";
import { formatMoney, formatNumber, formatPrice } from "@/lib/financial-format";
import { useI18n } from "@/lib/i18n/context";

type TransactionRow = {
  id: string;
  date: string;
  ticker: string;
  side: "Buy" | "Sell";
  qty: number;
  price: number;
  fee: number;
  netAmount: number;
  realizedPnL: number;
  currency?: string;
};

type PortfolioTransactionLogProps = {
  transactions: PortfolioResponse["transactions"];
  holdings: PortfolioHoldingResponse[];
  disabled: boolean;
  timeframe: PortfolioTimeframe;
  currency: string;
  onRecorded: (portfolio: PortfolioResponse) => void;
};

export function PortfolioTransactionLog({
  transactions,
  holdings,
  disabled,
  timeframe,
  currency,
  onRecorded,
}: PortfolioTransactionLogProps) {
  const { t, locale } = useI18n();
  const visibleTransactions = useMemo<TransactionRow[]>(
    () =>
      transactions.map((transaction) => ({
        id: transaction.id ?? `${transaction.assetId}-${transaction.executedAt}`,
        date: transaction.executedAt.slice(0, 10),
        ticker: transaction.symbol ?? transaction.assetId.slice(0, 6),
        side: transaction.type === "buy" ? "Buy" : "Sell",
        qty: transaction.quantity,
        price: transaction.price,
        fee: transaction.fee,
        netAmount: transaction.netAmount,
        realizedPnL: transaction.realizedPnL,
        currency: transaction.currency,
      })),
    [transactions],
  );

  return (
    <section
      className="rounded-2xl border border-border bg-card overflow-hidden"
      aria-labelledby="txlog-heading"
    >
      <div className="p-5 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 id="txlog-heading" className="font-semibold">
            {t("portfolio.transactions.title")}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("portfolio.transactions.description")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {t("portfolio.transactions.count", { count: visibleTransactions.length })}
          </span>
          <PortfolioTransactionDialog
            holdings={holdings}
            disabled={disabled}
            timeframe={timeframe}
            onRecorded={onRecorded}
            portfolioCurrency={currency}
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted-foreground">
            <tr className="border-b border-border">
              <th className="text-left font-medium px-5 py-3">
                {t("portfolio.transactions.date")}
              </th>
              <th className="text-left font-medium px-5 py-3">{t("common.asset")}</th>
              <th className="text-center font-medium px-5 py-3">
                {t("portfolio.transactions.side")}
              </th>
              <th className="text-right font-medium px-5 py-3">{t("common.quantity")}</th>
              <th className="text-right font-medium px-5 py-3">{t("common.price")}</th>
              <th className="text-right font-medium px-5 py-3">{t("common.fee")}</th>
              <th className="text-right font-medium px-5 py-3">
                {t("portfolio.transactions.netAmount")}
              </th>
              <th className="text-right font-medium px-5 py-3">
                {t("portfolio.transactions.realizedPnl")}
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleTransactions.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">
                  {t("portfolio.transactions.empty")}
                </td>
              </tr>
            )}
            {visibleTransactions.map((transaction) => {
              const isBuy = transaction.side === "Buy";
              return (
                <tr
                  key={transaction.id}
                  className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
                >
                  <td className="px-5 py-3 font-mono text-xs text-muted-foreground">
                    {transaction.date}
                  </td>
                  <td className="px-5 py-3 font-semibold">{transaction.ticker}</td>
                  <td className="px-5 py-3 text-center">
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                        isBuy ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"
                      }`}
                    >
                      {isBuy ? t("common.buy") : t("common.sell")}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {formatNumber(transaction.qty, { maximumFractionDigits: 8 })}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {formatPrice(transaction.price, {
                      locale,
                      currency: transaction.currency ?? currency,
                    })}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                    {formatMoney(transaction.fee, {
                      locale,
                      currency: transaction.currency ?? currency,
                    })}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums font-semibold">
                    {transaction.netAmount > 0 ? "+" : ""}
                    {formatMoney(transaction.netAmount, {
                      locale,
                      currency: transaction.currency ?? currency,
                    })}
                  </td>
                  <td
                    className={`px-5 py-3 text-right tabular-nums font-semibold ${
                      !isBuy && transaction.realizedPnL >= 0
                        ? "text-bull"
                        : !isBuy
                          ? "text-bear"
                          : ""
                    }`}
                  >
                    {isBuy
                      ? "–"
                      : `${transaction.realizedPnL > 0 ? "+" : ""}${formatMoney(
                          transaction.realizedPnL,
                          {
                            locale,
                            currency: transaction.currency ?? currency,
                          },
                        )}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
