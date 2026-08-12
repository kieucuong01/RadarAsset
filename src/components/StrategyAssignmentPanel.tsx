"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { PortfolioTransactionDialog } from "@/components/PortfolioTransactionDialog";
import { Button } from "@/components/ui/button";
import type {
  PortfolioHoldingResponse,
  PortfolioResponse,
  PortfolioTimeframe,
  StrategyAssignmentResponse,
} from "@/lib/backend/types";
import { normalizeStrategyAssignment } from "@/lib/backtest/assignment-contracts";
import { getStrategyCatalog, type StrategyCatalogItem } from "@/lib/backtest/client";

function loadAssignments() {
  return fetch("/api/portfolio/strategy-assignments", { cache: "no-store" }).then(
    async (response) => {
      if (!response.ok) throw new Error("Unable to load portfolio strategy assignments.");
      return (await response.json()) as StrategyAssignmentResponse[];
    },
  );
}

export function StrategyAssignmentPanel({
  holdings,
  disabled,
  timeframe,
  onRecorded,
}: {
  holdings: PortfolioHoldingResponse[];
  disabled: boolean;
  timeframe: PortfolioTimeframe;
  onRecorded: (portfolio: PortfolioResponse) => void;
}) {
  const [strategies, setStrategies] = useState<StrategyCatalogItem[]>([]);
  const [assignments, setAssignments] = useState<StrategyAssignmentResponse[]>([]);
  const [symbol, setSymbol] = useState(holdings[0]?.ticker ?? "BTC");
  const [strategyCode, setStrategyCode] = useState("ma_crossover");
  const [parameters, setParameters] = useState<Record<string, number>>({
    fastPeriod: 5,
    slowPeriod: 20,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const heldAssets = useMemo(() => holdings.filter((holding) => holding.qty > 0), [holdings]);
  const selectedStrategy = strategies.find((strategy) => strategy.code === strategyCode) ?? null;
  const parameterFields = selectedStrategy?.parameterSchema ?? [];

  async function refreshAssignments() {
    try {
      setAssignments(await loadAssignments());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load assignments.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.all([getStrategyCatalog(), loadAssignments()])
      .then(([catalog, nextAssignments]) => {
        setStrategies(catalog);
        setAssignments(nextAssignments);
        if (catalog[0]) {
          setStrategyCode(catalog[0].code);
          setParameters(numericParameters(catalog[0].defaultParameters));
        }
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "Unable to load strategies.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!heldAssets.some((holding) => holding.ticker === symbol) && heldAssets[0]) {
      setSymbol(heldAssets[0].ticker);
    }
  }, [heldAssets, symbol]);

  async function assignStrategy() {
    const definition = selectedStrategy;
    if (!definition) return;
    setSaving(true);
    try {
      const input = normalizeStrategyAssignment({
        symbol,
        strategyCode,
        strategyVersion: definition.version,
        strategyParameters: parameters,
      });
      const response = await fetch("/api/portfolio/strategy-assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Unable to apply strategy.");
      }
      await refreshAssignments();
      toast.success(`${definition.name} applied to ${symbol}. Signals remain review-only.`);
    } catch (assignError) {
      const message =
        assignError instanceof Error ? assignError.message : "Unable to apply strategy.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="rounded-2xl border border-border bg-card overflow-hidden"
      aria-labelledby="strategy-assignments-heading"
    >
      <div className="p-5 border-b border-border">
        <h2 id="strategy-assignments-heading" className="font-semibold">
          Strategy alerts
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Apply a catalog strategy to a holding. BUY/SELL suggestions never execute automatically.
        </p>
      </div>
      <div className="p-5 space-y-4">
        {heldAssets.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add a holding before applying a strategy.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-[1fr_1.5fr_auto] items-end">
            <label className="space-y-1 text-xs text-muted-foreground">
              Holding
              <select
                value={symbol}
                onChange={(event) => setSymbol(event.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                {heldAssets.map((holding) => (
                  <option key={holding.ticker} value={holding.ticker}>
                    {holding.ticker}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Strategy
              <select
                value={strategyCode}
                onChange={(event) => {
                  const next = strategies.find((item) => item.code === event.target.value);
                  setStrategyCode(event.target.value);
                  setParameters(numericParameters(next?.defaultParameters ?? {}));
                }}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                {strategies.map((strategy) => (
                  <option key={`${strategy.code}@${strategy.version}`} value={strategy.code}>
                    {strategy.name} · v{strategy.version}
                  </option>
                ))}
              </select>
            </label>
            <Button
              onClick={() => void assignStrategy()}
              disabled={disabled || saving || !selectedStrategy || loading}
            >
              {saving ? "Applying…" : "Apply strategy"}
            </Button>
          </div>
        )}

        {parameterFields.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {parameterFields.map((field) => (
              <label key={field.name} className="space-y-1 text-xs text-muted-foreground">
                {field.label}
                <input
                  type="number"
                  min={field.min}
                  max={field.max}
                  step={field.type === "integer" ? 1 : 0.001}
                  value={parameters[field.name] ?? field.default}
                  onChange={(event) =>
                    setParameters((current) => ({
                      ...current,
                      [field.name]: Number(event.target.value),
                    }))
                  }
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-bear">{error}</p>}
        {assignments.length > 0 && (
          <div className="space-y-3">
            {assignments.map((assignment) => (
              <div key={assignment.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">
                      {assignment.symbol} · {assignment.strategyName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      v{assignment.strategyVersion} ·{" "}
                      {Object.entries(assignment.parameters)
                        .map(([key, value]) => `${key}=${value}`)
                        .join(", ")}
                    </p>
                  </div>
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Review required
                  </span>
                </div>
                {assignment.signals.length === 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    No new BUY/SELL signal yet. Active assignments are evaluated whenever a new
                    immutable market dataset is published.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {assignment.signals.slice(0, 8).map((signal) => (
                      <div
                        key={signal.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2"
                      >
                        <div className="text-sm">
                          <span
                            className={
                              signal.signalType === "buy"
                                ? "text-bull font-semibold"
                                : "text-bear font-semibold"
                            }
                          >
                            {signal.signalType.toUpperCase()}
                          </span>
                          <span className="ml-2 text-muted-foreground">
                            {new Date(signal.signalAt).toLocaleString()} ·{" "}
                            {signal.signalPrice?.toLocaleString() ?? "—"}
                          </span>
                        </div>
                        {signal.status === "suggested" ? (
                          <PortfolioTransactionDialog
                            holdings={holdings}
                            disabled={disabled}
                            timeframe={timeframe}
                            onRecorded={onRecorded}
                            preset={{
                              side: signal.signalType,
                              symbol: signal.symbol,
                              price: signal.signalPrice ?? 0,
                              signalId: signal.id,
                              assignmentId: assignment.id,
                            }}
                            onSignalExecuted={() => void refreshAssignments()}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">{signal.status}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function numericParameters(parameters: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(parameters).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    ),
  );
}
