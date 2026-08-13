"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BacktestResultModel } from "@/lib/backtest/result-model";
import {
  buildPortfolioTradeRows,
  filterPortfolioTradeRows,
} from "@/lib/backtest/result-presentation";
import { useI18n } from "@/lib/i18n/context";

type BacktestTradeListProps = {
  model: BacktestResultModel;
  currency: "USD" | "VND";
};

export function BacktestTradeList({ model, currency }: BacktestTradeListProps) {
  const { t } = useI18n();
  const [symbol, setSymbol] = useState("all");
  const rows = useMemo(() => buildPortfolioTradeRows(model), [model]);
  const visibleRows = useMemo(() => filterPortfolioTradeRows(rows, symbol), [rows, symbol]);
  const symbols = useMemo(() => Array.from(new Set(rows.map((row) => row.asset))).sort(), [rows]);
  const money = new Intl.NumberFormat(currency === "VND" ? "vi-VN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "VND" ? 0 : 2,
  });

  return (
    <Card className="min-w-0 max-w-full">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <CardTitle>{t("backtestResults.tradeList.title")}</CardTitle>
          <CardDescription>{t("backtestResults.tradeList.description")}</CardDescription>
        </div>
        <Select value={symbol} onValueChange={setSymbol}>
          <SelectTrigger
            className="w-full sm:w-44"
            aria-label={t("backtestResults.tradeList.filterAria")}
          >
            <SelectValue placeholder={t("backtestResults.tradeList.allAssets")} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">{t("backtestResults.tradeList.allAssets")}</SelectItem>
              {symbols.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="min-w-0">
        {visibleRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("backtestResults.tradeList.empty")}</p>
        ) : (
          <Table className="min-w-[920px]">
            <TableHeader>
              <TableRow>
                <TableHead>{t("backtestResults.tradeList.signal")}</TableHead>
                <TableHead>{t("backtestResults.tradeList.execution")}</TableHead>
                <TableHead>{t("common.asset")}</TableHead>
                <TableHead>{t("common.strategy")}</TableHead>
                <TableHead>{t("backtestResults.tradeList.action")}</TableHead>
                <TableHead className="text-right">{t("common.price")}</TableHead>
                <TableHead className="text-right">{t("common.quantity")}</TableHead>
                <TableHead className="text-right">{t("backtestResults.tradeList.bars")}</TableHead>
                <TableHead className="text-right">{t("backtestResults.tradeList.fees")}</TableHead>
                <TableHead className="text-right">PnL</TableHead>
                <TableHead className="text-right">
                  {t("backtestResults.tradeList.return")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((trade) => (
                <TableRow key={`${trade.legId}-${trade.executedAt}-${trade.action}`}>
                  <TableCell>{trade.signalAt.slice(0, 10)}</TableCell>
                  <TableCell>{trade.executedAt.slice(0, 10)}</TableCell>
                  <TableCell className="font-medium">{trade.asset}</TableCell>
                  <TableCell>{trade.strategyCode}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{trade.action.toUpperCase()}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {trade.price.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {trade.quantity.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{trade.barsHeld ?? "-"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money.format(trade.fees)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {trade.realizedPnl === null ? "-" : money.format(trade.realizedPnl)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {trade.returnPct === null ? "-" : `${trade.returnPct.toFixed(2)}%`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
