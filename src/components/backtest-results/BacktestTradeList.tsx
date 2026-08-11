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

type BacktestTradeListProps = {
  model: BacktestResultModel;
  currency: "USD" | "VND";
};

export function BacktestTradeList({ model, currency }: BacktestTradeListProps) {
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
          <CardTitle>Trade List</CardTitle>
          <CardDescription>Completed entries and exits, newest first.</CardDescription>
        </div>
        <Select value={symbol} onValueChange={setSymbol}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Filter trades by asset">
            <SelectValue placeholder="All assets" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">All assets</SelectItem>
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
          <p className="text-sm text-muted-foreground">No completed trades for this selection.</p>
        ) : (
          <Table className="min-w-[1080px]">
            <TableHeader>
              <TableRow>
                <TableHead>Entry</TableHead>
                <TableHead>Exit</TableHead>
                <TableHead>Asset</TableHead>
                <TableHead>Strategy</TableHead>
                <TableHead>Side</TableHead>
                <TableHead className="text-right">Entry price</TableHead>
                <TableHead className="text-right">Exit price</TableHead>
                <TableHead className="text-right">Bars</TableHead>
                <TableHead className="text-right">Fees</TableHead>
                <TableHead className="text-right">PnL</TableHead>
                <TableHead className="text-right">Return</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((trade) => (
                <TableRow key={`${trade.legId}-${trade.entryAt}-${trade.exitAt}`}>
                  <TableCell>{trade.entryAt.slice(0, 10)}</TableCell>
                  <TableCell>{trade.exitAt.slice(0, 10)}</TableCell>
                  <TableCell className="font-medium">{trade.asset}</TableCell>
                  <TableCell>{trade.strategyCode}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{trade.side.toUpperCase()}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {trade.entryPrice.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {trade.exitPrice.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{trade.barsHeld}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money.format(trade.fees)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money.format(trade.realizedPnl)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {trade.returnPct.toFixed(2)}%
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
