"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

import { EconomicCalendar } from "@/components/smart-insights/EconomicCalendar";
import { EvidenceDrawer } from "@/components/smart-insights/EvidenceDrawer";
import { AnalysisDateControl } from "@/components/smart-insights/AnalysisDateControl";
import { AssetOpinions } from "@/components/smart-insights/AssetOpinions";
import { LegacyDailyHero } from "@/components/smart-insights/LegacyDailyHero";
import { LegacyMarketPulse } from "@/components/smart-insights/LegacyMarketPulse";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";
import type { InsightMarket } from "@/lib/backend/smart-insights-types";
import type { PortfolioResponse, WatchlistItemResponse } from "@/lib/backend/types";
import { useI18n } from "@/lib/i18n/context";
import { clearCachedPortfolio } from "@/lib/portfolio-client";
import { loadSmartInsightsWorkspaceData } from "@/lib/smart-insights-workspace-client";
import {
  calendarSchema,
  evidenceSchema,
  fetchParsed,
  fetchBriefing,
  fetchBriefingDates,
  energyPulseSchema,
  macroEventRiskSchema,
  metricsSchema,
  preferencesSchema,
  putPreferences,
  requestBriefingRefresh,
  regimesSchema,
  type BriefingModel,
  type BriefingDatesModel,
  type BriefingGenerationState,
  type CalendarModel,
  type EvidenceModel,
  type EnergyPulseModel,
  type MacroEventRiskModel,
  type MetricModel,
  type PreferencesModel,
  type RegimeModel,
} from "@/lib/smart-insights-client";
import { removeFavoriteAsset } from "@/lib/watchlist-client";

type QueryState = "loading" | "ready" | "empty" | "error";

function windowQuery(days: number): string {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
}

export function SmartInsights() {
  const { locale } = useI18n();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const authenticatedUserId = session?.user.id ?? null;
  const [market, setMarket] = useState<InsightMarket>("crypto");
  const [impact, setImpact] = useState<"all" | "high" | "medium" | "low">("all");
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<EvidenceModel | null>(null);
  const [briefing, setBriefing] = useState<BriefingModel | null>(null);
  const [briefingState, setBriefingState] = useState<BriefingGenerationState>("idle");
  const [briefingRefreshPending, setBriefingRefreshPending] = useState(false);
  const [dateCatalog, setDateCatalog] = useState<BriefingDatesModel | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [dateCatalogState, setDateCatalogState] = useState<"idle" | "loading" | "ready" | "failed">(
    "idle",
  );
  const [regimes, setRegimes] = useState<RegimeModel[]>([]);
  const [metrics, setMetrics] = useState<MetricModel[]>([]);
  const [events, setEvents] = useState<CalendarModel[]>([]);
  const [preferences, setPreferences] = useState<PreferencesModel | null>(null);
  const [macroEventRisk, setMacroEventRisk] = useState<MacroEventRiskModel | null>(null);
  const [energyPulse, setEnergyPulse] = useState<EnergyPulseModel | null>(null);
  const [macroPulseState, setMacroPulseState] = useState<"idle" | "loading" | "loaded" | "failed">(
    "idle",
  );
  const [state, setState] = useState<QueryState>("loading");
  const [refresh, setRefresh] = useState(0);
  const [watchlist, setWatchlist] = useState<WatchlistItemResponse[]>([]);
  const [watchlistAvailable, setWatchlistAvailable] = useState(false);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [portfolioAvailable, setPortfolioAvailable] = useState(false);

  useEffect(() => {
    if (sessionPending) return;
    if (!authenticatedUserId) {
      setBriefing(null);
      setBriefingState("idle");
      setDateCatalog(null);
      setSelectedDate(null);
      setBriefingLoading(false);
      setDateCatalogState("idle");
      setRegimes([]);
      setMetrics([]);
      setEvents([]);
      setPreferences(null);
      setMacroEventRisk(null);
      setEnergyPulse(null);
      setMacroPulseState("idle");
      setWatchlist([]);
      setWatchlistAvailable(false);
      setWatchlistError(null);
      setPortfolio(null);
      setPortfolioAvailable(false);
      setEvidence(null);
      setEvidenceId(null);
      setState("ready");
      return;
    }
    const controller = new AbortController();
    setState("loading");
    setDateCatalogState("loading");
    Promise.allSettled([
      fetchBriefingDates(controller.signal),
      fetchParsed("/api/smart-insights/regimes", regimesSchema, controller.signal),
      fetchParsed("/api/smart-insights/preferences", preferencesSchema, controller.signal),
    ]).then((results) => {
      if (controller.signal.aborted) return;
      const [catalogResult, regimeResult, preferenceResult] = results;
      if (catalogResult.status === "fulfilled") {
        setDateCatalog(catalogResult.value);
        setBriefingLoading(true);
        setSelectedDate((current) => current ?? catalogResult.value.today);
        setDateCatalogState("ready");
      } else {
        setDateCatalogState("failed");
      }
      if (regimeResult.status === "fulfilled") setRegimes(regimeResult.value.regimes);
      if (preferenceResult.status === "fulfilled") setPreferences(preferenceResult.value);
      const usable = regimeResult.status === "fulfilled" || catalogResult.status === "fulfilled";
      setState(usable ? "ready" : "error");
    });
    return () => controller.abort();
  }, [authenticatedUserId, refresh, sessionPending]);

  useEffect(() => {
    if (!authenticatedUserId || !selectedDate) return;
    const controller = new AbortController();
    setBriefing(null);
    setBriefingLoading(true);
    setEvidence(null);
    setEvidenceId(null);
    void fetchBriefing(selectedDate, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setBriefing(result.briefing);
        setBriefingState(result.state);
        if (result.errorCode === "BRIEFING_NOT_GENERATED_FOR_DATE") {
          void fetchBriefingDates(controller.signal)
            .then((catalog) => {
              if (!controller.signal.aborted) setDateCatalog(catalog);
            })
            .catch(() => undefined);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setBriefingState("failed");
      })
      .finally(() => {
        if (!controller.signal.aborted) setBriefingLoading(false);
      });
    return () => controller.abort();
  }, [authenticatedUserId, refresh, selectedDate]);

  useEffect(() => {
    if (!authenticatedUserId) return;
    let active = true;
    void loadSmartInsightsWorkspaceData().then((result) => {
      if (!active) return;
      setWatchlist(result.watchlist.items);
      setWatchlistAvailable(result.watchlist.available);
      setWatchlistError(result.watchlist.error);
      setPortfolio(result.portfolio.value);
      setPortfolioAvailable(result.portfolio.available);
    });
    return () => {
      active = false;
    };
  }, [authenticatedUserId, refresh]);

  useEffect(() => {
    const today = dateCatalog?.today;
    if (
      !authenticatedUserId ||
      !selectedDate ||
      selectedDate !== today ||
      briefingState !== "generating"
    )
      return;
    const controller = new AbortController();
    let timer = 0;
    const poll = async () => {
      try {
        const result = await fetchBriefing(selectedDate, controller.signal);
        if (controller.signal.aborted) return;
        setBriefing(result.briefing);
        setBriefingState(result.state);
        if (result.state === "generating") {
          timer = window.setTimeout(poll, 5_000);
        } else if (result.state === "ready") {
          void fetchBriefingDates(controller.signal)
            .then((catalog) => {
              if (!controller.signal.aborted) setDateCatalog(catalog);
            })
            .catch(() => undefined);
        }
      } catch {
        if (!controller.signal.aborted) setBriefingState("failed");
      }
    };
    timer = window.setTimeout(poll, 5_000);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [authenticatedUserId, briefingState, dateCatalog?.today, selectedDate]);

  async function refreshBriefing() {
    if (!selectedDate || selectedDate !== dateCatalog?.today) return;
    setBriefingRefreshPending(true);
    try {
      await requestBriefingRefresh();
      setBriefingState("generating");
    } catch {
      setBriefingState("failed");
    } finally {
      setBriefingRefreshPending(false);
    }
  }

  function handleAnalysisDateChange(date: string) {
    if (date === selectedDate) return;
    setBriefing(null);
    setBriefingLoading(true);
    setSelectedDate(date);
  }

  function handleWatchlistSaved(items: WatchlistItemResponse[]) {
    setWatchlist(items);
    setWatchlistAvailable(true);
    setWatchlistError(null);
    if (selectedDate === dateCatalog?.today) setBriefingState("generating");
  }

  async function handleRemoveTrackedAsset(id: string) {
    const result = await removeFavoriteAsset(id);
    setWatchlist((items) => items.filter((item) => item.id !== id));
    if (result.refreshQueued && selectedDate === dateCatalog?.today) setBriefingState("generating");
  }

  function handlePortfolioRecorded(nextPortfolio: PortfolioResponse) {
    clearCachedPortfolio();
    setPortfolio(nextPortfolio);
    setPortfolioAvailable(true);
  }

  useEffect(() => {
    if (!authenticatedUserId) return;
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
  }, [authenticatedUserId, market, refresh]);

  useEffect(() => {
    if (!authenticatedUserId || market !== "macro") return;
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
  }, [authenticatedUserId, market, refresh]);

  useEffect(() => {
    if (!authenticatedUserId) return;
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
  }, [authenticatedUserId, impact, refresh]);

  useEffect(() => {
    if (!authenticatedUserId || !evidenceId) {
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
  }, [authenticatedUserId, evidenceId]);

  useEffect(() => {
    if (!authenticatedUserId || !preferences?.canWrite || preferences.preference.locale === locale)
      return;
    putPreferences({ ...preferences.preference, locale })
      .then(setPreferences)
      .catch(() => undefined);
  }, [authenticatedUserId, locale, preferences]);

  const marketMetrics = useMemo(
    () => metrics.filter((item) => item.market === market),
    [market, metrics],
  );

  if (state === "loading" || sessionPending) {
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
      {!authenticatedUserId ? (
        <>
          <LegacyDailyHero briefing={briefing} regimes={regimes} />
          <AssetOpinions
            opinions={[]}
            portfolioState="missing"
            locale={locale}
            onEvidence={setEvidenceId}
            guestPreview
          />
        </>
      ) : dateCatalog && selectedDate ? (
        <>
          <AnalysisDateControl
            locale={locale}
            today={dateCatalog.today}
            dates={dateCatalog.dates}
            value={selectedDate}
            loading={briefingLoading}
            onChange={handleAnalysisDateChange}
          />
          {briefingLoading ? (
            <>
              <Skeleton className="h-64 w-full rounded-3xl" />
              <Skeleton className="h-96 w-full rounded-xl" />
            </>
          ) : (
            <>
              {briefing ? <LegacyDailyHero briefing={briefing} regimes={regimes} /> : null}
              <AssetOpinions
                opinions={briefing?.assetOpinions ?? []}
                portfolioState={briefing?.portfolioState ?? "missing"}
                locale={locale}
                onEvidence={setEvidenceId}
                generationState={briefingState}
                onRefresh={selectedDate === dateCatalog.today ? refreshBriefing : undefined}
                refreshPending={briefingRefreshPending}
                watchlist={watchlist}
                watchlistAvailable={watchlistAvailable}
                watchlistError={watchlistError}
                portfolio={portfolio}
                portfolioAvailable={portfolioAvailable}
                onWatchlistSaved={handleWatchlistSaved}
                onRemoveTrackedAsset={handleRemoveTrackedAsset}
                onPortfolioRecorded={handlePortfolioRecorded}
                portfolioChanges={briefing?.portfolioChanges ?? []}
                portfolioChangesStatus={briefing?.portfolioChangesStatus ?? "accumulating"}
                analysisDate={selectedDate}
                today={dateCatalog.today}
                briefingAvailable={Boolean(briefing)}
              />
            </>
          )}
        </>
      ) : dateCatalogState === "failed" && state !== "error" ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>
            {locale === "vi" ? "Không thể tải ngày phân tích" : "Analysis dates unavailable"}
          </AlertTitle>
          <AlertDescription>
            {locale === "vi"
              ? "Dữ liệu thị trường hiện tại vẫn hoạt động. Hãy thử tải lại phần phân tích."
              : "Current market data remains available. Retry the analysis section."}
          </AlertDescription>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => setRefresh((value) => value + 1)}
          >
            <RefreshCw data-icon="inline-start" />
            {locale === "vi" ? "Thử lại" : "Retry"}
          </Button>
        </Alert>
      ) : null}
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
      <LegacyMarketPulse
        authenticated={Boolean(authenticatedUserId)}
        market={market}
        metrics={marketMetrics}
        regimes={regimes}
        macroEventRisk={macroEventRisk}
        energyPulse={energyPulse}
        macroPulseState={macroPulseState}
        onMarketChange={setMarket}
      />
      <section className="min-w-0">
        <EconomicCalendar
          locale={locale}
          events={events}
          impact={impact}
          onImpactChange={setImpact}
        />
      </section>
      <EvidenceDrawer
        evidence={evidence}
        open={evidenceId !== null}
        locale={locale}
        onClose={() => setEvidenceId(null)}
      />
    </main>
  );
}
