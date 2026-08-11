import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthenticationRequiredError, TenantForbiddenError } from "@/lib/auth/errors";

const mocks = vi.hoisted(() => ({
  requireTenantContext: vi.fn(),
  requireTenantCapability: vi.fn(),
  loadPortfolioResponse: vi.fn(),
  listStrategyAssignments: vi.fn(),
  upsertStrategyAssignment: vi.fn(),
  updateStrategySignalStatus: vi.fn(),
  loadWatchlist: vi.fn(),
  upsertWatchlistItem: vi.fn(),
  removeWatchlistItem: vi.fn(),
  createQuantRun: vi.fn(),
  listQuantRuns: vi.fn(),
  getQuantRun: vi.fn(),
  loadMarketDataHealth: vi.fn(),
  loadResearchRuns: vi.fn(),
  importResearchRun: vi.fn(),
  getWorkerImportContext: vi.fn(),
  loadQuantAssetCatalog: vi.fn(),
  optimizeQuantAllocation: vi.fn(),
  searchProviderInstruments: vi.fn(),
  resolveProviderInstrument: vi.fn(),
  requestMarketIngestion: vi.fn(),
  listMarketIngestionRequests: vi.fn(),
}));

vi.mock("@/lib/auth/tenant-context", () => ({
  requireTenantContext: mocks.requireTenantContext,
  requireTenantCapability: mocks.requireTenantCapability,
}));

vi.mock("@/lib/backend/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/backend/db")>();
  return {
    ...original,
    loadPortfolioResponse: mocks.loadPortfolioResponse,
    listStrategyAssignments: mocks.listStrategyAssignments,
    upsertStrategyAssignment: mocks.upsertStrategyAssignment,
    updateStrategySignalStatus: mocks.updateStrategySignalStatus,
    loadWatchlist: mocks.loadWatchlist,
    upsertWatchlistItem: mocks.upsertWatchlistItem,
    removeWatchlistItem: mocks.removeWatchlistItem,
    createQuantRun: mocks.createQuantRun,
    listQuantRuns: mocks.listQuantRuns,
    getQuantRun: mocks.getQuantRun,
    loadMarketDataHealth: mocks.loadMarketDataHealth,
    loadResearchRuns: mocks.loadResearchRuns,
    importResearchRun: mocks.importResearchRun,
  };
});

vi.mock("@/lib/backend/worker-context", () => ({
  getWorkerImportContext: mocks.getWorkerImportContext,
}));

vi.mock("@/lib/backend/quant-assets", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/backend/quant-assets")>();
  return {
    ...original,
    loadQuantAssetCatalog: mocks.loadQuantAssetCatalog,
  };
});

vi.mock("@/lib/backend/quant-runs", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/backend/quant-runs")>();
  return {
    ...original,
    createPortfolioQuantRun: mocks.createQuantRun,
    listPortfolioQuantRuns: mocks.listQuantRuns,
    loadPortfolioQuantRun: mocks.getQuantRun,
  };
});

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

import { GET as portfolioGet } from "./portfolio/route";
import {
  GET as strategyAssignmentsGet,
  POST as strategyAssignmentsPost,
} from "./portfolio/strategy-assignments/route";
import { PATCH as strategySignalPatch } from "./portfolio/strategy-assignments/[id]/signals/[signalId]/route";
import { GET as watchlistGet, POST as watchlistPost } from "./watchlist/route";
import { DELETE as watchlistDelete } from "./watchlist/[id]/route";
import { POST as quantPost } from "./quant/runs/route";
import { GET as quantDetailGet } from "./quant/runs/[id]/route";
import { GET as strategyCatalogGet } from "./quant/strategies/route";
import { GET as marketDataHealthGet } from "./market/data-health/route";
import { GET as quantAssetsGet } from "./quant/assets/route";
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
    mocks.upsertStrategyAssignment.mockResolvedValue({ id: "assignment-a" });
    mocks.updateStrategySignalStatus.mockResolvedValue({ id: "signal-a", status: "reviewed" });
    mocks.loadWatchlist.mockResolvedValue([]);
    mocks.upsertWatchlistItem.mockResolvedValue([]);
    mocks.removeWatchlistItem.mockResolvedValue(true);
    mocks.createQuantRun.mockResolvedValue({ id: "run-a" });
    mocks.loadMarketDataHealth.mockResolvedValue([]);
    mocks.loadQuantAssetCatalog.mockResolvedValue({ items: [] });
    mocks.optimizeQuantAllocation.mockResolvedValue({
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
  });

  it("allows viewer reads of the versioned strategy catalog", async () => {
    const response = await strategyCatalogGet();

    expect(response.status).toBe(200);
    expect(mocks.requireTenantCapability).toHaveBeenCalledWith(viewerContext, "backtest", "read");
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
    expect(mocks.upsertStrategyAssignment).toHaveBeenCalledWith(editorContext, {
      symbol: "BTC",
      strategyCode: "turtle_breakout",
      strategyVersion: "1.0.0",
      strategyParameters: { entryPeriod: 20, exitPeriod: 10 },
    });
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
      timeframe: "1d",
      from: "2025-01-01",
      to: "2025-12-31",
      riskAversion: 4,
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

  it("allows viewer market data health reads through backtest capability", async () => {
    const response = await marketDataHealthGet();

    expect(response.status).toBe(200);
    expect(mocks.requireTenantCapability).toHaveBeenCalledWith(viewerContext, "backtest", "read");
    expect(mocks.loadMarketDataHealth).toHaveBeenCalledOnce();
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
