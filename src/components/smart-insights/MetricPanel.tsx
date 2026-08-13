import { ExternalLink } from "lucide-react";

import { FreshnessBadge } from "./FreshnessBadge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { MetricModel } from "@/lib/smart-insights-client";

export function MetricPanel({
  title,
  description,
  metrics,
}: {
  title: string;
  description: string;
  metrics: MetricModel[];
}) {
  const latest = new Map<string, MetricModel>();
  for (const row of metrics)
    if (!latest.has(`${row.metricCode}:${row.asset ?? "global"}`))
      latest.set(`${row.metricCode}:${row.asset ?? "global"}`, row);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[...latest.values()].map((row) => (
          <article key={row.observationId} className="flex flex-col gap-2 rounded-lg border p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 truncate text-xs text-muted-foreground" title={row.metricCode}>
                {row.metricCode}
              </p>
              <FreshnessBadge state={row.freshness} />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-xl font-semibold">{row.value}</span>
              <span className="text-xs text-muted-foreground">{row.unit}</span>
            </div>
            <div className="mt-auto flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {row.asset ?? "Global"} · {row.sourceCode}
              </span>
              <a
                href={row.sourceUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${row.sourceCode}`}
              >
                <ExternalLink className="size-3.5" />
              </a>
            </div>
          </article>
        ))}
        {latest.size === 0 ? (
          <p className="text-sm text-muted-foreground sm:col-span-2 xl:col-span-3">
            No accepted observations in the selected window.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
