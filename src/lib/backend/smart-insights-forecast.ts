import type { Prisma } from "@prisma/client";

import type { TenantContext } from "@/lib/auth/tenant-context";
import { getPrisma } from "@/lib/db/prisma";

import type { KronosShadowView } from "./smart-insights-types";

const EMPTY: KronosShadowView = {
  asset: "BTC",
  model: "kronos-small",
  state: "UNAVAILABLE",
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
};

function object(value: Prisma.JsonValue | null | undefined): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function days(value: string): 1 | 3 | 7 | null {
  const parsed = Number(value.replace(/d$/i, ""));
  return parsed === 1 || parsed === 3 || parsed === 7 ? parsed : null;
}

function hasCompleteProvenance(parameters: Prisma.JsonValue): boolean {
  const root = object(parameters);
  const runtime = object(root.runtime);
  return [
    root.modelRevision,
    root.tokenizerRevision,
    root.sourceRevision,
    root.inputFingerprint,
    runtime.manifestDigest,
  ].every((value) => typeof value === "string" && value.length > 0);
}

export async function loadKronosShadow(
  context: TenantContext,
  asset: "BTC",
): Promise<KronosShadowView> {
  if (!context.organizationId || !context.userId) throw new Error("Tenant context is required.");
  if (asset !== "BTC") throw new Error("Only BTC shadow forecasts are supported.");

  const run = await getPrisma().researchRun.findFirst({
    where: {
      organizationId: context.organizationId,
      source: "kronos-small",
      kind: "btc_shadow_forecast",
      asset: { symbol: "BTC" },
    },
    orderBy: { createdAt: "desc" },
    include: {
      forecasts: { orderBy: { generatedAt: "desc" }, take: 600 },
      evaluations: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!run) return EMPTY;
  const parameters = object(run.parameters);
  if (run.status === "failed") {
    return { ...EMPTY, state: "FAILED", modelRevision: String(parameters.modelRevision ?? "") || null };
  }
  const evaluation = run.evaluations[0];
  if (run.status !== "completed" || !evaluation || !hasCompleteProvenance(run.parameters)) return EMPTY;

  const metricRoot = object(evaluation.metrics);
  const modelRows = Array.isArray(metricRoot.models) ? metricRoot.models : [];
  const errorRows = Array.isArray(metricRoot.rollingErrors) ? metricRoot.rollingErrors : [];
  const metrics = modelRows.map((value) => object(value)).map((row) => ({
    model: String(row.model ?? ""),
    mae: Math.max(0, finite(row.mae)),
    mase: Math.max(0, finite(row.mase)),
    directionalAccuracy: Math.min(1, Math.max(0, finite(row.directional_accuracy))),
    spearmanIc: Math.min(1, Math.max(-1, finite(row.spearman_ic))),
    intervalCoverage: row.interval_coverage == null ? null : Math.min(1, Math.max(0, finite(row.interval_coverage))),
    calibrationError: row.calibration_error == null ? null : Math.min(1, Math.max(0, finite(row.calibration_error))),
  }));
  const rollingErrors = errorRows
    .map((value) => object(value))
    .flatMap((row) => {
      const regime = String(row.volatilityRegime ?? "");
      if (!row.ts || !["LOW", "NORMAL", "HIGH"].includes(regime)) return [];
      return [{
        ts: String(row.ts),
        horizon: Math.max(1, Math.trunc(finite(row.horizon, 1))),
        model: String(row.model ?? ""),
        absoluteError: Math.max(0, finite(row.absoluteError)),
        directionCorrect: row.directionCorrect === true,
        volatilityRegime: regime as "LOW" | "NORMAL" | "HIGH",
      }];
    })
    .slice(-360);

  const currentRows = run.forecasts.filter((row) => row.status === "shadow");
  const latestGeneratedAt = currentRows[0]?.generatedAt ?? null;
  const forecasts = currentRows
    .filter((row) => latestGeneratedAt && row.generatedAt.getTime() === latestGeneratedAt.getTime())
    .flatMap((row) => {
      const horizon = days(row.horizon);
      const median = finite(row.targetPrice);
      const lower = finite(row.lowerBound);
      const upper = finite(row.upperBound);
      if (!horizon || !row.forecastFor || !row.modelRevision || !row.inputFingerprint) return [];
      if (!(lower <= median && median <= upper) || lower <= 0) return [];
      return [{ days: horizon, median, lower, upper, forecastFor: row.forecastFor.toISOString() }];
    })
    .sort((left, right) => left.days - right.days);
  const history = run.forecasts
    .filter((row) => row.status === "evaluated" && row.realizedPrice != null && row.forecastFor != null)
    .flatMap((row) => {
      const horizon = days(row.horizon);
      if (!horizon) return [];
      return [{
        generatedAt: row.generatedAt.toISOString(),
        forecastFor: row.forecastFor!.toISOString(),
        days: horizon,
        predicted: finite(row.targetPrice),
        realized: finite(row.realizedPrice),
      }];
    })
    .slice(0, 180)
    .reverse();
  const completedOos = Math.max(0, Math.trunc(finite(metricRoot.completedOos)));
  const state = evaluation.status === "ready_shadow" ? "READY_SHADOW" : "ACCUMULATING";
  return {
    asset: "BTC",
    model: "kronos-small",
    state,
    decisionUse: "NONE",
    completedOos,
    minimumOos: 180,
    generatedAt: latestGeneratedAt?.toISOString() ?? null,
    modelRevision: String(parameters.modelRevision),
    forecasts,
    metrics,
    rollingErrors,
    history,
    methodology: "kronos-btc-shadow-v1",
  };
}
