"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

import { DataHealthPanel } from "@/components/smart-insights/DataHealthPanel";
import { EconomicCalendar } from "@/components/smart-insights/EconomicCalendar";
import { EvidenceDrawer } from "@/components/smart-insights/EvidenceDrawer";
import { LegacyAIDigest } from "@/components/smart-insights/LegacyAIDigest";
import { LegacyDailyHero } from "@/components/smart-insights/LegacyDailyHero";
import { LegacyExpertSignals } from "@/components/smart-insights/LegacyExpertSignals";
import { LegacyInvestorIntelligence } from "@/components/smart-insights/LegacyInvestorIntelligence";
import { LegacyMarketPulse } from "@/components/smart-insights/LegacyMarketPulse";
import { LegacyWatchlist } from "@/components/smart-insights/LegacyWatchlist";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { InsightMarket } from "@/lib/backend/smart-insights-types";
import { useI18n } from "@/lib/i18n/context";
import {
  briefingSchema,
  calendarSchema,
  evidenceSchema,
  fetchParsed,
  healthSchema,
  energyPulseSchema,
  macroEventRiskSchema,
  metricsSchema,
  preferencesSchema,
  putPreferences,
  regimesSchema,
  type BriefingModel,
  type CalendarModel,
  type EvidenceModel,
  type HealthModel,
  type EnergyPulseModel,
  type MacroEventRiskModel,
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
  const [macroEventRisk, setMacroEventRisk] = useState<MacroEventRiskModel | null>(null);
  const [energyPulse, setEnergyPulse] = useState<EnergyPulseModel | null>(null);
  const [macroPulseState, setMacroPulseState] = useState<"idle" | "loading" | "loaded" | "failed">(
    "idle",
  );
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
    if (market !== "macro") return;
    const controller = new AbortController();
    setMacroPulseState("loading");
    Promise.all([
      fetchParsed(
        `/api/smart-insights/macro/events?${windowQuery(31)}`,
        macroEventRiskSchema,
        controller.signal,
      ),
      fetchParsed(
        `/api/smart-insights/macro/energy?${windowQuery(31)}`,
        energyPulseSchema,
        controller.signal,
      ),
    ])
      .then(([eventsResult, energyResult]) => {
        if (controller.signal.aborted) return;
        setMacroEventRisk(eventsResult);
        setEnergyPulse(energyResult);
        setMacroPulseState("loaded");
      })
      .catch(() => {
        if (!controller.signal.aborted) setMacroPulseState("failed");
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
      <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6">
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-w-0 max-w-7xl space-y-10 px-4 py-8 sm:px-6">
      <LegacyDailyHero briefing={briefing} regimes={regimes} />
      {state === "error" ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Smart Insights live data is unavailable</AlertTitle>
          <AlertDescription>
            The original page layout remains available. Blocks using illustrative values are marked
            as sample data.
          </AlertDescription>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => setRefresh((value) => value + 1)}
          >
            <RefreshCw data-icon="inline-start" /> Retry live data
          </Button>
        </Alert>
      ) : null}
      <LegacyAIDigest briefing={briefing} preferences={preferences} onEvidence={setEvidenceId} />
      <LegacyInvestorIntelligence />
      <LegacyMarketPulse
        market={market}
        metrics={marketMetrics}
        regimes={regimes}
        macroEventRisk={macroEventRisk}
        energyPulse={energyPulse}
        macroPulseState={macroPulseState}
        onMarketChange={setMarket}
      />
      <section className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <LegacyWatchlist />
        </div>
        <div className="min-w-0">
          <EconomicCalendar events={events} impact={impact} onImpactChange={setImpact} />
        </div>
      </section>
      <LegacyExpertSignals />
      <DataHealthPanel sources={health?.sources ?? []} />
      <EvidenceDrawer
        evidence={evidence}
        open={evidenceId !== null}
        onClose={() => setEvidenceId(null)}
      />
    </main>
  );
}
