import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthenticationRequiredError, TenantForbiddenError } from "@/lib/auth/errors";

const mocks = vi.hoisted(() => ({
  requireTenantContext: vi.fn(),
  requireTenantCapability: vi.fn(),
  loadPortfolioResponse: vi.fn(),
  loadWatchlist: vi.fn(),
  upsertWatchlistItem: vi.fn(),
  createQuantRun: vi.fn(),
  listQuantRuns: vi.fn(),
  getQuantRun: vi.fn(),
  loadMarketDataHealth: vi.fn(),
  loadResearchRuns: vi.fn(),
  importResearchRun: vi.fn(),
  getWorkerImportContext: vi.fn(),
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
    loadWatchlist: mocks.loadWatchlist,
    upsertWatchlistItem: mocks.upsertWatchlistItem,
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

import { GET as portfolioGet } from "./portfolio/route";
import { GET as watchlistGet, POST as watchlistPost } from "./watchlist/route";
import { POST as quantPost } from "./quant/runs/route";
import { GET as quantDetailGet } from "./quant/runs/[id]/route";
import { GET as marketDataHealthGet } from "./market/data-health/route";
import { POST as workerImportPost } from "./research/runs/import/route";

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
    mocks.loadWatchlist.mockResolvedValue([]);
    mocks.upsertWatchlistItem.mockResolvedValue([]);
    mocks.createQuantRun.mockResolvedValue({ id: "run-a" });
    mocks.loadMarketDataHealth.mockResolvedValue([]);
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
      ...payload,
      legs: [
        { symbol: "BTC", leverage: 1 },
        { symbol: "FPT", leverage: 2 },
        { symbol: "XAU", leverage: 1 },
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
