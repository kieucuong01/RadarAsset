import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BacktestResultModel } from "@/lib/backtest/result-model";
import { advancedAnalysisAvailability, robustnessStatus } from "@/lib/backtest/result-presentation";
import { formatNumber, formatPercent } from "@/lib/financial-format";
import { useI18n } from "@/lib/i18n/context";

type AdvancedAnalysisSummaryProps = {
  model: BacktestResultModel;
  availability: ReturnType<typeof advancedAnalysisAvailability>;
  onDownloadReport: () => void;
};

function dateLabel(value: string) {
  return value.slice(0, 10);
}

export function AdvancedAnalysisSummary({
  model,
  availability,
  onDownloadReport,
}: AdvancedAnalysisSummaryProps) {
  const { t } = useI18n();
  const robustness = model.aggregate.robustness;

  return (
    <>
      {model.aggregate.historicalCoverage?.warningCode === "SURVIVORSHIP_COVERAGE_PARTIAL" ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>{t("backtestResults.advanced.survivorshipTitle")}</AlertTitle>
          <AlertDescription>
            {t("backtestResults.advanced.survivorshipDescription", {
              date: model.aggregate.historicalCoverage.firstObservedAt?.slice(0, 10) ?? "—",
            })}
          </AlertDescription>
        </Alert>
      ) : null}
      <div
        className="flex flex-wrap gap-2"
        aria-label={t("backtestResults.advanced.availableAria")}
      >
        {Object.entries(availability)
          .filter(([, available]) => available)
          .map(([section]) => (
            <Badge key={section} variant="secondary">
              {section}
            </Badge>
          ))}
      </div>

      {availability.quantStats ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("backtestResults.advanced.reportTitle")}</CardTitle>
            <CardDescription>{t("backtestResults.advanced.reportDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              {t("backtestResults.advanced.source")}
            </span>
            <Button onClick={onDownloadReport} disabled={!model.aggregate.reportHtml}>
              {t("backtestResults.advanced.download")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {robustness ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("backtestResults.advanced.holdoutTitle")}</CardTitle>
            <CardDescription>{t("backtestResults.advanced.holdoutDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Badge
              variant={robustnessStatus(robustness) === "fragile" ? "destructive" : "secondary"}
              className="w-fit uppercase"
            >
              {robustnessStatus(robustness)}
            </Badge>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <RobustnessMetric
                label={t("backtestResults.advanced.oosMean")}
                value={formatPercent(robustness.outOfSampleMeanReturnPct)}
              />
              <RobustnessMetric
                label={t("backtestResults.advanced.positiveFolds")}
                value={formatPercent(robustness.outOfSamplePositiveFoldPct)}
              />
              <RobustnessMetric
                label={t("backtestResults.advanced.oosDispersion")}
                value={formatPercent(robustness.outOfSampleReturnStdPct)}
              />
              <RobustnessMetric
                label={t("backtestResults.advanced.sample")}
                value={robustness.sampleAdequacy}
                capitalize
              />
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("backtestResults.advanced.fold")}</TableHead>
                  <TableHead>{t("backtestResults.advanced.oosPeriod")}</TableHead>
                  <TableHead className="text-right">
                    {t("backtestResults.advanced.referenceReturn")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("backtestResults.advanced.oosReturn")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("backtestResults.advanced.degradation")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {robustness.folds.map((fold) => (
                  <TableRow key={fold.fold}>
                    <TableCell>{fold.fold}</TableCell>
                    <TableCell>
                      {dateLabel(fold.testStart)} → {dateLabel(fold.testEnd)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPercent(fold.referenceReturnPct)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPercent(fold.outOfSampleReturnPct)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(fold.degradationPctPoints, { maximumFractionDigits: 2 })} pp
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{t("backtestResults.advanced.parameterRobustness")}</p>
              <p className="mt-1 text-muted-foreground">
                {robustness.parameterStability.status === "not_evaluated"
                  ? "Not evaluated: this run did not execute neighboring parameter sets."
                  : `${robustness.parameterStability.status} · score ${formatNumber(robustness.parameterStability.score, { maximumFractionDigits: 1 })}/100`}
              </p>
              {robustness.warnings.length > 0 ? (
                <p className="mt-2 text-amber-600 dark:text-amber-400">
                  {t("backtestResults.advanced.warnings")}: {robustness.warnings.join(", ")}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-muted-foreground">{robustness.disclaimer}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

function RobustnessMetric({
  label,
  value,
  capitalize = false,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold${capitalize ? " capitalize" : " tabular-nums"}`}>
        {value}
      </p>
    </div>
  );
}
