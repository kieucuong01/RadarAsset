"use client";

import { startTransition, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { FavoriteAssetsPanel } from "@/components/FavoriteAssetsPanel";
import { PortfolioHoldingsTable } from "@/components/mock-portfolio/PortfolioHoldingsTable";
import { PortfolioHeader, PortfolioStatusPanel } from "@/components/mock-portfolio/PortfolioHeader";
import { PortfolioOverviewPanel } from "@/components/mock-portfolio/PortfolioOverviewPanel";
import { PortfolioRiskMetrics } from "@/components/mock-portfolio/PortfolioRiskMetrics";
import { PortfolioTransactionLog } from "@/components/mock-portfolio/PortfolioTransactionLog";
import { PortfolioStrategyForwardTests } from "@/components/PortfolioStrategyForwardTests";
import { StrategyAssignmentPanel } from "@/components/StrategyAssignmentPanel";
import { Button } from "@/components/ui/button";
import type { PortfolioResponse, PortfolioTimeframe } from "@/lib/backend/types";
import { defaultCurrency } from "@/lib/financial-format";
import { useI18n } from "@/lib/i18n/context";
import { clearCachedPortfolio, getCachedPortfolio } from "@/lib/portfolio-client";

export function MockPortfolio() {
  const { t, locale } = useI18n();
  const [timeframe, setTimeframe] = useState<PortfolioTimeframe>("1M");
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPortfolio = useCallback(
    async (nextTimeframe = timeframe) => {
      setLoading(true);
      setError(null);
      const toastId = toast.loading(t("portfolio.toasts.loading"));
      try {
        setPortfolio(await getCachedPortfolio(nextTimeframe));
        toast.success(t("portfolio.toasts.loaded"), { id: toastId });
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : t("portfolio.toasts.error");
        setError(message);
        toast.error(message, { id: toastId });
      } finally {
        setLoading(false);
      }
    },
    [timeframe, t],
  );

  const handlePortfolioRecorded = useCallback((nextPortfolio: PortfolioResponse) => {
    clearCachedPortfolio();
    setPortfolio(nextPortfolio);
  }, []);

  useEffect(() => {
    void loadPortfolio(timeframe);
  }, [loadPortfolio, timeframe]);

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
            <Button onClick={() => void loadPortfolio()}>{t("common.retry")}</Button>
          </div>
        </PortfolioStatusPanel>
      </main>
    );
  }

  const holdings = portfolio?.holdings ?? [];
  const currency = portfolio?.baseCurrency ?? defaultCurrency(locale);

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
        timeframe={timeframe}
        onTimeframeChange={(nextTimeframe) => startTransition(() => setTimeframe(nextTimeframe))}
      />
      <PortfolioHoldingsTable holdings={holdings} currency={currency} />
      <FavoriteAssetsPanel
        holdings={holdings}
        timeframe={timeframe}
        onRecorded={handlePortfolioRecorded}
        portfolioCurrency={currency}
      />
      <PortfolioRiskMetrics metrics={portfolio?.riskMetrics ?? []} currency={currency} />
      <StrategyAssignmentPanel
        holdings={holdings}
        disabled={!portfolio}
        timeframe={timeframe}
        onRecorded={handlePortfolioRecorded}
        portfolioCurrency={currency}
      />
      <PortfolioStrategyForwardTests currency={currency} />
      <PortfolioTransactionLog
        transactions={portfolio?.transactions ?? []}
        holdings={holdings}
        disabled={!portfolio}
        timeframe={timeframe}
        currency={currency}
        onRecorded={handlePortfolioRecorded}
      />
    </main>
  );
}
