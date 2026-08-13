import { Activity, DatabaseZap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { HealthModel } from "@/lib/smart-insights-client";

export function DataHealthPanel({ sources }: { sources: HealthModel["sources"] }) {
  const available = sources.filter((source) => source.lastStatus === "validated").length;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <DatabaseZap className="size-5 text-primary" />
          <CardTitle>Data Health</CardTitle>
        </div>
        <CardDescription>
          {available} of {sources.length} registered sources have accepted observations.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {sources.map((source) => (
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
