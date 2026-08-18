"use client";

import { useCallback, useEffect, useState } from "react";

import { PortfolioHoldingsTable } from "@/components/mock-portfolio/PortfolioHoldingsTable";
import { PortfolioHeader, PortfolioStatusPanel } from "@/components/mock-portfolio/PortfolioHeader";
import { PortfolioOverviewPanel } from "@/components/mock-portfolio/PortfolioOverviewPanel";
import { PortfolioRiskMetrics } from "@/components/mock-portfolio/PortfolioRiskMetrics";
import { PortfolioTransactionLog } from "@/components/mock-portfolio/PortfolioTransactionLog";
import { PortfolioStrategyForwardTests } from "@/components/PortfolioStrategyForwardTests";
import { PortfolioTransactionDialog } from "@/components/PortfolioTransactionDialog";
import { StrategyAssignmentPanel } from "@/components/StrategyAssignmentPanel";
import { Button } from "@/components/ui/button";
import type {
  PortfolioChartTimeframe,
  PortfolioResponse,
  PortfolioTimeframe,
  PortfolioTransactionResponse,
} from "@/lib/backend/types";
import { useI18n } from "@/lib/i18n/context";
import { clearCachedPortfolio, getCachedPortfolio } from "@/lib/portfolio-client";

export function MockPortfolio() {
  const { t, locale } = useI18n();
  const transactionTimeframe: PortfolioTimeframe = "1M";
  const [performanceTimeframe, setPerformanceTimeframe] = useState<PortfolioChartTimeframe>("ALL");
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<PortfolioTransactionResponse | null>(
    null,
  );
  const reportingCurrency = locale === "vi" ? "VND" : "USD";

  const loadPortfolio = useCallback(
    async (nextTimeframe = performanceTimeframe) => {
      setLoading(true);
      setError(null);
      try {
        setPortfolio(await getCachedPortfolio(nextTimeframe, reportingCurrency));
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : t("portfolio.toasts.error");
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [performanceTimeframe, t, reportingCurrency],
  );

  const handlePortfolioRecorded = useCallback(
    (nextPortfolio: PortfolioResponse) => {
      clearCachedPortfolio();
      setPortfolio(nextPortfolio);
      void loadPortfolio(performanceTimeframe);
    },
    [loadPortfolio, performanceTimeframe],
  );

  useEffect(() => {
    void loadPortfolio(performanceTimeframe);
  }, [loadPortfolio, performanceTimeframe]);

  if (loading && !portfolio) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <PortfolioHeader portfolio={null} />
        <PortfolioStatusPanel title={t("portfolio.states.loadingTitle")} tone="muted">
          {t("portfolio.states.loadingBody")}
        </PortfolioStatusPanel>
      </main>
    );
  }

  if (error && !portfolio) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <PortfolioHeader portfolio={null} />
        <PortfolioStatusPanel title={t("portfolio.states.backendUnavailable")} tone="bear">
          {error}
          <div className="mt-4">
            <Button onClick={() => void loadPortfolio(performanceTimeframe)}>
              {t("common.retry")}
            </Button>
          </div>
        </PortfolioStatusPanel>
      </main>
    );
  }

  const holdings = portfolio?.holdings ?? [];
  const currency = portfolio?.baseCurrency === "VND" ? "VND" : "USD";

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <PortfolioHeader portfolio={portfolio} />

      {error ? (
        <PortfolioStatusPanel title={t("portfolio.states.usingSnapshot")} tone="bear">
          {error}
        </PortfolioStatusPanel>
      ) : null}

      <PortfolioOverviewPanel
        portfolio={portfolio}
        timeframe={transactionTimeframe}
        performanceTimeframe={performanceTimeframe}
        onPerformanceTimeframeChange={setPerformanceTimeframe}
        onRecorded={handlePortfolioRecorded}
      />
      <PortfolioHoldingsTable holdings={holdings} currency={currency} />
      <PortfolioRiskMetrics metrics={portfolio?.riskMetrics ?? []} currency={currency} />
      <StrategyAssignmentPanel
        holdings={holdings}
        disabled={!portfolio}
        timeframe={transactionTimeframe}
        onRecorded={handlePortfolioRecorded}
        portfolioCurrency={currency}
      />
      <PortfolioStrategyForwardTests currency={currency} />
      <PortfolioTransactionLog
        transactions={portfolio?.transactions ?? []}
        currency={currency}
        timeframe={transactionTimeframe}
        onEdit={setEditingTransaction}
        onRecorded={handlePortfolioRecorded}
      />
      <PortfolioTransactionDialog
        holdings={holdings}
        disabled={!portfolio}
        timeframe={transactionTimeframe}
        onRecorded={handlePortfolioRecorded}
        portfolioCurrency={currency}
        editingTransaction={editingTransaction}
        open={Boolean(editingTransaction)}
        onOpenChange={(open) => !open && setEditingTransaction(null)}
        trigger={null}
      />
    </main>
  );
}
