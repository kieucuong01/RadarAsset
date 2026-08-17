import { Activity, DatabaseZap } from "lucide-react";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { HealthModel } from "@/lib/smart-insights-client";

const SAMPLE_HEALTH_SOURCES: HealthModel["sources"] = [
  {
    sourceCode: "sample-api-source",
    sourceName: "Ví dụ nguồn API",
    market: "crypto",
    collectionMode: "api",
    parserVersion: "sample",
    lastEffectiveAt: null,
    lastObservedAt: null,
    lastStatus: "unavailable",
    lastErrorCode: null,
    freshness: "UNAVAILABLE",
  },
  {
    sourceCode: "sample-scrapling-source",
    sourceName: "Ví dụ nguồn Scrapling",
    market: "macro",
    collectionMode: "scrapling",
    parserVersion: "sample",
    lastEffectiveAt: null,
    lastObservedAt: null,
    lastStatus: "unavailable",
    lastErrorCode: null,
    freshness: "UNAVAILABLE",
  },
];

export function DataHealthPanel({ sources }: { sources: HealthModel["sources"] }) {
  const available = sources.filter((source) => source.lastStatus === "validated").length;
  const visibleSources = sources.length ? sources : SAMPLE_HEALTH_SOURCES;
  return (
    <Card className="overflow-hidden rounded-2xl">
      <CardHeader className="border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <DatabaseZap className="size-5 text-primary" />
          <CardTitle>Sức khỏe dữ liệu</CardTitle>
          {!sources.length ? <DataStatusBadge status="SAMPLE" /> : null}
        </div>
        <CardDescription>
          {sources.length
            ? `${available} of ${sources.length} registered sources have accepted observations.`
            : "Dữ liệu mẫu minh họa trạng thái nguồn; chưa có source health được tải."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 p-5 md:grid-cols-2 xl:grid-cols-3">
        {visibleSources.map((source) => (
          <div
            key={source.sourceCode}
            className="flex items-start justify-between gap-3 rounded-lg border p-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium" title={source.sourceName}>
                {source.sourceName}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {source.market} · {source.collectionMode} ·{" "}
                {source.lastErrorCode ?? source.lastStatus}
              </p>
            </div>
            <Badge variant={source.freshness === "FRESH" ? "default" : "outline"}>
              <Activity className="mr-1 size-3" />
              {source.freshness}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
