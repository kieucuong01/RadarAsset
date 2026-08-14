"use client";

import { ExternalLink } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import type { MacroEventRiskModel } from "@/lib/smart-insights-client";

import type { MacroPulseState } from "./MacroQuantPulseTabs";

function dateLabel(value: string, locale: "vi" | "en") {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function EventRiskPanel({
  data,
  state,
  locale,
}: {
  data: MacroEventRiskModel | null;
  state: MacroPulseState;
  locale: "vi" | "en";
}) {
  if (state === "loading" || state === "idle")
    return <div className="h-[420px] animate-pulse rounded-2xl border bg-muted/30" />;
  if (!data || state === "failed") {
    return (
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Macro Event Risk</h3>
          <DataStatusBadge status="UNAVAILABLE" />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Chưa có cụm sự kiện đa nguồn đạt kiểm định; hệ thống không tạo dữ liệu thay thế.
        </p>
      </section>
    );
  }
  const impacts = new Map(data.assetImpacts.map((impact) => [impact.asset, impact]));
  const cards = [
    { label: "Event Risk", value: data.score == null ? "—" : data.score.toFixed(1), unit: "/100" },
    { label: "Fresh weight", value: `${Math.round(data.freshWeight * 100)}`, unit: "%" },
    { label: "BTC impact", value: impacts.get("BTC")?.score.toFixed(1) ?? "—", unit: "score" },
    { label: "XAU impact", value: impacts.get("XAU")?.score.toFixed(1) ?? "—", unit: "score" },
  ];
  return (
    <section className="min-w-0 space-y-5 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Macro Event Risk → BTC/XAU</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Stress intensity, không phải dự báo hướng giá · {data.methodology}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DataStatusBadge status={data.status === "UNAVAILABLE" ? "UNAVAILABLE" : "SYSTEM"} />
          <span className="text-xs font-medium text-muted-foreground">{data.status}</span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <article key={card.label} className="rounded-xl border bg-background/50 p-4">
            <p className="text-xs text-muted-foreground">{card.label}</p>
            <p className="mt-2 font-mono text-xl font-semibold tabular-nums">
              {card.value}{" "}
              <span className="text-xs font-normal text-muted-foreground">{card.unit}</span>
            </p>
          </article>
        ))}
      </div>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.6fr)]">
        <div className="min-w-0 rounded-xl border bg-background/40 p-3">
          <div className="mb-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
            <span>Event severity trend · unit: score /100</span>
            <time dateTime={data.asOf}>As of {dateLabel(data.asOf, locale)}</time>
          </div>
          <div className="h-[260px] min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.timeline} margin={{ top: 12, right: 12, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.24} />
                <XAxis
                  dataKey="ts"
                  tickFormatter={(value: string) => dateLabel(value, locale)}
                  fontSize={11}
                  minTickGap={28}
                />
                <YAxis domain={[0, 100]} fontSize={11} />
                <Tooltip
                  labelFormatter={(value) => dateLabel(String(value), locale)}
                  formatter={(value) => [Number(value), "Severity /100"]}
                />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="var(--chart-1)"
                  strokeWidth={2.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-xl border bg-background/40 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Components
          </p>
          <dl className="mt-3 space-y-3">
            {data.components.map((component) => (
              <div key={component.code} className="flex items-center justify-between gap-3 text-sm">
                <dt className="min-w-0 truncate" title={component.code}>
                  {component.code.replace("macro.event.", "")}
                </dt>
                <dd className="font-mono tabular-nums">
                  {component.value ?? "—"} · {Math.round(component.weight * 100)}%
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {data.events.slice(0, 20).map((event) => (
          <div key={event.id} className="rounded-xl border bg-background/40 p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <strong>{event.title}</strong>
              <span className="font-mono">{event.severity.toFixed(0)}/100</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {event.country ?? "Global"} · {dateLabel(event.occurredAt, locale)} ·{" "}
              {event.corroborationCount} nguồn
            </p>
          </div>
        ))}
      </div>
      <div className="hidden overflow-x-auto rounded-xl border md:block">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">Sự kiện</th>
              <th className="px-4 py-2 text-left">Loại</th>
              <th className="px-4 py-2 text-left">Khu vực</th>
              <th className="px-4 py-2 text-right">Severity</th>
              <th className="px-4 py-2 text-right">Nguồn</th>
            </tr>
          </thead>
          <tbody>
            {data.events.slice(0, 50).map((event) => (
              <tr key={event.id} className="border-t">
                <td className="px-4 py-2 font-medium">{event.title}</td>
                <td className="px-4 py-2">{event.category}</td>
                <td className="px-4 py-2">{event.country ?? "Global"}</td>
                <td className="px-4 py-2 text-right font-mono">{event.severity.toFixed(0)}</td>
                <td className="px-4 py-2 text-right">
                  {event.sources[0]?.sourceUrl ? (
                    <a
                      href={event.sources[0].sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary"
                    >
                      {event.corroborationCount}
                      <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    event.corroborationCount
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
