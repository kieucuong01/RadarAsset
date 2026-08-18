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
import {
  buildOptimizerRequest,
  DEFAULT_OPTIMIZER_FROM,
  DEFAULT_OPTIMIZER_METHOD,
  DEFAULT_OPTIMIZER_SYMBOLS,
  DEFAULT_OPTIMIZER_TO,
} from "@/lib/backtest/optimizer-defaults";
import type { OptimizerMethod } from "@/lib/backtest/optimizer-methods";
import { useI18n } from "@/lib/i18n/context";

export function PortfolioOptimizerWorkbench({
  initialSymbols = [],
}: {
  initialSymbols?: string[];
}) {
  const { t } = useI18n();
  const range = useRef(createRollingBacktestRange()).current;
  const initialSelection = useRef(
    initialSymbols.length > 0
      ? { symbols: [...initialSymbols], from: range.from, to: range.to, usesDefaults: false }
      : {
          symbols: [...DEFAULT_OPTIMIZER_SYMBOLS],
          from: DEFAULT_OPTIMIZER_FROM,
          to: DEFAULT_OPTIMIZER_TO,
          usesDefaults: true,
        },
  ).current;
  const [timeframe, setTimeframe] = useState<"1d">("1d");
  const [from, setFrom] = useState(initialSelection.from);
  const [to, setTo] = useState(initialSelection.to);
  const [assets, setAssets] = useState<QuantAssetCatalogItem[]>([]);
  const [method, setMethod] = useState<OptimizerMethod>(DEFAULT_OPTIMIZER_METHOD);
  const [targetReturnPct, setTargetReturnPct] = useState(8);
  const [targetVolatilityPct, setTargetVolatilityPct] = useState(20);
  const [markowitzRiskTolerance, setMarkowitzRiskTolerance] = useState(1);
  const [maxWeightPct, setMaxWeightPct] = useState(70);
  const [proposal, setProposal] = useState<OptimizerProposal | null>(null);
  const [loading, setLoading] = useState(false);
  const [editingAssets, setEditingAssets] = useState(false);
  const loadedInitialSymbols = useRef(false);
  const autoOptimizedDefaults = useRef(false);
  const initialSymbolKey = initialSelection.symbols.join("|");
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
      .then(async (catalogs) => {
        const resolved = catalogs.flatMap((catalog, index) => {
          const asset = catalog.items.find((item) => item.symbol === symbols[index]);
          return asset?.backtestable ? [asset] : [];
        });
        setAssets(resolved);
        if (
          !initialSelection.usesDefaults ||
          autoOptimizedDefaults.current ||
          resolved.length !== symbols.length
        ) {
          return;
        }

        autoOptimizedDefaults.current = true;
        setLoading(true);
        try {
          const result = await requestOptimizedAllocation(
            buildOptimizerRequest({
              symbols: resolved.map((asset) => asset.symbol),
              method: DEFAULT_OPTIMIZER_METHOD,
              from: DEFAULT_OPTIMIZER_FROM,
              to: DEFAULT_OPTIMIZER_TO,
              maxWeightPct,
            }),
          );
          setProposal(result);
          toast.success(t("optimizer.success"));
        } catch (error) {
          toast.error(error instanceof Error ? error.message : t("optimizer.error"));
        } finally {
          setLoading(false);
        }
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        toast.warning(t("optimizer.loadInitialError"));
      });
    return () => controller.abort();
  }, [from, initialSelection, initialSymbolKey, maxWeightPct, t, timeframe, to]);

  async function optimize() {
    if (assets.length === 0) return;
    setLoading(true);
    try {
      const result = await requestOptimizedAllocation(
        buildOptimizerRequest({
          symbols: assets.map((asset) => asset.symbol),
          method,
          from,
          to,
          maxWeightPct,
          targetReturnPct,
          targetVolatilityPct,
          riskTolerance: markowitzRiskTolerance,
        }),
      );
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
        editingAssets={editingAssets}
        onTimeframeChange={(value) => updateAndClear(() => setTimeframe(value))}
        onFromChange={(value) => updateAndClear(() => setFrom(value))}
        onToChange={(value) => updateAndClear(() => setTo(value))}
        onMethodChange={(value) => updateAndClear(() => setMethod(value))}
        onTargetReturnChange={(value) => updateAndClear(() => setTargetReturnPct(value))}
        onTargetVolatilityChange={(value) => updateAndClear(() => setTargetVolatilityPct(value))}
        onRiskToleranceChange={(value) => updateAndClear(() => setMarkowitzRiskTolerance(value))}
        onMaxWeightChange={(value) => updateAndClear(() => setMaxWeightPct(value))}
        onEditAssets={() => setEditingAssets((current) => !current)}
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
