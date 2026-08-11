"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Calculator, Loader2, Trash2 } from "lucide-react";
import {
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getQuantAssets, type QuantAssetCatalogItem } from "@/lib/backtest/asset-client";
import { createRollingBacktestRange } from "@/lib/backtest/contracts";
import {
  buildOptimizerDashboardModel,
  type OptimizerAllocationSlice,
  type OptimizerCorrelationRow,
  type OptimizerRiskReturnPoint,
} from "@/lib/backtest/optimizer-dashboard";
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
  const dashboardModel = useMemo(
    () => (proposal ? buildOptimizerDashboardModel(proposal) : null),
    [proposal],
  );

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
          {proposal && dashboardModel ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric
                  label="Expected return"
                  value={`${proposal.expectedReturnPct.toFixed(2)}%`}
                />
                <Metric label="Volatility" value={`${proposal.volatilityPct.toFixed(2)}%`} />
                <Metric label="Sharpe" value={proposal.sharpe?.toFixed(2) ?? "N/A"} />
              </div>
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
                <AllocationPie slices={dashboardModel.allocationSlices} />
                <RiskReturnChart points={dashboardModel.riskReturnPoints} />
              </div>
              <CorrelationMatrix
                symbols={dashboardModel.symbols}
                rows={dashboardModel.correlationRows}
              />
              <AllocationBreakdown slices={dashboardModel.allocationSlices} />
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

const chartTooltipStyle = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
};

function pct(value: number) {
  return `${value.toFixed(2)}%`;
}

function AllocationPie({ slices }: { slices: OptimizerAllocationSlice[] }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Asset Allocation</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Optimized weight by symbol from the selected method.
          </p>
        </div>
        <Badge variant="secondary">{slices.length} assets</Badge>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px] md:items-center">
        <div className="h-64 min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="weightPct"
                nameKey="symbol"
                innerRadius={58}
                outerRadius={96}
                paddingAngle={3}
                stroke="var(--card)"
                strokeWidth={3}
              >
                {slices.map((slice) => (
                  <Cell key={slice.symbol} fill={slice.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={chartTooltipStyle}
                formatter={(value: number) => [pct(Number(value)), "Allocation"]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="space-y-3">
          {slices.map((slice) => (
            <li key={slice.symbol} className="flex items-center justify-between gap-3 text-sm">
              <span className="inline-flex min-w-0 items-center gap-2">
                <span
                  className="size-3 rounded-sm"
                  style={{ backgroundColor: slice.color }}
                  aria-hidden="true"
                />
                <span className="truncate font-medium">{slice.symbol}</span>
              </span>
              <span className="font-semibold tabular-nums">{pct(slice.weightPct)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function RiskReturnTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: OptimizerRiskReturnPoint }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-lg border bg-card p-3 text-xs shadow-lg">
      <p className="font-semibold">{point.symbol}</p>
      <p className="mt-1 text-muted-foreground">Expected return: {pct(point.expectedReturnPct)}</p>
      <p className="text-muted-foreground">Volatility: {pct(point.volatilityPct)}</p>
      <p className="text-muted-foreground">Weight: {pct(point.weightPct)}</p>
      <p className="mt-1 max-w-56 truncate text-muted-foreground">
        Dataset {point.datasetVersionId}
      </p>
    </div>
  );
}

function RiskReturnChart({ points }: { points: OptimizerRiskReturnPoint[] }) {
  return (
    <div className="rounded-lg border p-4">
      <div>
        <h3 className="font-semibold">Risk / Return — Expected Return vs Volatility</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Each bubble is a symbol; bubble size follows optimized weight.
        </p>
      </div>
      <div className="mt-4 h-64 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 24, right: 20, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="volatilityPct"
              name="Volatility"
              unit="%"
              tickLine={false}
              axisLine={false}
              fontSize={11}
              tickFormatter={(value) => `${Number(value).toFixed(0)}%`}
            />
            <YAxis
              type="number"
              dataKey="expectedReturnPct"
              name="Expected return"
              unit="%"
              tickLine={false}
              axisLine={false}
              width={48}
              fontSize={11}
              tickFormatter={(value) => `${Number(value).toFixed(0)}%`}
            />
            <ZAxis dataKey="weightPct" range={[80, 280]} />
            <Tooltip
              content={<RiskReturnTooltip />}
              cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }}
            />
            <Scatter name="Assets" data={points} fill="var(--primary)">
              <LabelList
                dataKey="symbol"
                position="top"
                className="fill-muted-foreground text-xs"
              />
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function correlationBackground(value: number) {
  const opacity = Math.min(0.55, 0.1 + Math.abs(value) * 0.38);
  return value < 0 ? `hsl(0 72% 51% / ${opacity})` : `hsl(142 65% 42% / ${opacity})`;
}

function CorrelationMatrix({
  symbols,
  rows,
}: {
  symbols: string[];
  rows: OptimizerCorrelationRow[];
}) {
  return (
    <div className="rounded-lg border p-4">
      <div>
        <h3 className="font-semibold">Historical Correlation Matrix</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Computed from overlapping historical returns used by the optimizer.
        </p>
      </div>
      <div className="mt-4">
        <Table className="min-w-[560px]" aria-label="Historical correlation matrix">
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-card">Symbol</TableHead>
              {symbols.map((symbol) => (
                <TableHead key={symbol} className="text-center">
                  {symbol}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.symbol}>
                <TableCell className="sticky left-0 bg-card font-semibold">{row.symbol}</TableCell>
                {row.values.map((cell) => (
                  <TableCell key={cell.symbol} className="text-center">
                    <span
                      className="inline-flex min-w-14 justify-center rounded-md px-2 py-1 font-mono text-xs tabular-nums"
                      style={{ backgroundColor: correlationBackground(cell.value) }}
                    >
                      {cell.value.toFixed(2)}
                    </span>
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AllocationBreakdown({ slices }: { slices: OptimizerAllocationSlice[] }) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <div>
        <h3 className="font-semibold">Allocation details</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Dataset IDs are shown so the result can be traced back to immutable data versions.
        </p>
      </div>
      {slices.map((slice) => (
        <div key={slice.symbol} className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="inline-flex min-w-0 items-center gap-2 font-semibold">
              <span
                className="size-2.5 rounded-sm"
                style={{ backgroundColor: slice.color }}
                aria-hidden="true"
              />
              {slice.symbol}
            </span>
            <Badge variant="secondary">{pct(slice.weightPct)}</Badge>
          </div>
          <Progress value={slice.weightPct} />
          <p className="truncate text-xs text-muted-foreground">Dataset {slice.datasetVersionId}</p>
        </div>
      ))}
    </div>
  );
}
