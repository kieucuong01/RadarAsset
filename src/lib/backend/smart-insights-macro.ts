import type { Prisma } from "@prisma/client";

import type { TenantContext } from "@/lib/auth/tenant-context";
import { getPrisma } from "@/lib/db/prisma";

import type { Availability, EnergyPulseView, MacroEventRiskView } from "./smart-insights-types";

const ACCEPTED_QUALITY = ["passed", "warning"];
const ENERGY_CODES = [
  "macro.energy.brent_usd_bbl",
  "macro.energy.wti_usd_bbl",
  "macro.energy.inventory_thousand_bbl",
  "macro.energy.production_thousand_bpd",
] as const;

function assertContext(context: TenantContext): void {
  if (!context.organizationId || !context.userId) throw new Error("Tenant context is required.");
}

function number(value: { toString(): string } | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

function strings(value: Prisma.JsonValue | null | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function safeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    for (const key of url.searchParams.keys())
      if (/key|token|secret|signature/i.test(key)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function availability(
  score: number | null,
  coverage: number,
  status: string | null,
  effectiveAt: Date,
  now: Date,
): Availability {
  if (score == null || coverage < 0.6 || status == null) return "UNAVAILABLE";
  if (now.getTime() - effectiveAt.getTime() > 6 * 60 * 60 * 1_000) return "STALE";
  return coverage < 1 || status !== "active" ? "LIMITED_DATA" : "AVAILABLE";
}

type SnapshotInput = {
  metricCode?: unknown;
  value?: unknown;
  configuredWeight?: unknown;
  isFresh?: unknown;
  sourceObservationIds?: unknown;
};

function snapshotInputs(value: Prisma.JsonValue): MacroEventRiskView["components"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as SnapshotInput;
    const weight = Number(row.configuredWeight);
    const rawValue = row.value == null ? null : Number(row.value);
    return [
      {
        code: String(row.metricCode ?? ""),
        value: rawValue != null && Number.isFinite(rawValue) ? rawValue : null,
        weight: Number.isFinite(weight) ? Math.min(1, Math.max(0, weight)) : 0,
        fresh: row.isFresh === true,
        evidenceIds: Array.isArray(row.sourceObservationIds)
          ? row.sourceObservationIds.filter((id): id is string => typeof id === "string")
          : [],
      },
    ];
  });
}

export async function loadMacroEventRisk(
  context: TenantContext,
  window: { from: Date; to: Date },
  now = new Date(),
): Promise<MacroEventRiskView> {
  assertContext(context);
  const [clusters, snapshot] = await Promise.all([
    getPrisma().globalEventCluster.findMany({
      where: { occurredAt: { gte: window.from, lte: window.to } },
      orderBy: { occurredAt: "desc" },
      take: 200,
      include: {
        members: {
          include: {
            observation: {
              include: { provider: { select: { code: true } } },
            },
          },
        },
      },
    }),
    getPrisma().signalSnapshot.findFirst({
      where: { market: "macro", signalType: "global_event_risk", effectiveAt: { lte: window.to } },
      orderBy: { effectiveAt: "desc" },
    }),
  ]);
  const score = number(snapshot?.score);
  const freshWeight = number(snapshot?.coverage) ?? 0;
  const asOf = snapshot?.effectiveAt ?? window.to;
  const components = snapshot ? snapshotInputs(snapshot.inputs) : [];
  const events = clusters.map((cluster) => ({
    id: cluster.id,
    category: cluster.category,
    subcategory: cluster.subcategory,
    title: cluster.title,
    country: cluster.country,
    region: cluster.region,
    occurredAt: cluster.occurredAt.toISOString(),
    severity: number(cluster.normalizedSeverity),
    corroborationCount: cluster.corroborationCount,
    status: cluster.status,
    qualityFlags: strings(cluster.qualityFlags),
    sources: cluster.members.map((member) => ({
      sourceCode: member.observation.provider.code,
      sourceUrl: safeUrl(member.observation.sourceUrl),
      observedAt: member.observation.lastObservedAt.toISOString(),
    })),
  }));
  const categories = new Set(events.map((event) => event.category));
  const factors = categories.has("energy")
    ? { BTC: -0.55, XAU: 0.45 }
    : [...categories].some((category) => ["geopolitical", "sanctions", "trade"].includes(category))
      ? { BTC: -0.4, XAU: 0.6 }
      : { BTC: -0.3, XAU: 0.5 };
  const assetImpacts: MacroEventRiskView["assetImpacts"] =
    score == null
      ? []
      : (["BTC", "XAU"] as const).map((asset) => ({
          asset,
          direction: factors[asset] < 0 ? "headwind" : "tailwind",
          score: Number((score * factors[asset]).toFixed(2)),
          methodology: "macro-event-asset-impact-v1",
        }));
  return {
    generatedAt: now.toISOString(),
    methodology: "macro-event-risk-v1",
    status: availability(score, freshWeight, snapshot?.status ?? null, asOf, now),
    score,
    freshWeight,
    asOf: asOf.toISOString(),
    components,
    timeline: [...events]
      .reverse()
      .flatMap((event) =>
        event.severity == null
          ? []
          : [{ ts: event.occurredAt, score: event.severity, category: event.category }],
      ),
    events,
    assetImpacts,
  };
}

export async function loadEnergyPulse(
  context: TenantContext,
  window: { from: Date; to: Date },
  now = new Date(),
): Promise<EnergyPulseView> {
  assertContext(context);
  const rows = await getPrisma().metricObservation.findMany({
    where: {
      metricDefinition: { code: { in: [...ENERGY_CODES] } },
      effectiveAt: { gte: window.from, lte: window.to },
      qualityStatus: { in: ACCEPTED_QUALITY },
    },
    orderBy: { effectiveAt: "asc" },
    take: 2_000,
    include: {
      metricDefinition: { select: { code: true, unit: true } },
      provider: { select: { code: true } },
      rawSnapshot: { select: { sourceUrl: true } },
    },
  });
  const byDate = new Map<string, { brent: number | null; wti: number | null }>();
  for (const row of rows) {
    const ts = row.effectiveAt.toISOString();
    const point = byDate.get(ts) ?? { brent: null, wti: null };
    const value = number(row.value);
    if (row.metricDefinition.code === "macro.energy.brent_usd_bbl") point.brent = value;
    if (row.metricDefinition.code === "macro.energy.wti_usd_bbl") point.wti = value;
    byDate.set(ts, point);
  }
  const priceSeries = [...byDate.entries()].map(([ts, point]) => ({ ts, ...point }));
  const latest = priceSeries.at(-1);
  const latestTs = latest?.ts ?? null;
  const spread = latest?.brent != null && latest.wti != null ? latest.brent - latest.wti : null;
  const cards: EnergyPulseView["cards"] = [
    {
      code: "brent",
      label: "Brent",
      value: latest?.brent ?? null,
      unit: "USD/barrel",
      asOf: latestTs,
    },
    { code: "wti", label: "WTI", value: latest?.wti ?? null, unit: "USD/barrel", asOf: latestTs },
    { code: "spread", label: "Brent − WTI", value: spread, unit: "USD/barrel", asOf: latestTs },
    { code: "oil_shock", label: "Oil Shock", value: null, unit: "score", asOf: null },
  ];
  return {
    generatedAt: now.toISOString(),
    methodology: "energy-oil-shock-v1",
    status: rows.length ? "LIMITED_DATA" : "UNAVAILABLE",
    oilShockScore: null,
    freshWeight: 0,
    asOf: latestTs ?? window.to.toISOString(),
    cards,
    priceSeries,
    inventoryProduction: [],
    evidence: rows.map((row) => ({
      observationId: row.id,
      metricCode: row.metricDefinition.code,
      sourceCode: row.provider.code,
      sourceUrl: safeUrl(row.rawSnapshot.sourceUrl),
      observedAt: row.observedAt.toISOString(),
    })),
  };
}
