"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n/context";

type FactorResponse =
  | {
      ready: false;
      reason: string;
      eligibleAssetCount: number;
      requiredAssetCount: number;
      requiredObservationCount: number;
    }
  | {
      ready: true;
      asOf: string;
      universeSize: number;
      observationCount: number;
      methodology: string;
      rows: Array<{
        symbol: string;
        compositeScore: number;
        momentumScore: number;
        lowVolatilityScore: number;
        trendScore: number;
        liquidityScore: number;
        momentum126dPct: number;
        volatility63dPct: number;
      }>;
    };

export function FactorLab() {
  const { t } = useI18n();
  const [data, setData] = useState<FactorResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/quant/factors/vietnam", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(t("factorLab.unavailable"));
        setData((await response.json()) as FactorResponse);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : t("factorLab.error"));
      });
    return () => controller.abort();
  }, [t]);

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-destructive">{error}</CardContent>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t("factorLab.loading")}
        </CardContent>
      </Card>
    );
  }
  if (!data.ready) {
    const progress = Math.min(100, (data.eligibleAssetCount / data.requiredAssetCount) * 100);
    return (
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{t("factorLab.gateTitle")}</CardTitle>
              <CardDescription>{data.reason}</CardDescription>
            </div>
            <DataStatusBadge status="UNAVAILABLE" detail={t("factorLab.noSynthetic")} />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Progress value={progress} />
          <p className="text-sm text-muted-foreground">
            {t("factorLab.eligible", {
              eligible: data.eligibleAssetCount,
              required: data.requiredAssetCount,
              observations: data.requiredObservationCount,
            })}
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t("factorLab.title")}</CardTitle>
            <CardDescription>{t("factorLab.description", { date: data.asOf })}</CardDescription>
          </div>
          <DataStatusBadge
            status="SYSTEM"
            detail={t("factorLab.detail", {
              symbols: data.universeSize,
              sessions: data.observationCount,
            })}
          />
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("factorLab.symbol")}</TableHead>
              <TableHead>{t("factorLab.composite")}</TableHead>
              <TableHead>{t("factorLab.momentum")}</TableHead>
              <TableHead>{t("factorLab.lowVol")}</TableHead>
              <TableHead>{t("factorLab.trend")}</TableHead>
              <TableHead>{t("factorLab.liquidity")}</TableHead>
              <TableHead>{t("factorLab.return126d")}</TableHead>
              <TableHead>{t("factorLab.vol63d")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow key={row.symbol}>
                <TableCell className="font-semibold">{row.symbol}</TableCell>
                <TableCell>{row.compositeScore.toFixed(1)}</TableCell>
                <TableCell>{row.momentumScore.toFixed(1)}</TableCell>
                <TableCell>{row.lowVolatilityScore.toFixed(1)}</TableCell>
                <TableCell>{row.trendScore.toFixed(1)}</TableCell>
                <TableCell>{row.liquidityScore.toFixed(1)}</TableCell>
                <TableCell>{row.momentum126dPct.toFixed(2)}%</TableCell>
                <TableCell>{row.volatility63dPct.toFixed(2)}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
