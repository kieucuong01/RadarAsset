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
  const [data, setData] = useState<FactorResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/quant/factors/vietnam", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Factor engine is unavailable.");
        setData((await response.json()) as FactorResponse);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Unable to load Factor Lab.");
      });
    return () => controller.abort();
  }, []);

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
          Loading VN factor universe…
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
              <CardTitle>VN Factor Lab — data gate</CardTitle>
              <CardDescription>{data.reason}</CardDescription>
            </div>
            <DataStatusBadge status="UNAVAILABLE" detail="No synthetic factor scores are shown." />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Progress value={progress} />
          <p className="text-sm text-muted-foreground">
            {data.eligibleAssetCount}/{data.requiredAssetCount} eligible symbols ·{" "}
            {data.requiredObservationCount} aligned daily sessions required.
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
            <CardTitle>Vietnam Equity Factor Ranking</CardTitle>
            <CardDescription>
              Point-in-time price/volume factors as of {data.asOf}; higher score is better.
            </CardDescription>
          </div>
          <DataStatusBadge
            status="SYSTEM"
            detail={`${data.universeSize} symbols · ${data.observationCount} aligned sessions`}
          />
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Composite</TableHead>
              <TableHead>Momentum</TableHead>
              <TableHead>Low vol</TableHead>
              <TableHead>Trend</TableHead>
              <TableHead>Liquidity</TableHead>
              <TableHead>126d return</TableHead>
              <TableHead>63d vol</TableHead>
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
