"use client";

import { useState } from "react";
import { LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AssetIcon } from "@/components/AssetIcon";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type {
  PortfolioResponse,
  PortfolioTimeframe,
  PortfolioTransactionResponse,
} from "@/lib/backend/types";
import type { PortfolioCurrency } from "@/lib/backend/fx-rates";
import { formatMoney, formatNumber, formatPrice } from "@/lib/financial-format";
import { useI18n } from "@/lib/i18n/context";
import { deletePortfolioTransactionRequest } from "@/lib/portfolio-client";

type PortfolioTransactionLogProps = {
  transactions: PortfolioResponse["transactions"];
  currency: PortfolioCurrency;
  timeframe: PortfolioTimeframe;
  onEdit: (transaction: PortfolioTransactionResponse) => void;
  onRecorded: (portfolio: PortfolioResponse) => void;
};

export function PortfolioTransactionLog({
  transactions,
  currency,
  timeframe,
  onEdit,
  onRecorded,
}: PortfolioTransactionLogProps) {
  const { t, locale } = useI18n();
  const [deleting, setDeleting] = useState<PortfolioTransactionResponse | null>(null);
  const [pending, setPending] = useState(false);

  const confirmDelete = async () => {
    if (!deleting?.id) return;
    setPending(true);
    try {
      onRecorded(await deletePortfolioTransactionRequest(deleting.id, timeframe, currency));
      toast.success(locale === "vi" ? "Đã xóa giao dịch." : "Transaction deleted.");
      setDeleting(null);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : locale === "vi"
            ? "Không thể xóa giao dịch."
            : "Unable to delete transaction.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      className="overflow-hidden rounded-2xl border border-border bg-card"
      aria-labelledby="txlog-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
        <div>
          <h2 id="txlog-heading" className="font-semibold">
            {t("portfolio.transactions.title")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("portfolio.transactions.description")}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {t("portfolio.transactions.count", { count: transactions.length })}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-5 py-3 text-left font-medium">
                {t("portfolio.transactions.date")}
              </th>
              <th className="px-5 py-3 text-left font-medium">{t("common.asset")}</th>
              <th className="px-5 py-3 text-center font-medium">
                {t("portfolio.transactions.side")}
              </th>
              <th className="px-5 py-3 text-right font-medium">{t("common.quantity")}</th>
              <th className="px-5 py-3 text-right font-medium">{t("common.price")}</th>
              <th className="px-5 py-3 text-right font-medium">
                {t("portfolio.transactions.netAmount")}
              </th>
              <th className="px-5 py-3 text-right font-medium">
                {t("portfolio.transactions.realizedPnl")}
              </th>
              <th className="px-5 py-3 text-right font-medium">
                {locale === "vi" ? "Thao tác" : "Actions"}
              </th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">
                  {t("portfolio.transactions.empty")}
                </td>
              </tr>
            ) : null}
            {transactions.map((transaction) => {
              const isBuy = transaction.type === "buy";
              return (
                <tr
                  key={transaction.id}
                  className="border-b border-border transition-colors last:border-0 hover:bg-muted/40"
                >
                  <td className="px-5 py-3 font-mono text-xs text-muted-foreground">
                    {transaction.executedAt.slice(0, 10)}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <AssetIcon
                        symbol={transaction.symbol ?? ""}
                        name={transaction.symbol ?? ""}
                        size="sm"
                      />
                      <div>
                        <div className="font-semibold">
                          {transaction.symbol ?? transaction.assetId.slice(0, 6)}
                        </div>
                        {transaction.rawCurrency ? (
                          <div className="text-[11px] text-muted-foreground">
                            {locale === "vi" ? "Gốc" : "Raw"}:{" "}
                            {formatPrice(transaction.rawPrice ?? transaction.price, {
                              locale,
                              currency: transaction.rawCurrency,
                            })}
                            {transaction.fxEffectiveDate
                              ? ` · FX ${transaction.fxEffectiveDate}`
                              : ""}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span
                      className={`rounded px-2 py-0.5 text-[11px] font-bold uppercase ${isBuy ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"}`}
                    >
                      {isBuy ? t("common.buy") : t("common.sell")}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {formatNumber(transaction.quantity, { maximumFractionDigits: 8 })}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {formatPrice(transaction.price, { locale, currency })}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">
                    {transaction.netAmount > 0 ? "+" : ""}
                    {formatMoney(transaction.netAmount, { locale, currency })}
                  </td>
                  <td
                    className={`px-5 py-3 text-right font-semibold tabular-nums ${!isBuy && transaction.realizedPnL >= 0 ? "text-bull" : !isBuy ? "text-bear" : ""}`}
                  >
                    {isBuy
                      ? "–"
                      : `${transaction.realizedPnL > 0 ? "+" : ""}${formatMoney(transaction.realizedPnL, { locale, currency })}`}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onEdit(transaction)}
                        aria-label={`${locale === "vi" ? "Sửa giao dịch" : "Edit transaction"} ${transaction.symbol}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-bear"
                        onClick={() => setDeleting(transaction)}
                        aria-label={`${locale === "vi" ? "Xóa giao dịch" : "Delete transaction"} ${transaction.symbol}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && !pending && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {locale === "vi" ? "Xóa giao dịch này?" : "Delete this transaction?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {locale === "vi"
                ? "Hệ thống sẽ replay toàn bộ lịch sử. Nếu làm lệnh bán phía sau không hợp lệ, thao tác sẽ bị từ chối và dữ liệu được giữ nguyên."
                : "The full ledger will be replayed. If a later sell becomes invalid, deletion is rejected and the ledger stays unchanged."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
              disabled={pending}
              className="bg-bear text-white hover:bg-bear/90"
            >
              {pending ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
              {locale === "vi" ? "Xóa giao dịch" : "Delete transaction"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
