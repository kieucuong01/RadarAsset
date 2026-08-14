import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({
  getPrisma: () => ({ researchRun: { findFirst: mocks.findFirst } }),
}));

import { loadKronosShadow } from "./smart-insights-forecast";

const context = { userId: "user-a", organizationId: "org-a", role: "viewer" as const };
const decimal = (value: number) => ({ toString: () => String(value) });

describe("loadKronosShadow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a neutral unavailable state and scopes by organization", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const result = await loadKronosShadow(context, "BTC");
    expect(result.state).toBe("UNAVAILABLE");
    expect(result.decisionUse).toBe("NONE");
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-a" }) }),
    );
  });

  it("returns ordered intervals without exposing runtime paths or checksums", async () => {
    const generatedAt = new Date("2026-08-14T00:00:00Z");
    mocks.findFirst.mockResolvedValue({
      status: "completed",
      parameters: {
        modelRevision: "model-rev",
        tokenizerRevision: "tokenizer-rev",
        sourceRevision: "source-rev",
        inputFingerprint: "input",
        runtime: { manifestDigest: "secret-digest", runtimePath: "C:/private/runtime" },
      },
      evaluations: [
        {
          status: "ready_shadow",
          metrics: {
            completedOos: 180,
            models: [
              {
                model: "kronos-small",
                mae: 5,
                mase: 0.9,
                directional_accuracy: 0.55,
                spearman_ic: 0.1,
                interval_coverage: 0.8,
                calibration_error: 0,
              },
            ],
            rollingErrors: [],
          },
        },
      ],
      forecasts: [1, 3, 7].map((days) => ({
        status: "shadow",
        generatedAt,
        forecastFor: new Date(generatedAt.getTime() + days * 86_400_000),
        horizon: `${days}d`,
        targetPrice: decimal(100 + days),
        lowerBound: decimal(90 + days),
        upperBound: decimal(110 + days),
        modelRevision: "model-rev",
        inputFingerprint: "input",
        realizedPrice: null,
      })),
    });

    const result = await loadKronosShadow(context, "BTC");
    expect(result.state).toBe("READY_SHADOW");
    expect(result.forecasts.map((point) => point.days)).toEqual([1, 3, 7]);
    expect(JSON.stringify(result)).not.toMatch(/secret-digest|private|runtimePath/i);
  });
});
