import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loader: vi.fn(),
  requireTenantContext: vi.fn(),
  requireTenantCapability: vi.fn(),
}));

vi.mock("@/lib/backend/smart-insights-forecast", () => ({ loadKronosShadow: mocks.loader }));
vi.mock("@/lib/auth/tenant-context", () => ({
  requireTenantContext: mocks.requireTenantContext,
  requireTenantCapability: mocks.requireTenantCapability,
}));

import { GET } from "./route";

const context = { userId: "user-a", organizationId: "org-a", role: "viewer" as const };
const view = (state: "ACCUMULATING" | "READY_SHADOW" | "FAILED" | "UNAVAILABLE") => ({
  asset: "BTC",
  model: "kronos-small",
  state,
  decisionUse: "NONE",
  completedOos: 0,
  minimumOos: 180,
  generatedAt: null,
  modelRevision: null,
  forecasts: [],
  metrics: [],
  rollingErrors: [],
  history: [],
  methodology: "kronos-btc-shadow-v1",
});

describe("GET /api/smart-insights/forecast/[asset]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireTenantContext.mockResolvedValue(context);
    mocks.loader.mockResolvedValue(view("UNAVAILABLE"));
  });

  it.each(["ACCUMULATING", "READY_SHADOW", "FAILED", "UNAVAILABLE"] as const)(
    "returns the explicit %s shadow state",
    async (state) => {
      mocks.loader.mockResolvedValue(view(state));
      const response = await GET(
        new Request("http://localhost/api/smart-insights/forecast/BTC?model=kronos-small"),
        { params: Promise.resolve({ asset: "BTC" }) },
      );
      expect(response.status).toBe(200);
      expect((await response.json()).state).toBe(state);
      expect(mocks.requireTenantCapability).toHaveBeenCalledWith(context, "research", "read");
      expect(mocks.loader).toHaveBeenCalledWith(context, "BTC");
    },
  );

  it.each([
    ["ETH", "kronos-small"],
    ["BTC", "other-model"],
  ])("rejects unsupported asset/model %s/%s", async (asset, model) => {
    const response = await GET(
      new Request(`http://localhost/api/smart-insights/forecast/${asset}?model=${model}`),
      { params: Promise.resolve({ asset }) },
    );
    expect(response.status).toBe(400);
    expect(mocks.loader).not.toHaveBeenCalled();
  });
});
