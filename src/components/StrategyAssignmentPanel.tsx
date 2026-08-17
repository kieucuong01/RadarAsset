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
import { useI18n } from "@/lib/i18n/context";
import { formatNumber, formatPrice } from "@/lib/financial-format";
import { updateStrategySignalStatusClient } from "@/lib/strategy-forward/client";

function loadAssignments() {
  return fetch("/api/portfolio/strategy-assignments", { cache: "no-store" }).then(
    async (response) => {
      if (!response.ok) throw new Error("Không thể tải các chiến lược đã gán cho danh mục.");
      return (await response.json()) as StrategyAssignmentResponse[];
    },
  );
}

export function StrategyAssignmentPanel({
  holdings,
  disabled,
  timeframe,
  onRecorded,
  portfolioCurrency,
}: {
  holdings: PortfolioHoldingResponse[];
  disabled: boolean;
  timeframe: PortfolioTimeframe;
  onRecorded: (portfolio: PortfolioResponse) => void;
  portfolioCurrency?: string | null;
}) {
  const { t, locale } = useI18n();
  const dateFormatter = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
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
      setError(loadError instanceof Error ? loadError.message : t("strategyAlerts.loadError"));
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
        setError(
          loadError instanceof Error ? loadError.message : t("strategyAlerts.strategiesError"),
        );
      })
      .finally(() => setLoading(false));
  }, [t]);

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
        throw new Error(payload?.error ?? t("strategyAlerts.applyError"));
      }
      await refreshAssignments();
      toast.success(t("strategyAlerts.applied", { strategy: definition.name, symbol }));
    } catch (assignError) {
      const message =
        assignError instanceof Error ? assignError.message : t("strategyAlerts.applyError");
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function decideSignal(
    assignmentId: string,
    signalId: string,
    status: "reviewed" | "dismissed",
  ) {
    try {
      await updateStrategySignalStatusClient(assignmentId, signalId, status);
      await refreshAssignments();
    } catch (decisionError) {
      toast.error(
        decisionError instanceof Error ? decisionError.message : t("strategyAlerts.decisionError"),
      );
    }
  }

  return (
    <section
      className="rounded-2xl border border-border bg-card overflow-hidden"
      aria-labelledby="strategy-assignments-heading"
    >
      <div className="p-5 border-b border-border">
        <h2 id="strategy-assignments-heading" className="font-semibold">
          {t("strategyAlerts.title")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("strategyAlerts.description")}</p>
      </div>
      <div className="p-5 space-y-4">
        {heldAssets.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("strategyAlerts.addHoldingFirst")}</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-[1fr_1.5fr_auto] items-end">
            <label className="space-y-1 text-xs text-muted-foreground">
              {t("strategyAlerts.holding")}
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
              {t("common.strategy")}
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
              {saving ? t("common.applying") : t("strategyAlerts.apply")}
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
                        .map(
                          ([key, value]) =>
                            `${key}=${typeof value === "number" ? formatNumber(value) : String(value)}`,
                        )
                        .join(", ")}
                    </p>
                  </div>
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {t("strategyAlerts.reviewRequired")}
                  </span>
                </div>
                {assignment.signals.length === 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {t("strategyAlerts.noSignal")}
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
                            {dateFormatter.format(new Date(signal.signalAt))} ·{" "}
                            {signal.signalPrice === null
                              ? "—"
                              : formatPrice(signal.signalPrice, {
                                  locale,
                                  currency: assignment.currency ?? portfolioCurrency,
                                })}
                          </span>
                        </div>
                        {signal.status === "suggested" ? (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void decideSignal(assignment.id, signal.id, "reviewed")
                              }
                            >
                              {t("strategyAlerts.review")}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                void decideSignal(assignment.id, signal.id, "dismissed")
                              }
                            >
                              {t("strategyAlerts.dismiss")}
                            </Button>
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
                              portfolioCurrency={assignment.currency ?? portfolioCurrency}
                            />
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {locale === "vi"
                              ? ({
                                  reviewed: "Đã xem xét",
                                  executed: "Đã thực hiện",
                                  dismissed: "Đã bỏ qua",
                                }[signal.status] ?? signal.status)
                              : signal.status}
                          </span>
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
