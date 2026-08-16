import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthenticationRequiredError, TenantForbiddenError } from "@/lib/auth/errors";

const mocks = vi.hoisted(() => ({
  requireTenantContext: vi.fn(),
  requireTenantCapability: vi.fn(),
  loadPortfolioResponse: vi.fn(),
  listStrategyAssignments: vi.fn(),
  applyStrategyAssignment: vi.fn(),
  updateStrategySignalStatus: vi.fn(),
  loadWatchlist: vi.fn(),
  upsertWatchlistItem: vi.fn(),
  removeWatchlistItem: vi.fn(),
  createQuantRun: vi.fn(),
  listQuantRuns: vi.fn(),
  getQuantRun: vi.fn(),
  cancelQuantRun: vi.fn(),
  loadMarketDataHealth: vi.fn(),
  loadSmartInsightsDataHealth: vi.fn(),
  loadBriefing: vi.fn(),
  loadBriefingEnvelope: vi.fn(),
  loadRegimes: vi.fn(),
  loadMetrics: vi.fn(),
  loadCalendar: vi.fn(),
  loadEvidence: vi.fn(),
  loadPreferences: vi.fn(),
  savePreferences: vi.fn(),
  loadResearchRuns: vi.fn(),
  importResearchRun: vi.fn(),
  getWorkerImportContext: vi.fn(),
  loadQuantAssetCatalog: vi.fn(),
  loadQuantDataReadiness: vi.fn(),
  optimizeQuantAllocation: vi.fn(),
  searchProviderInstruments: vi.fn(),
  resolveProviderInstrument: vi.fn(),
  requestMarketIngestion: vi.fn(),
  listMarketIngestionRequests: vi.fn(),
  listTenantCustomStrategyCatalog: vi.fn(),
  enqueueBriefingRefresh: vi.fn(),
  loadBriefingRefreshState: vi.fn(),
}));

vi.mock("@/lib/auth/tenant-context", () => ({
  requireTenantContext: mocks.requireTenantContext,
  requireTenantCapability: mocks.requireTenantCapability,
}));

vi.mock("@/lib/backend/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/backend/db")>();
  return {
    ...original,
    createQuantRun: mocks.createQuantRun,
    listQuantRuns: mocks.listQuantRuns,
    getQuantRun: mocks.getQuantRun,
  };
});

vi.mock("@/lib/backend/strategy-forward-repository", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/backend/strategy-forward-repository")>();
  return {
    ...original,
    listStrategyAssignments: mocks.listStrategyAssignments,
    updateStrategySignalStatus: mocks.updateStrategySignalStatus,
  };
});

vi.mock("@/lib/backend/market-repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/backend/market-repository")>();
  return {
    ...original,
    loadMarketDataHealth: mocks.loadMarketDataHealth,
  };
});

vi.mock("@/lib/backend/portfolio-repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/backend/portfolio-repository")>();
  return {
    ...original,
    loadPortfolioResponse: mocks.loadPortfolioResponse,
  };
});

vi.mock("@/lib/backend/research-repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/backend/research-repository")>();
  return {
    ...original,
    loadWatchlist: mocks.loadWatchlist,
    upsertWatchlistItem: mocks.upsertWatchlistItem,
    removeWatchlistItem: mocks.removeWatchlistItem,
    loadResearchRuns: mocks.loadResearchRuns,
    importResearchRun: mocks.importResearchRun,
  };
});

vi.mock("@/lib/backend/worker-context", () => ({
  getWorkerImportContext: mocks.getWorkerImportContext,
}));

vi.mock("@/lib/backend/smart-insights-data-health", () => ({
  loadSmartInsightsDataHealth: mocks.loadSmartInsightsDataHealth,
}));

vi.mock("@/lib/backend/smart-insights", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/backend/smart-insights")>();
  return {
    ...original,
    loadBriefing: mocks.loadBriefing,
    loadBriefingEnvelope: mocks.loadBriefingEnvelope,
    loadRegimes: mocks.loadRegimes,
    loadMetrics: mocks.loadMetrics,
    loadCalendar: mocks.loadCalendar,
    loadEvidence: mocks.loadEvidence,
    loadPreferences: mocks.loadPreferences,
    savePreferences: mocks.savePreferences,
  };
});

vi.mock("@/lib/backend/strategy-forward-tests", () => ({
  applyStrategyAssignment: mocks.applyStrategyAssignment,
}));

vi.mock("@/lib/backend/quant-assets", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/backend/quant-assets")>();
  return {
    ...original,
    loadQuantAssetCatalog: mocks.loadQuantAssetCatalog,
    loadQuantDataReadiness: mocks.loadQuantDataReadiness,
  };
});

vi.mock("@/lib/backend/quant-runs", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/backend/quant-runs")>();
  return {
    ...original,
    createPortfolioQuantRun: mocks.createQuantRun,
    listPortfolioQuantRuns: mocks.listQuantRuns,
    loadPortfolioQuantRun: mocks.getQuantRun,
    cancelPortfolioQuantRun: mocks.cancelQuantRun,
  };
});

vi.mock("@/lib/backend/custom-strategies", () => ({
  listTenantCustomStrategyCatalog: mocks.listTenantCustomStrategyCatalog,
}));

vi.mock("@/lib/backend/quant-optimizer", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/backend/quant-optimizer")>();
  return { ...original, optimizeQuantAllocation: mocks.optimizeQuantAllocation };
});

vi.mock("@/lib/backend/provider-catalog", () => ({
  searchProviderInstruments: mocks.searchProviderInstruments,
  resolveProviderInstrument: mocks.resolveProviderInstrument,
}));

vi.mock("@/lib/backend/ingestion-requests", () => ({
  IngestionRateLimitError: class IngestionRateLimitError extends Error {},
  requestMarketIngestion: mocks.requestMarketIngestion,
  listMarketIngestionRequests: mocks.listMarketIngestionRequests,
}));

vi.mock("@/lib/backend/smart-insights-refresh", () => ({
  enqueueBriefingRefresh: mocks.enqueueBriefingRefresh,
  loadBriefingRefreshState: mocks.loadBriefingRefreshState,
}));

import { GET as portfolioGet } from "./portfolio/route";
import {
  GET as strategyAssignmentsGet,
  POST as strategyAssignmentsPost,
} from "./portfolio/strategy-assignments/route";
import { PATCH as strategySignalPatch } from "./portfolio/strategy-assignments/[id]/signals/[signalId]/route";
import { GET as watchlistGet, POST as watchlistPost } from "./watchlist/route";
import { DELETE as watchlistDelete } from "./watchlist/[id]/route";
import { POST as quantPost } from "./quant/runs/route";
import { DELETE as quantDetailDelete, GET as quantDetailGet } from "./quant/runs/[id]/route";
import { GET as strategyCatalogGet } from "./quant/strategies/route";
import { GET as marketDataHealthGet } from "./market/data-health/route";
import { GET as smartInsightsDataHealthGet } from "./smart-insights/data-health/route";
import { GET as smartInsightsBriefingGet } from "./smart-insights/briefing/route";
import { GET as smartInsightsMetricsGet } from "./smart-insights/metrics/route";
import { GET as smartInsightsCalendarGet } from "./smart-insights/calendar/route";
import { GET as smartInsightsEvidenceGet } from "./smart-insights/evidence/[id]/route";
import {
  GET as smartInsightsPreferencesGet,
  PUT as smartInsightsPreferencesPut,
} from "./smart-insights/preferences/route";
import { GET as quantAssetsGet } from "./quant/assets/route";
import { GET as quantDataReadinessGet } from "./quant/data-readiness/route";
import { POST as quantOptimizePost } from "./quant/allocations/optimize/route";
import { POST as workerImportPost } from "./research/runs/import/route";
import { PortfolioRunEligibilityError } from "@/lib/backend/quant-runs";
import { GET as marketInstrumentsGet } from "./market/instruments/route";
import {
  GET as ingestionRequestsGet,
  POST as ingestionRequestsPost,
} from "./market/ingestion-requests/route";

const viewerContext = {
  userId: "user-a",
  organizationId: "org-a",
  role: "viewer" as const,
};
const editorContext = { ...viewerContext, role: "editor" as const };

describe("tenant API authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.requireTenantCapability.mockReset();
    mocks.requireTenantContext.mockResolvedValue(viewerContext);
    mocks.loadPortfolioResponse.mockResolvedValue({ portfolioId: "portfolio-a" });
    mocks.listStrategyAssignments.mockResolvedValue([]);
    mocks.applyStrategyAssignment.mockResolvedValue({ id: "assignment-a" });
    mocks.updateStrategySignalStatus.mockResolvedValue({ id: "signal-a", status: "reviewed" });
    mocks.loadWatchlist.mockResolvedValue([]);
    mocks.upsertWatchlistItem.mockResolvedValue([]);
    mocks.removeWatchlistItem.mockResolvedValue(true);
    mocks.createQuantRun.mockResolvedValue({ id: "run-a" });
    mocks.cancelQuantRun.mockResolvedValue({ id: "run-a", status: "cancel_requested" });
    mocks.loadMarketDataHealth.mockResolvedValue([]);
    mocks.loadSmartInsightsDataHealth.mockResolvedValue({ generatedAt: "now", sources: [] });
    mocks.loadBriefing.mockResolvedValue(null);
    mocks.loadBriefingEnvelope.mockResolvedValue(null);
    mocks.loadRegimes.mockResolvedValue([]);
    mocks.loadMetrics.mockResolvedValue([]);
    mocks.loadCalendar.mockResolvedValue([]);
    mocks.loadEvidence.mockResolvedValue(null);
    mocks.loadPreferences.mockResolvedValue({ preference: {}, persisted: false, canWrite: false });
    mocks.savePreferences.mockResolvedValue({ preference: {}, persisted: true, canWrite: true });
    mocks.loadQuantAssetCatalog.mockResolvedValue({ items: [] });
    mocks.loadQuantDataReadiness.mockResolvedValue({
      readyForBacktest: true,
      instrumentsByMarket: { vn_equity: 404, crypto_spot: 13, metal_spot: 1 },
      activeDatasetsByMarketTimeframe: [],
      ingestionRequestsByStatusTimeframe: [],
      backlogCount: 0,
    });
    mocks.optimizeQuantAllocation.mockResolvedValue({
      method: "risk_parity",
      source: {
        library: "skfolio",
        version: "0.20.1",
        repository: "https://github.com/skfolio/skfolio",
        directory: "awesome-quant: Portfolio Optimization & Risk Analysis",
        license: "BSD-3-Clause",
      },
      weightsBps: { BTC: 10_000 },
      totalWeightBps: 10_000,
      expectedReturnPct: 10,
      volatilityPct: 20,
      sharpe: 0.5,
      observationCount: 40,
      datasetVersionIds: { BTC: "dataset-btc" },
      warnings: [],
    });
    mocks.searchProviderInstruments.mockResolvedValue({ items: [] });
    mocks.requestMarketIngestion.mockResolvedValue({ id: "request-a", created: true });
    mocks.listMarketIngestionRequests.mockResolvedValue([]);
    mocks.listTenantCustomStrategyCatalog.mockResolvedValue([]);
    mocks.enqueueBriefingRefresh.mockResolvedValue({ requestVersion: 1 });
    mocks.loadBriefingRefreshState.mockResolvedValue({
      state: "idle",
      requestVersion: 0,
      errorCode: null,
    });
    mocks.getWorkerImportContext.mockResolvedValue({
      organizationId: "service-org",
      userId: null,
    });
    mocks.importResearchRun.mockResolvedValue({ id: "research-a" });
  });

  it("returns 401 when the server session is missing", async () => {
    mocks.requireTenantContext.mockRejectedValue(new AuthenticationRequiredError());

    const response = await portfolioGet(new Request("http://localhost/api/portfolio"));

    expect(response.status).toBe(401);
    expect(mocks.loadPortfolioResponse).not.toHaveBeenCalled();
  });

  it("allows viewer reads and passes the exact context to services", async () => {
    const response = await watchlistGet();

    expect(response.status).toBe(200);
    expect(mocks.requireTenantCapability).toHaveBeenCalledWith(viewerContext, "watchlist", "read");
    expect(mocks.loadWatchlist).toHaveBeenCalledWith(viewerContext);
  });

  it("tenant-scopes cockpit briefing and evidence reads", async () => {
    expect(
      (await smartInsightsBriefingGet(new Request("http://localhost/api/smart-insights/briefing")))
        .status,
    ).toBe(404);
    expect(
      (
        await smartInsightsEvidenceGet(
          new Request("http://localhost/api/smart-insights/evidence/e-a"),
          {
            params: Promise.resolve({ id: "e-a" }),
          },
        )
      ).status,
    ).toBe(404);
    expect(mocks.loadBriefingEnvelope).toHaveBeenCalledWith(viewerContext, null);
    expect(mocks.loadEvidence).toHaveBeenCalledWith(viewerContext, "e-a");
  });

  it("returns a private ETag and short-circuits an unchanged briefing", async () => {
    mocks.loadBriefingEnvelope.mockResolvedValue({
      fingerprint: "fingerprint-a",
      briefing: { id: "briefing-a", assetOpinions: [] },
    });
    const first = await smartInsightsBriefingGet(
      new Request("http://localhost/api/smart-insights/briefing"),
    );
    const unchanged = await smartInsightsBriefingGet(
      new Request("http://localhost/api/smart-insights/briefing", {
        headers: { "if-none-match": '"fingerprint-a"' },
      }),
    );

    expect(first.status).toBe(200);
    expect(first.headers.get("etag")).toBe('"fingerprint-a"');
    expect(first.headers.get("cache-control")).toBe("private, no-cache");
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe("");
  });

  it("rejects metric and calendar windows over 31 days", async () => {
    const metrics = await smartInsightsMetricsGet(
      new Request(
        "http://localhost/api/smart-insights/metrics?market=crypto&from=2026-01-01&to=2026-03-01",
      ),
    );
    const calendar = await smartInsightsCalendarGet(
      new Request("http://localhost/api/smart-insights/calendar?from=2026-01-01&to=2026-03-01"),
    );
    expect(metrics.status).toBe(400);
    expect(calendar.status).toBe(400);
  });

  it("keeps preference writes behind research write permission", async () => {
    expect((await smartInsightsPreferencesGet()).status).toBe(200);
    const response = await smartInsightsPreferencesPut(
      new Request("http://localhost/api/smart-insights/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale: "vi" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.requireTenantCapability).toHaveBeenCalledWith(viewerContext, "research", "write");
  });

  it("searches only the local provider catalog under watchlist read capability", async () => {
    const response = await marketInstrumentsGet(
      new Request("http://localhost/api/market/instruments?q=eth&limit=10"),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireTenantCapability).toHaveBeenCalledWith(viewerContext, "watchlist", "read");
    expect(mocks.searchProviderInstruments).toHaveBeenCalledWith({ q: "eth", limit: 10 });
  });

  it("queues ingestion only after backtest create authorization and strict validation", async () => {
    mocks.requireTenantContext.mockResolvedValue(editorContext);
    const response = await ingestionRequestsPost(
      new Request("http://localhost/api/market/ingestion-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerCode: "binance-public",
          providerSymbol: "ETHUSDT",
          timeframe: "1h",
        }),
      }),
    );

    expect(response.status).toBe(202);
    expect(mocks.requireTenantCapability).toHaveBeenCalledWith(editorContext, "backtest", "create");
    expect(mocks.requestMarketIngestion).toHaveBeenCalledWith(editorContext, {
      providerCode: "binance-public",
      providerSymbol: "ETHUSDT",
      timeframe: "1h",
    });
    await expect(ingestionRequestsGet()).resolves.toMatchObject({ status: 200 });
  });

  it("deletes only the requested tenant favorite", async () => {
    mocks.requireTenantContext.mockResolvedValue(editorContext);
    const response = await watchlistDelete(
      new Request("http://localhost/api/watchlist/favorite-a", { method: "DELETE" }),
      { params: Promise.resolve({ id: "favorite-a" }) },
    );

    expect(response.status).toBe(204);
    expect(mocks.requireTenantCapability).toHaveBeenCalledWith(editorContext, "watchlist", "write");
    expect(mocks.removeWatchlistItem).toHaveBeenCalledWith(editorContext, "favorite-a");
    expect(mocks.enqueueBriefingRefresh).toHaveBeenCalledWith(editorContext, "watchlist_removed");
  });

  it("queues a briefing refresh after saving a favorite", async () => {
    mocks.requireTenantContext.mockResolvedValue(editorContext);
    const response = await watchlistPost(
      new Request("http://localhost/api/watchlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: "BTC" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("x-smart-insights-refresh")).toBe("queued");
    expect(mocks.enqueueBriefingRefresh).toHaveBeenCalledWith(editorContext, "watchlist_saved");
  });

  it("allows viewer reads of the versioned strategy catalog", async () => {
    const response = await strategyCatalogGet();

    expect(response.status).toBe(200);
    expect(mocks.requireTenantCapability).toHaveBeenCalledWith(viewerContext, "backtest", "read");
    expect(mocks.listTenantCustomStrategyCatalog).toHaveBeenCalledWith(viewerContext);
    await expect(response.json()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "ma_crossover", version: "1.0.0" })]),
    );
  });

  it("allows viewer reads of the system asset catalog with validated query input", async () => {
    const response = await quantAssetsGet(
      new Request(
        "http://localhost/api/quant/assets?q=%20vn%20&timeframe=1d&from=2025-01-01&to=2026-01-01",
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireTenantCapability).toHaveBeenCalledWith(viewerContext, "backtest", "read");
    expect(mocks.loadQuantAssetCatalog).toHaveBeenCalledWith({
      q: "vn",
      timeframe: "1d",
      from: "2025-01-01",
      to: "2026-01-01",
    });
  });

  it("allows viewer reads of Quant data readiness under backtest capability", async () => {
    const response = await quantDataReadinessGet();

    expect(response.status).toBe(200);
    expect(mocks.requireTenantCapability).toHaveBeenCalledWith(viewerContext, "backtest", "read");
    expect(mocks.loadQuantDataReadiness).toHaveBeenCalledWith(viewerContext);
  });

  it("allows viewer assignment reads and scopes the service call", async () => {
    const response = await strategyAssignmentsGet();

    expect(response.status).toBe(200);
    expect(mocks.requireTenantCapability).toHaveBeenCalledWith(viewerContext, "portfolio", "read");
    expect(mocks.listStrategyAssignments).toHaveBeenCalledWith(viewerContext);
  });

  it("allows editor assignment writes only after canonical validation", async () => {
    mocks.requireTenantContext.mockResolvedValue(editorContext);
    const response = await strategyAssignmentsPost(
      new Request("http://localhost/api/portfolio/strategy-assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: "btc",
          strategyCode: "turtle_breakout",
          strategyVersion: "1.0.0",
          strategyParameters: { entryPeriod: 20, exitPeriod: 10 },
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.applyStrategyAssignment).toHaveBeenCalledWith(editorContext, {
      symbol: "BTC",
      strategyCode: "turtle_breakout",
      strategyVersion: "1.0.0",
      strategyParameters: { entryPeriod: 20, exitPeriod: 10 },
    });
    expect(mocks.requireTenantCapability).toHaveBeenCalledWith(editorContext, "backtest", "read");
  });

  it("updates a signal status through the tenant-scoped service", async () => {
    mocks.requireTenantContext.mockResolvedValue(editorContext);
    const response = await strategySignalPatch(
      new Request("http://localhost/api/portfolio/strategy-assignments/a/signals/s", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "reviewed" }),
      }),
      { params: Promise.resolve({ id: "a", signalId: "s" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.updateStrategySignalStatus).toHaveBeenCalledWith(editorContext, "s", "reviewed");
  });

  it("denies viewer writes before request validation or persistence", async () => {
    mocks.requireTenantCapability.mockImplementation(() => {
      throw new TenantForbiddenError();
    });

    const response = await watchlistPost(
      new Request("http://localhost/api/watchlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: "" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.upsertWatchlistItem).not.toHaveBeenCalled();
  });

  it("allows editor quant creation with server-derived ownership", async () => {
    mocks.requireTenantContext.mockResolvedValue(editorContext);

    const payload = {
      strategy: "ma_cross",
      timeframe: "1d",
      fastPeriod: 5,
      slowPeriod: 20,
      initialCapital: 100_000,
      feeBps: 10,
      slippageBps: 5,
      from: "2024-01-01",
      to: "2025-01-01",
      legs: [
        { symbol: "FPT", leverage: 2 },
        { symbol: "BTC", leverage: 1 },
        { symbol: "XAU", leverage: 1 },
      ],
    };

    const response = await quantPost(
      new Request("http://localhost/api/quant/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(202);
    expect(mocks.createQuantRun).toHaveBeenCalledWith(editorContext, {
      timeframe: payload.timeframe,
      totalCapital: payload.initialCapital,
      allocationMode: "equal",
      feeBps: payload.feeBps,
      slippageBps: payload.slippageBps,
      assumptions: {
        cashAllocationBps: 0,
        rebalanceFrequency: "none",
        monthlyContribution: 0,
        dividendMode: "exclude",
        fxPolicy: "normalized_returns",
        baseCurrency: "USD",
        marketCosts: {
          vn_equity: {
            commissionBps: 10,
            sellTaxBps: 0,
            slippageBps: 5,
            financingBpsAnnual: 0,
          },
          crypto_spot: {
            commissionBps: 10,
            sellTaxBps: 0,
            slippageBps: 5,
            financingBpsAnnual: 0,
          },
          metal_spot: {
            commissionBps: 10,
            sellTaxBps: 0,
            slippageBps: 5,
            financingBpsAnnual: 0,
          },
        },
      },
      from: payload.from,
      to: payload.to,
      legs: [
        {
          symbol: "BTC",
          allocationBps: 3334,
          leverage: 1,
          strategyCode: "ma_crossover",
          strategyVersion: "1.0.0",
          strategyParameters: { fastPeriod: 5, slowPeriod: 20 },
        },
        {
          symbol: "FPT",
          allocationBps: 3333,
          leverage: 2,
          strategyCode: "ma_crossover",
          strategyVersion: "1.0.0",
          strategyParameters: { fastPeriod: 5, slowPeriod: 20 },
        },
        {
          symbol: "XAU",
          allocationBps: 3333,
          leverage: 1,
          strategyCode: "ma_crossover",
          strategyVersion: "1.0.0",
          strategyParameters: { fastPeriod: 5, slowPeriod: 20 },
        },
      ],
    });
  });

  it("rejects malformed backtest input before persistence", async () => {
    mocks.requireTenantContext.mockResolvedValue(editorContext);

    const response = await quantPost(
      new Request("http://localhost/api/quant/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ strategy: "user_python", organizationId: "attacker-org" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createQuantRun).not.toHaveBeenCalled();
  });

  it("allows editors to optimize an authenticated portfolio allocation", async () => {
    mocks.requireTenantContext.mockResolvedValue(editorContext);
    const payload = {
      symbols: ["BTC"],
      method: "risk_parity",
      timeframe: "1d",
      from: "2025-01-01",
      to: "2025-12-31",
      maxWeightBps: 10_000,
      totalWeightBps: 10_000,
      dividendMode: "exclude",
    };

    const response = await quantOptimizePost(
      new Request("http://localhost/api/quant/allocations/optimize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireTenantCapability).toHaveBeenCalledWith(editorContext, "backtest", "create");
    expect(mocks.optimizeQuantAllocation).toHaveBeenCalledWith(editorContext, payload);
  });

  it("maps deterministic portfolio eligibility failures to conflict", async () => {
    mocks.requireTenantContext.mockResolvedValue(editorContext);
    mocks.createQuantRun.mockRejectedValue(
      new PortfolioRunEligibilityError("DATASET_UNAVAILABLE", "BTC is unavailable."),
    );

    const response = await quantPost(
      new Request("http://localhost/api/quant/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          strategy: "ma_cross",
          timeframe: "1d",
          fastPeriod: 5,
          slowPeriod: 20,
          initialCapital: 100_000,
          feeBps: 10,
          slippageBps: 5,
          from: "2024-01-01",
          to: "2025-01-01",
          legs: [{ symbol: "BTC", leverage: 1 }],
        }),
      }),
    );

    expect(response.status).toBe(409);
  });

  it("denies viewer backtest submission before persistence", async () => {
    mocks.requireTenantCapability.mockImplementation(() => {
      throw new TenantForbiddenError();
    });

    const response = await quantPost(
      new Request("http://localhost/api/quant/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.createQuantRun).not.toHaveBeenCalled();
  });

  it("returns 404 for a quant id hidden by organization scoping", async () => {
    mocks.getQuantRun.mockRejectedValue(new Error("Quant run not found."));

    const response = await quantDetailGet(new Request("http://localhost/api/quant/runs/run-b"), {
      params: Promise.resolve({ id: "run-b" }),
    });

    expect(response.status).toBe(404);
    expect(mocks.getQuantRun).toHaveBeenCalledWith(viewerContext, "run-b");
  });

  it("requires cancel capability before requesting cooperative run cancellation", async () => {
    mocks.requireTenantContext.mockResolvedValue(editorContext);

    const response = await quantDetailDelete(
      new Request("http://localhost/api/quant/runs/run-a", { method: "DELETE" }),
      { params: Promise.resolve({ id: "run-a" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.requireTenantCapability).toHaveBeenCalledWith(editorContext, "backtest", "cancel");
    expect(mocks.cancelQuantRun).toHaveBeenCalledWith(editorContext, "run-a");
  });

  it("allows viewer market data health reads through backtest capability", async () => {
    const response = await marketDataHealthGet();

    expect(response.status).toBe(200);
    expect(mocks.requireTenantCapability).toHaveBeenCalledWith(viewerContext, "backtest", "read");
    expect(mocks.loadMarketDataHealth).toHaveBeenCalledOnce();
  });

  it("allows viewer Smart Insights health reads through research capability", async () => {
    const response = await smartInsightsDataHealthGet();

    expect(response.status).toBe(200);
    expect(mocks.requireTenantCapability).toHaveBeenCalledWith(viewerContext, "research", "read");
    expect(mocks.loadSmartInsightsDataHealth).toHaveBeenCalledOnce();
  });

  it("does not expose market data health without a tenant session", async () => {
    mocks.requireTenantContext.mockRejectedValue(new AuthenticationRequiredError());

    const response = await marketDataHealthGet();

    expect(response.status).toBe(401);
    expect(mocks.loadMarketDataHealth).not.toHaveBeenCalled();
  });

  it("fails closed when the worker token is not configured", async () => {
    const response = await workerImportPost(
      new Request("http://localhost/api/research/runs/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "worker", kind: "sentiment" }),
      }),
    );

    expect(response.status).toBe(503);
    expect(mocks.importResearchRun).not.toHaveBeenCalled();
  });

  it("uses the configured worker organization after constant-time token validation", async () => {
    vi.stubEnv("QUANT_WORKER_API_TOKEN", "worker-secret");

    const response = await workerImportPost(
      new Request("http://localhost/api/research/runs/import", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-worker-token": "worker-secret",
        },
        body: JSON.stringify({ source: "worker", kind: "sentiment" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.importResearchRun).toHaveBeenCalledWith(
      { organizationId: "service-org", userId: null },
      { source: "worker", kind: "sentiment" },
    );
  });

  it("rejects client-supplied organization ownership", async () => {
    vi.stubEnv("QUANT_WORKER_API_TOKEN", "worker-secret");

    const response = await workerImportPost(
      new Request("http://localhost/api/research/runs/import", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-worker-token": "worker-secret",
        },
        body: JSON.stringify({
          source: "worker",
          kind: "sentiment",
          organizationId: "attacker-org",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.importResearchRun).not.toHaveBeenCalled();
  });
});
