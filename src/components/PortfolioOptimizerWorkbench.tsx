"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { OptimizerConfigurationPanel } from "@/components/portfolio-optimizer/OptimizerConfigurationPanel";
import { OptimizerResultsPanel } from "@/components/portfolio-optimizer/OptimizerResultsPanel";
import { getQuantAssets, type QuantAssetCatalogItem } from "@/lib/backtest/asset-client";
import { createRollingBacktestRange } from "@/lib/backtest/contracts";
import {
  requestOptimizedAllocation,
  type OptimizerProposal,
} from "@/lib/backtest/optimizer-client";
import { buildOptimizerDashboardModel } from "@/lib/backtest/optimizer-dashboard";
import type { OptimizerMethod } from "@/lib/backtest/optimizer-methods";
import { useI18n } from "@/lib/i18n/context";

export function PortfolioOptimizerWorkbench({
  initialSymbols = [],
}: {
  initialSymbols?: string[];
}) {
  const { t } = useI18n();
  const range = useRef(createRollingBacktestRange()).current;
  const [timeframe, setTimeframe] = useState<"1d">("1d");
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
        toast.warning(t("optimizer.loadInitialError"));
      });
    return () => controller.abort();
  }, [from, initialSymbolKey, timeframe, t, to]);

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
      toast.success(t("optimizer.success"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("optimizer.error"));
    } finally {
      setLoading(false);
    }
  }

  function updateAndClear(action: () => void) {
    action();
    setProposal(null);
  }

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
      <OptimizerConfigurationPanel
        timeframe={timeframe}
        from={from}
        to={to}
        method={method}
        targetReturnPct={targetReturnPct}
        targetVolatilityPct={targetVolatilityPct}
        markowitzRiskTolerance={markowitzRiskTolerance}
        maxWeightPct={maxWeightPct}
        assets={assets}
        loading={loading}
        onTimeframeChange={(value) => updateAndClear(() => setTimeframe(value))}
        onFromChange={(value) => updateAndClear(() => setFrom(value))}
        onToChange={(value) => updateAndClear(() => setTo(value))}
        onMethodChange={(value) => updateAndClear(() => setMethod(value))}
        onTargetReturnChange={(value) => updateAndClear(() => setTargetReturnPct(value))}
        onTargetVolatilityChange={(value) => updateAndClear(() => setTargetVolatilityPct(value))}
        onRiskToleranceChange={(value) => updateAndClear(() => setMarkowitzRiskTolerance(value))}
        onMaxWeightChange={(value) => updateAndClear(() => setMaxWeightPct(value))}
        onAssetAdd={(asset) =>
          updateAndClear(() =>
            setAssets((current) =>
              [...current, asset].sort((left, right) => left.symbol.localeCompare(right.symbol)),
            ),
          )
        }
        onAssetRemove={(symbol) =>
          updateAndClear(() =>
            setAssets((current) => current.filter((item) => item.symbol !== symbol)),
          )
        }
        onOptimize={() => void optimize()}
      />
      <OptimizerResultsPanel proposal={proposal} dashboardModel={dashboardModel} />
    </div>
  );
}
