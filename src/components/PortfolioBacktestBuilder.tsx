"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AlertCircle, Calculator, Loader2, Play, WalletCards } from "lucide-react";
import { toast } from "sonner";

import { BacktestLegCard } from "@/components/BacktestLegCard";
import { QuantAssetPickerDialog } from "@/components/QuantAssetPickerDialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getQuantAssets } from "@/lib/backtest/asset-client";
import {
  builderValidationReasons,
  createInitialBuilderState,
  reduceBuilder,
  toPortfolioBacktestSubmission,
} from "@/lib/backtest/builder-state";
import {
  getStrategyCatalog,
  submitBacktest,
  type BacktestRun,
  type StrategyCatalogItem,
} from "@/lib/backtest/client";
import { requestOptimizedAllocation } from "@/lib/backtest/optimizer-client";
import {
  OPTIMIZER_METHOD_DESCRIPTIONS,
  OPTIMIZER_METHOD_LABELS,
  OPTIMIZER_METHODS,
  type OptimizerMethod,
} from "@/lib/backtest/optimizer-methods";

type PortfolioBacktestBuilderProps = {
  onRunCreated: (run: BacktestRun) => void;
  initialSymbols?: string[];
};

const MARKET_LABELS = {
  vn_equity: "Chứng khoán Việt Nam",
  crypto_spot: "Crypto spot",
  metal_spot: "XAU/USD spot",
} as const;

const COST_FIELDS = {
  commissionBps: "Phí giao dịch (bps)",
  sellTaxBps: "Thuế bán (bps)",
  slippageBps: "Trượt giá (bps)",
  financingBpsAnnual: "Chi phí vốn/năm (bps)",
} as const;

export function PortfolioBacktestBuilder({
  onRunCreated,
  initialSymbols = [],
}: PortfolioBacktestBuilderProps) {
  const [state, dispatch] = useReducer(reduceBuilder, undefined, () => createInitialBuilderState());
  const [strategies, setStrategies] = useState<StrategyCatalogItem[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizerMethod, setOptimizerMethod] = useState<OptimizerMethod>("risk_parity");
  const [targetReturnPct, setTargetReturnPct] = useState(8);
  const [targetVolatilityPct, setTargetVolatilityPct] = useState(20);
  const [markowitzRiskTolerance, setMarkowitzRiskTolerance] = useState(1);
  const [maxWeightPct, setMaxWeightPct] = useState(70);
  const loadedInitialSymbols = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void getStrategyCatalog((input, init) => fetch(input, { ...init, signal: controller.signal }))
      .then(setStrategies)
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        toast.error("Không thể tải catalog chiến lược.");
      })
      .finally(() => setLoadingCatalog(false));
    return () => controller.abort();
  }, []);

  const initialSymbolKey = initialSymbols.join("|");
  useEffect(() => {
    if (loadedInitialSymbols.current || !initialSymbolKey || strategies.length === 0) return;
    loadedInitialSymbols.current = true;
    const controller = new AbortController();
    const symbols = initialSymbolKey.split("|");
    void Promise.all(
      symbols.map((symbol) =>
        getQuantAssets(
          { q: symbol, timeframe: state.timeframe, from: state.from, to: state.to },
          (input, init) => fetch(input, { ...init, signal: controller.signal }),
        ),
      ),
    )
      .then((catalogs) => {
        catalogs.forEach((catalog, index) => {
          const asset = catalog.items.find((item) => item.symbol === symbols[index]);
          if (!asset?.backtestable) return;
          const strategy = strategies.find(
            (item) =>
              item.supportedMarkets.includes(asset.market) &&
              item.supportedTimeframes.includes(state.timeframe),
          );
          if (strategy) dispatch({ type: "assetAdded", asset, strategy });
        });
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        toast.warning("Không thể nạp toàn bộ mã được chuyển từ Mock Portfolio.");
      });
    return () => controller.abort();
  }, [initialSymbolKey, state.from, state.timeframe, state.to, strategies]);

  const selectedKey = state.legs
    .map((leg) => leg.symbol)
    .sort()
    .join("|");
  useEffect(() => {
    if (
      !selectedKey ||
      !/^\d{4}-\d{2}-\d{2}$/.test(state.from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(state.to)
    ) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const symbols = selectedKey.split("|");
      void Promise.all(
        symbols.map((symbol) =>
          getQuantAssets(
            { q: symbol, timeframe: state.timeframe, from: state.from, to: state.to },
            (input, init) => fetch(input, { ...init, signal: controller.signal }),
          ),
        ),
      )
        .then((catalogs) => {
          catalogs.forEach((catalog, index) => {
            const exact = catalog.items.find((item) => item.symbol === symbols[index]);
            if (exact) dispatch({ type: "assetRefreshed", asset: exact });
          });
        })
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === "AbortError") return;
          toast.warning("Không thể làm mới trạng thái dataset của các mã đã chọn.");
        });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [selectedKey, state.from, state.timeframe, state.to]);

  const reasons = useMemo(() => builderValidationReasons(state), [state]);
  const allocationTotalBps =
    state.assumptions.cashAllocationBps +
    state.legs.reduce((total, leg) => total + leg.allocationBps, 0);
  const investableBps = 10_000 - state.assumptions.cashAllocationBps;

  function defaultStrategyFor(market: string) {
    return (
      strategies.find(
        (strategy) =>
          strategy.supportedMarkets.includes(market) &&
          strategy.supportedTimeframes.includes(state.timeframe),
      ) ?? null
    );
  }

  async function optimizeAllocation() {
    if (state.legs.length === 0) return;
    setOptimizing(true);
    try {
      const minimumCap = Math.ceil(investableBps / state.legs.length);
      const requestedCap = Math.round(maxWeightPct * 100);
      const proposal = await requestOptimizedAllocation({
        symbols: state.legs.map((leg) => leg.symbol),
        method: optimizerMethod,
        timeframe: state.timeframe,
        from: state.from,
        to: state.to,
        maxWeightBps: Math.min(10_000, Math.max(minimumCap, requestedCap)),
        totalWeightBps: investableBps,
        ...(optimizerMethod === "target_return" ? { targetReturnPct } : {}),
        ...(optimizerMethod === "target_volatility" ? { targetVolatilityPct } : {}),
        ...(optimizerMethod === "risk_tolerance" ? { riskTolerance: markowitzRiskTolerance } : {}),
        dividendMode: state.assumptions.dividendMode,
      });
      dispatch({ type: "optimizerApplied", proposal });
      toast.success("Đã áp dụng phân bổ tối ưu từ dữ liệu lịch sử.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể tối ưu phân bổ.");
    } finally {
      setOptimizing(false);
    }
  }

  async function submitPortfolio() {
    setSubmitting(true);
    try {
      const run = await submitBacktest(toPortfolioBacktestSubmission(state));
      onRunCreated(run);
      toast.success("Portfolio backtest đã được đưa vào hàng đợi.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể tạo portfolio backtest.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Portfolio Backtest Builder</CardTitle>
          <CardDescription>
            Chọn 1–10 mã trong hệ thống, gán chiến lược riêng cho từng mã và kiểm soát cash flow.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Field>
                <FieldLabel htmlFor="portfolio-capital">Tổng vốn</FieldLabel>
                <Input
                  id="portfolio-capital"
                  type="number"
                  inputMode="decimal"
                  min={1}
                  value={state.totalCapital}
                  onChange={(event) =>
                    dispatch({
                      type: "totalCapitalEdited",
                      totalCapital: Number(event.target.value),
                    })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="portfolio-currency">Đồng tiền báo cáo</FieldLabel>
                <Select
                  value={state.assumptions.baseCurrency}
                  onValueChange={(value: "USD" | "VND") =>
                    dispatch({ type: "assumptionEdited", key: "baseCurrency", value })
                  }
                >
                  <SelectTrigger id="portfolio-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="VND">VND</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="portfolio-timeframe">Khung thời gian</FieldLabel>
                <Select
                  value={state.timeframe}
                  onValueChange={(value: "1d" | "1h") =>
                    dispatch({ type: "timeframeChanged", timeframe: value })
                  }
                >
                  <SelectTrigger id="portfolio-timeframe">
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
              <Field>
                <FieldLabel htmlFor="portfolio-from">Từ ngày</FieldLabel>
                <Input
                  id="portfolio-from"
                  type="date"
                  value={state.from}
                  onChange={(event) =>
                    dispatch({ type: "rangeChanged", from: event.target.value, to: state.to })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="portfolio-to">Đến ngày</FieldLabel>
                <Input
                  id="portfolio-to"
                  type="date"
                  value={state.to}
                  onChange={(event) =>
                    dispatch({ type: "rangeChanged", from: state.from, to: event.target.value })
                  }
                />
              </Field>
            </div>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Phân bổ tài sản</CardTitle>
              <CardDescription className="mt-1">
                Equal chia đều phần vốn sau cash; Custom cho phép sửa từng mã; Optimized dùng engine
                dữ liệu thật.
              </CardDescription>
            </div>
            <QuantAssetPickerDialog
              timeframe={state.timeframe}
              from={state.from}
              to={state.to}
              selectedSymbols={state.legs.map((leg) => leg.symbol)}
              disabled={loadingCatalog || strategies.length === 0 || state.legs.length >= 10}
              onAdd={(asset) => {
                const strategy = defaultStrategyFor(asset.market);
                if (!strategy) {
                  toast.error(`Chưa có chiến lược hỗ trợ ${asset.symbol} trên ${state.timeframe}.`);
                  return;
                }
                dispatch({ type: "assetAdded", asset, strategy });
              }}
            />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <Field>
              <FieldLabel>Chế độ phân bổ</FieldLabel>
              <ToggleGroup
                type="single"
                value={state.allocationMode === "optimized" ? "" : state.allocationMode}
                onValueChange={(value) => {
                  if (value === "equal" || value === "custom") {
                    dispatch({ type: "allocationModeChanged", allocationMode: value });
                  }
                }}
                variant="outline"
              >
                <ToggleGroupItem value="equal">Equal</ToggleGroupItem>
                <ToggleGroupItem value="custom">Custom</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            <div className="flex flex-wrap items-end gap-3">
              <Field className="w-64">
                <FieldLabel htmlFor="backtest-optimizer-method">Optimization method</FieldLabel>
                <Select
                  value={optimizerMethod}
                  onValueChange={(value: OptimizerMethod) => setOptimizerMethod(value)}
                >
                  <SelectTrigger id="backtest-optimizer-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {OPTIMIZER_METHODS.map((method) => (
                        <SelectItem key={method} value={method}>
                          {OPTIMIZER_METHOD_LABELS[method]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {OPTIMIZER_METHOD_DESCRIPTIONS[optimizerMethod]}
                </FieldDescription>
              </Field>
              {optimizerMethod === "target_return" ? (
                <Field className="w-40">
                  <FieldLabel htmlFor="backtest-target-return">Target return/năm</FieldLabel>
                  <Input
                    id="backtest-target-return"
                    type="number"
                    inputMode="decimal"
                    min={-100}
                    max={1000}
                    step={0.5}
                    value={targetReturnPct}
                    onChange={(event) => setTargetReturnPct(Number(event.target.value))}
                  />
                </Field>
              ) : null}
              {optimizerMethod === "target_volatility" ? (
                <Field className="w-40">
                  <FieldLabel htmlFor="backtest-target-volatility">Target vol/năm</FieldLabel>
                  <Input
                    id="backtest-target-volatility"
                    type="number"
                    inputMode="decimal"
                    min={0.1}
                    max={1000}
                    step={0.5}
                    value={targetVolatilityPct}
                    onChange={(event) => setTargetVolatilityPct(Number(event.target.value))}
                  />
                </Field>
              ) : null}
              {optimizerMethod === "risk_tolerance" ? (
                <Field className="w-40">
                  <FieldLabel>Risk tolerance: {markowitzRiskTolerance}</FieldLabel>
                  <Slider
                    value={[markowitzRiskTolerance]}
                    min={0.1}
                    max={10}
                    step={0.1}
                    onValueChange={([value]) => setMarkowitzRiskTolerance(value)}
                    aria-label="Markowitz risk tolerance"
                  />
                </Field>
              ) : null}
              <Field className="w-40">
                <FieldLabel>Max/mã: {maxWeightPct}%</FieldLabel>
                <Slider
                  value={[maxWeightPct]}
                  min={10}
                  max={100}
                  step={5}
                  onValueChange={([value]) => setMaxWeightPct(value)}
                  aria-label="Maximum asset weight"
                />
              </Field>
              <Button
                type="button"
                variant={state.allocationMode === "optimized" ? "secondary" : "outline"}
                disabled={optimizing || state.legs.length === 0 || investableBps === 0}
                onClick={() => void optimizeAllocation()}
              >
                {optimizing ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : (
                  <Calculator data-icon="inline-start" />
                )}
                Tối ưu
              </Button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="flex min-w-0 flex-col gap-4">
              {state.legs.length === 0 ? (
                <Alert>
                  <WalletCards />
                  <AlertTitle>Portfolio đang trống</AlertTitle>
                  <AlertDescription>
                    Dùng “Thêm mã” để chọn bất kỳ tài sản nào hệ thống hỗ trợ.
                  </AlertDescription>
                </Alert>
              ) : null}
              {state.legs.map((leg) => (
                <BacktestLegCard
                  key={leg.symbol}
                  leg={leg}
                  strategies={strategies}
                  timeframe={state.timeframe}
                  totalCapital={state.totalCapital}
                  baseCurrency={state.assumptions.baseCurrency}
                  dispatch={dispatch}
                />
              ))}
            </div>

            <Card className="h-fit lg:sticky lg:top-20">
              <CardHeader>
                <CardTitle>Cash</CardTitle>
                <CardDescription>
                  Giữ tiền mặt trong đồng tiền báo cáo, lãi suất 0% ở MVP.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="cash-weight">Trọng số cash (%)</FieldLabel>
                    <Input
                      id="cash-weight"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      step={0.01}
                      value={state.assumptions.cashAllocationBps / 100}
                      onChange={(event) =>
                        dispatch({
                          type: "cashAllocationEdited",
                          cashAllocationBps: Math.round(Number(event.target.value) * 100),
                        })
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="cash-notional">Giá trị cash</FieldLabel>
                    <Input
                      id="cash-notional"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      value={Number(
                        (
                          (state.totalCapital * state.assumptions.cashAllocationBps) /
                          10_000
                        ).toFixed(2),
                      )}
                      onChange={(event) =>
                        dispatch({
                          type: "cashAllocationEdited",
                          cashAllocationBps:
                            state.totalCapital > 0
                              ? Math.round(
                                  (Number(event.target.value) / state.totalCapital) * 10_000,
                                )
                              : 0,
                        })
                      }
                    />
                  </Field>
                </FieldGroup>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span>Tổng trọng số</span>
              <Badge variant={allocationTotalBps === 10_000 ? "secondary" : "destructive"}>
                {(allocationTotalBps / 100).toFixed(2)}%
              </Badge>
            </div>
            <Progress value={Math.min(100, allocationTotalBps / 100)} />
            {state.optimizerProposal ? (
              <p className="text-xs text-muted-foreground">
                Optimized by {OPTIMIZER_METHOD_LABELS[state.optimizerProposal.method]} ·{" "}
                {state.optimizerProposal.source.library} {state.optimizerProposal.source.version}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rebalancing & cash-flow assumptions</CardTitle>
          <CardDescription>
            Các giả định này được chuẩn hóa, lưu trong run hash và hiển thị lại ở kết quả.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field>
              <FieldLabel htmlFor="rebalance-frequency">Chu kỳ tái cân bằng</FieldLabel>
              <Select
                value={state.assumptions.rebalanceFrequency}
                onValueChange={(value: "none" | "monthly" | "quarterly" | "yearly") =>
                  dispatch({ type: "assumptionEdited", key: "rebalanceFrequency", value })
                }
              >
                <SelectTrigger id="rebalance-frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">Không</SelectItem>
                    <SelectItem value="monthly">Hàng tháng</SelectItem>
                    <SelectItem value="quarterly">Hàng quý</SelectItem>
                    <SelectItem value="yearly">Hàng năm</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="monthly-contribution">Góp vốn hàng tháng</FieldLabel>
              <Input
                id="monthly-contribution"
                type="number"
                inputMode="decimal"
                min={0}
                value={state.assumptions.monthlyContribution}
                onChange={(event) =>
                  dispatch({
                    type: "assumptionEdited",
                    key: "monthlyContribution",
                    value: Number(event.target.value),
                  })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="dividend-mode">Cổ tức</FieldLabel>
              <Select
                value={state.assumptions.dividendMode}
                onValueChange={(value: "exclude" | "adjusted_prices") =>
                  dispatch({ type: "assumptionEdited", key: "dividendMode", value })
                }
              >
                <SelectTrigger id="dividend-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="exclude">Không tính riêng</SelectItem>
                    <SelectItem value="adjusted_prices">Giá total-return</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>FX policy</FieldLabel>
              <Input value="Normalized returns" readOnly aria-readonly="true" />
              <FieldDescription>Không mô phỏng settlement FX lịch sử ở MVP.</FieldDescription>
            </Field>
          </div>

          <Alert>
            <AlertCircle />
            <AlertTitle>Không tạo dữ liệu giả</AlertTitle>
            <AlertDescription>
              “Giá total-return” chỉ chạy khi có dataset immutable phù hợp; nếu không, server trả
              lỗi trước khi tạo run.
            </AlertDescription>
          </Alert>

          <Accordion type="multiple" className="w-full">
            {Object.entries(MARKET_LABELS).map(([market, label]) => (
              <AccordionItem key={market} value={market}>
                <AccordionTrigger>{label}</AccordionTrigger>
                <AccordionContent>
                  <FieldSet>
                    <FieldLegend variant="label">Cost model theo thị trường</FieldLegend>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      {Object.entries(COST_FIELDS).map(([key, fieldLabel]) => (
                        <Field key={key}>
                          <FieldLabel htmlFor={`${market}-${key}`}>{fieldLabel}</FieldLabel>
                          <Input
                            id={`${market}-${key}`}
                            type="number"
                            inputMode="decimal"
                            min={0}
                            value={
                              state.assumptions.marketCosts[market as keyof typeof MARKET_LABELS][
                                key as keyof typeof COST_FIELDS
                              ]
                            }
                            onChange={(event) =>
                              dispatch({
                                type: "marketCostEdited",
                                market: market as keyof typeof MARKET_LABELS,
                                key: key as keyof typeof COST_FIELDS,
                                value: Number(event.target.value),
                              })
                            }
                          />
                        </Field>
                      ))}
                    </div>
                  </FieldSet>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

      {reasons.length > 0 ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Chưa thể chạy backtest</AlertTitle>
          <AlertDescription>
            <ul className="ml-4 list-disc">
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardFooter className="flex-col justify-between gap-3 pt-6 sm:flex-row">
          <p className="text-sm text-muted-foreground">
            Kết quả là normalized simulation capital, không phải số dư hoặc lệnh tại broker.
          </p>
          <Button
            type="button"
            size="lg"
            disabled={submitting || reasons.length > 0}
            onClick={() => void submitPortfolio()}
          >
            {submitting ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <Play data-icon="inline-start" />
            )}
            Chạy Portfolio Backtest
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
