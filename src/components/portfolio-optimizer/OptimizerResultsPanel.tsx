import { DataStatusBadge } from "@/components/DataStatusBadge";
import {
  AllocationBreakdown,
  AllocationPie,
  CorrelationMatrix,
  RiskReturnChart,
} from "@/components/portfolio-optimizer/OptimizerVisualizations";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OptimizerProposal } from "@/lib/backtest/optimizer-client";
import { buildOptimizerDashboardModel } from "@/lib/backtest/optimizer-dashboard";
import { optimizerMethodTranslationKey } from "@/lib/backtest/optimizer-methods";
import { formatCount, formatPercent, formatRatio } from "@/lib/financial-format";
import { useI18n } from "@/lib/i18n/context";

type OptimizerResultsPanelProps = {
  proposal: OptimizerProposal | null;
  dashboardModel: ReturnType<typeof buildOptimizerDashboardModel> | null;
};

export function OptimizerResultsPanel({ proposal, dashboardModel }: OptimizerResultsPanelProps) {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t("optimizer.resultTitle")}</CardTitle>
            <CardDescription className="mt-1">{t("optimizer.resultDescription")}</CardDescription>
          </div>
          <DataStatusBadge
            status={proposal ? "SYSTEM" : "UNAVAILABLE"}
            detail={proposal ? t("optimizer.resultReady") : t("optimizer.resultUnavailable")}
          />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {proposal && dashboardModel ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric
                label={t("optimizer.expectedReturn")}
                value={formatPercent(proposal.expectedReturnPct)}
              />
              <Metric
                label={t("optimizer.volatility")}
                value={formatPercent(proposal.volatilityPct)}
              />
              <Metric label={t("optimizer.sharpe")} value={formatRatio(proposal.sharpe)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ValidationMetrics
                label={t("optimizer.inSample")}
                metrics={proposal.validation.inSample}
              />
              <ValidationMetrics
                label={t("optimizer.outSample")}
                metrics={proposal.validation.outOfSample}
              />
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
              {t("optimizer.observations", { count: formatCount(proposal.observationCount) })} ·{" "}
              {t(optimizerMethodTranslationKey(proposal.method, "label"))} ·{" "}
              {proposal.source.library} {proposal.source.version}
            </p>
          </>
        ) : (
          <div className="flex min-h-72 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t("optimizer.empty")}
          </div>
        )}
      </CardContent>
    </Card>
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

function ValidationMetrics({
  label,
  metrics,
}: {
  label: string;
  metrics: OptimizerProposal["validation"]["inSample"];
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm font-semibold">{label}</p>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm tabular-nums">
        <span>
          {t("optimizer.return")} {formatPercent(metrics.expectedReturnPct)}
        </span>
        <span>
          {t("optimizer.volatility")} {formatPercent(metrics.volatilityPct)}
        </span>
        <span>
          {t("optimizer.sharpe")} {formatRatio(metrics.sharpe)}
        </span>
        <span>
          {t("optimizer.maxDd")} {formatPercent(metrics.maxDrawdownPct)}
        </span>
      </div>
    </div>
  );
}
