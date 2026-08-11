"use client";

import { useEffect, useRef, useState } from "react";
import { Calculator, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import { QuantAssetPickerDialog } from "@/components/QuantAssetPickerDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { getQuantAssets, type QuantAssetCatalogItem } from "@/lib/backtest/asset-client";
import { createRollingBacktestRange } from "@/lib/backtest/contracts";
import {
  requestOptimizedAllocation,
  type OptimizerProposal,
} from "@/lib/backtest/optimizer-client";
import {
  OPTIMIZER_METHOD_DESCRIPTIONS,
  OPTIMIZER_METHOD_LABELS,
  OPTIMIZER_METHODS,
  type OptimizerMethod,
} from "@/lib/backtest/optimizer-methods";

export function PortfolioOptimizerWorkbench({
  initialSymbols = [],
}: {
  initialSymbols?: string[];
}) {
  const range = useRef(createRollingBacktestRange()).current;
  const [timeframe, setTimeframe] = useState<"1d" | "1h">("1d");
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [assets, setAssets] = useState<QuantAssetCatalogItem[]>([]);
  const [method, setMethod] = useState<OptimizerMethod>("risk_parity");
  const [targetReturnPct, setTargetReturnPct] = useState(8);
  const [targetVolatilityPct, setTargetVolatilityPct] = useState(20);
  const [markowitzRiskTolerance, setMarkowitzRiskTolerance] = useState(1);
  const [maxWeightPct, setMaxWeightPct] = useState(70);
  const [proposal, setProposal] = useState<OptimizerProposal | null>(null);
  const [loading, setLoading] = useState(false);
  const loadedInitialSymbols = useRef(false);
  const initialSymbolKey = initialSymbols.join("|");

  useEffect(() => {
    if (loadedInitialSymbols.current || !initialSymbolKey) return;
    loadedInitialSymbols.current = true;
    const controller = new AbortController();
    const symbols = initialSymbolKey.split("|");
    void Promise.all(
      symbols.map((symbol) =>
        getQuantAssets({ q: symbol, timeframe, from, to }, (input, init) =>
          fetch(input, { ...init, signal: controller.signal }),
        ),
      ),
    )
      .then((catalogs) =>
        setAssets(
          catalogs.flatMap((catalog, index) => {
            const asset = catalog.items.find((item) => item.symbol === symbols[index]);
            return asset?.backtestable ? [asset] : [];
          }),
        ),
      )
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        toast.warning("Không thể nạp danh sách mã từ URL.");
      });
    return () => controller.abort();
  }, [from, initialSymbolKey, timeframe, to]);

  async function optimize() {
    if (assets.length === 0) return;
    setLoading(true);
    try {
      const minimumCap = Math.ceil(10_000 / assets.length);
      const result = await requestOptimizedAllocation({
        symbols: assets.map((asset) => asset.symbol),
        method,
        timeframe,
        from,
        to,
        maxWeightBps: Math.max(minimumCap, Math.round(maxWeightPct * 100)),
        totalWeightBps: 10_000,
        ...(method === "target_return" ? { targetReturnPct } : {}),
        ...(method === "target_volatility" ? { targetVolatilityPct } : {}),
        ...(method === "risk_tolerance" ? { riskTolerance: markowitzRiskTolerance } : {}),
        dividendMode: "exclude",
      });
      setProposal(result);
      toast.success("Optimizer đã hoàn tất trên immutable dataset versions.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể chạy optimizer.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="h-fit lg:sticky lg:top-20">
        <CardHeader>
          <CardTitle>Awesome-Quant Optimizer</CardTitle>
          <CardDescription>
            Powered by portfolio-allocation from awesome-quant; no in-house optimizer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <Field>
                <FieldLabel htmlFor="optimizer-timeframe">Khung thời gian</FieldLabel>
                <Select
                  value={timeframe}
                  onValueChange={(value: "1d" | "1h") => {
                    setTimeframe(value);
                    setProposal(null);
                  }}
                >
                  <SelectTrigger id="optimizer-timeframe">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="1d">Ngày (1d)</SelectItem>
                      <SelectItem value="1h">Giờ (1h)</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="optimizer-from">Từ ngày</FieldLabel>
                  <Input
                    id="optimizer-from"
                    type="date"
                    value={from}
                    onChange={(event) => {
                      setFrom(event.target.value);
                      setProposal(null);
                    }}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="optimizer-to">Đến ngày</FieldLabel>
                  <Input
                    id="optimizer-to"
                    type="date"
                    value={to}
                    onChange={(event) => {
                      setTo(event.target.value);
                      setProposal(null);
                    }}
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="optimizer-method">Optimization method</FieldLabel>
                <Select
                  value={method}
                  onValueChange={(value: OptimizerMethod) => {
                    setMethod(value);
                    setProposal(null);
                  }}
                >
                  <SelectTrigger id="optimizer-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {OPTIMIZER_METHODS.map((item) => (
                        <SelectItem key={item} value={item}>
                          {OPTIMIZER_METHOD_LABELS[item]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>{OPTIMIZER_METHOD_DESCRIPTIONS[method]}</FieldDescription>
              </Field>
              {method === "target_return" ? (
                <Field>
                  <FieldLabel htmlFor="optimizer-target-return">
                    Target return/năm: {targetReturnPct}%
                  </FieldLabel>
                  <Input
                    id="optimizer-target-return"
                    type="number"
                    inputMode="decimal"
                    min={-100}
                    max={1000}
                    step={0.5}
                    value={targetReturnPct}
                    onChange={(event) => {
                      setTargetReturnPct(Number(event.target.value));
                      setProposal(null);
                    }}
                  />
                  <FieldDescription>
                    Markowitz sẽ tìm volatility thấp nhất tại mức return này.
                  </FieldDescription>
                </Field>
              ) : null}
              {method === "target_volatility" ? (
                <Field>
                  <FieldLabel htmlFor="optimizer-target-volatility">
                    Target volatility/năm: {targetVolatilityPct}%
                  </FieldLabel>
                  <Input
                    id="optimizer-target-volatility"
                    type="number"
                    inputMode="decimal"
                    min={0.1}
                    max={1000}
                    step={0.5}
                    value={targetVolatilityPct}
                    onChange={(event) => {
                      setTargetVolatilityPct(Number(event.target.value));
                      setProposal(null);
                    }}
                  />
                  <FieldDescription>
                    Markowitz sẽ tìm expected return cao nhất tại volatility này.
                  </FieldDescription>
                </Field>
              ) : null}
              {method === "risk_tolerance" ? (
                <Field>
                  <FieldLabel htmlFor="optimizer-risk-tolerance">
                    Risk tolerance: {markowitzRiskTolerance}
                  </FieldLabel>
                  <Slider
                    value={[markowitzRiskTolerance]}
                    min={0.1}
                    max={10}
                    step={0.1}
                    onValueChange={([value]) => {
                      setMarkowitzRiskTolerance(value);
                      setProposal(null);
                    }}
                    aria-label="Markowitz risk tolerance"
                  />
                  <FieldDescription>
                    Giá trị cao hơn nghiêng nhiều hơn về expected return.
                  </FieldDescription>
                </Field>
              ) : null}
              <Field>
                <FieldLabel>Trọng số tối đa/mã: {maxWeightPct}%</FieldLabel>
                <Slider
                  value={[maxWeightPct]}
                  min={10}
                  max={100}
                  step={5}
                  onValueChange={([value]) => {
                    setMaxWeightPct(value);
                    setProposal(null);
                  }}
                  aria-label="Maximum optimizer weight"
                />
              </Field>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">Tài sản ({assets.length})</span>
                <QuantAssetPickerDialog
                  timeframe={timeframe}
                  from={from}
                  to={to}
                  selectedSymbols={assets.map((asset) => asset.symbol)}
                  disabled={assets.length >= 10}
                  onAdd={(asset) => {
                    setAssets((current) =>
                      [...current, asset].sort((left, right) =>
                        left.symbol.localeCompare(right.symbol),
                      ),
                    );
                    setProposal(null);
                  }}
                />
              </div>
              {assets.map((asset) => (
                <div
                  key={asset.symbol}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold">{asset.symbol}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {asset.market} · {asset.rowCount.toLocaleString()} bars
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Xóa ${asset.symbol}`}
                    onClick={() => {
                      setAssets((current) =>
                        current.filter((item) => item.symbol !== asset.symbol),
                      );
                      setProposal(null);
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <Button
            className="w-full"
            disabled={loading || assets.length === 0}
            onClick={() => void optimize()}
          >
            {loading ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <Calculator data-icon="inline-start" />
            )}
            Tính phân bổ tối ưu
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Optimal allocation</CardTitle>
              <CardDescription className="mt-1">
                Kết quả chỉ xuất hiện sau khi API xác nhận dataset versions.
              </CardDescription>
            </div>
            <DataStatusBadge
              status={proposal ? "SYSTEM" : "UNAVAILABLE"}
              detail={
                proposal
                  ? "Phân bổ được tính từ dữ liệu lịch sử có phiên bản."
                  : "Chưa chạy optimizer."
              }
            />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {proposal ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric
                  label="Expected return"
                  value={`${proposal.expectedReturnPct.toFixed(2)}%`}
                />
                <Metric label="Volatility" value={`${proposal.volatilityPct.toFixed(2)}%`} />
                <Metric label="Sharpe" value={proposal.sharpe?.toFixed(2) ?? "N/A"} />
              </div>
              <div className="flex flex-col gap-4">
                {Object.entries(proposal.weightsBps)
                  .sort(([left], [right]) => left.localeCompare(right))
                  .map(([symbol, weightBps]) => (
                    <div key={symbol} className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="font-semibold">{symbol}</span>
                        <Badge variant="secondary">{(weightBps / 100).toFixed(2)}%</Badge>
                      </div>
                      <Progress value={weightBps / 100} />
                      <p className="truncate text-xs text-muted-foreground">
                        Dataset {proposal.datasetVersionIds[symbol]}
                      </p>
                    </div>
                  ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {proposal.observationCount} overlapping returns ·{" "}
                {OPTIMIZER_METHOD_LABELS[proposal.method]} · {proposal.source.library}{" "}
                {proposal.source.version}
              </p>
            </>
          ) : (
            <div className="flex min-h-72 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Chọn tài sản rồi chạy optimizer để xem phân bổ. Không có kết quả mô phỏng mặc định.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
