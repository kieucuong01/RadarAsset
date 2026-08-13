"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

import { CryptoPanel } from "@/components/smart-insights/CryptoPanel";
import { DataHealthPanel } from "@/components/smart-insights/DataHealthPanel";
import { DecisionBrief } from "@/components/smart-insights/DecisionBrief";
import { EconomicCalendar } from "@/components/smart-insights/EconomicCalendar";
import { EvidenceDrawer } from "@/components/smart-insights/EvidenceDrawer";
import { GoldPanel } from "@/components/smart-insights/GoldPanel";
import { MacroPanel } from "@/components/smart-insights/MacroPanel";
import { MarketRegimeStrip } from "@/components/smart-insights/MarketRegimeStrip";
import { PortfolioImpact } from "@/components/smart-insights/PortfolioImpact";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { InsightMarket } from "@/lib/backend/smart-insights-types";
import { useI18n } from "@/lib/i18n/context";
import {
  briefingSchema,
  calendarSchema,
  evidenceSchema,
  fetchParsed,
  healthSchema,
  metricsSchema,
  preferencesSchema,
  putPreferences,
  regimesSchema,
  type BriefingModel,
  type CalendarModel,
  type EvidenceModel,
  type HealthModel,
  type MetricModel,
  type PreferencesModel,
  type RegimeModel,
} from "@/lib/smart-insights-client";

type QueryState = "loading" | "ready" | "empty" | "error";

function windowQuery(days: number): string {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
}

export function SmartInsights() {
  const { locale } = useI18n();
  const [market, setMarket] = useState<InsightMarket>("crypto");
  const [impact, setImpact] = useState<"all" | "high" | "medium" | "low">("all");
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<EvidenceModel | null>(null);
  const [briefing, setBriefing] = useState<BriefingModel | null>(null);
  const [regimes, setRegimes] = useState<RegimeModel[]>([]);
  const [metrics, setMetrics] = useState<MetricModel[]>([]);
  const [events, setEvents] = useState<CalendarModel[]>([]);
  const [preferences, setPreferences] = useState<PreferencesModel | null>(null);
  const [health, setHealth] = useState<HealthModel | null>(null);
  const [state, setState] = useState<QueryState>("loading");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    Promise.allSettled([
      fetchParsed("/api/smart-insights/briefing", briefingSchema, controller.signal),
      fetchParsed("/api/smart-insights/regimes", regimesSchema, controller.signal),
      fetchParsed("/api/smart-insights/preferences", preferencesSchema, controller.signal),
      fetchParsed("/api/smart-insights/data-health", healthSchema, controller.signal),
    ]).then((results) => {
      if (controller.signal.aborted) return;
      const [briefingResult, regimeResult, preferenceResult, healthResult] = results;
      if (briefingResult.status === "fulfilled") setBriefing(briefingResult.value);
      else if (String(briefingResult.reason).includes("404")) setBriefing(null);
      if (regimeResult.status === "fulfilled") setRegimes(regimeResult.value.regimes);
      if (preferenceResult.status === "fulfilled") setPreferences(preferenceResult.value);
      if (healthResult.status === "fulfilled") setHealth(healthResult.value);
      const usable =
        regimeResult.status === "fulfilled" ||
        healthResult.status === "fulfilled" ||
        briefingResult.status === "fulfilled";
      setState(usable ? "ready" : "error");
    });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    fetchParsed(
      `/api/smart-insights/metrics?market=${market}&${windowQuery(31)}`,
      metricsSchema,
      controller.signal,
    )
      .then((result) => setMetrics(result.metrics))
      .catch(() => {
        if (!controller.signal.aborted) setMetrics([]);
      });
    return () => controller.abort();
  }, [market, refresh]);

  useEffect(() => {
    const controller = new AbortController();
    const filter = impact === "all" ? "" : `&impact=${impact}`;
    fetchParsed(
      `/api/smart-insights/calendar?${windowQuery(7)}${filter}`,
      calendarSchema,
      controller.signal,
    )
      .then((result) => setEvents(result.events))
      .catch(() => {
        if (!controller.signal.aborted) setEvents([]);
      });
    return () => controller.abort();
  }, [impact, refresh]);

  useEffect(() => {
    if (!evidenceId) {
      setEvidence(null);
      return;
    }
    const controller = new AbortController();
    fetchParsed(
      `/api/smart-insights/evidence/${encodeURIComponent(evidenceId)}`,
      evidenceSchema,
      controller.signal,
    )
      .then(setEvidence)
      .catch(() => {
        if (!controller.signal.aborted) setEvidence(null);
      });
    return () => controller.abort();
  }, [evidenceId]);

  useEffect(() => {
    if (!preferences?.canWrite || preferences.preference.locale === locale) return;
    putPreferences({ ...preferences.preference, locale })
      .then(setPreferences)
      .catch(() => undefined);
  }, [locale, preferences]);

  const marketMetrics = useMemo(
    () => metrics.filter((item) => item.market === market),
    [market, metrics],
  );

  if (state === "loading") {
    return (
      <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <Skeleton className="h-64 w-full rounded-xl" />
        <div className="grid gap-3 md:grid-cols-3">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      </main>
    );
  }

  if (state === "error") {
    return (
      <main className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Smart Insights unavailable</AlertTitle>
          <AlertDescription>
            The cockpit could not load accepted data. No sample values were substituted.
          </AlertDescription>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => setRefresh((value) => value + 1)}
          >
            <RefreshCw data-icon="inline-start" />
            Retry
          </Button>
        </Alert>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <DecisionBrief briefing={briefing} onEvidence={setEvidenceId} />
      <PortfolioImpact briefing={briefing} preferences={preferences} />
      <MarketRegimeStrip regimes={regimes} onSelectMarket={setMarket} />
      <Tabs value={market} onValueChange={(value) => setMarket(value as InsightMarket)}>
        <Card>
          <CardHeader>
            <TabsList className="grid w-full grid-cols-3 sm:w-fit">
              <TabsTrigger value="crypto">Crypto</TabsTrigger>
              <TabsTrigger value="macro">Macro</TabsTrigger>
              <TabsTrigger value="gold">Gold</TabsTrigger>
            </TabsList>
          </CardHeader>
          <CardContent>
            <TabsContent value="crypto">
              <CryptoPanel metrics={market === "crypto" ? marketMetrics : []} />
            </TabsContent>
            <TabsContent value="macro">
              <MacroPanel metrics={market === "macro" ? marketMetrics : []} />
            </TabsContent>
            <TabsContent value="gold">
              <GoldPanel metrics={market === "gold" ? marketMetrics : []} />
            </TabsContent>
          </CardContent>
        </Card>
      </Tabs>
      <EconomicCalendar events={events} impact={impact} onImpactChange={setImpact} />
      <DataHealthPanel sources={health?.sources ?? []} />
      <EvidenceDrawer
        evidence={evidence}
        open={evidenceId !== null}
        onClose={() => setEvidenceId(null)}
      />
    </main>
  );
}
