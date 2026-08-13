import { CalendarClock, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CalendarModel } from "@/lib/smart-insights-client";

function countdown(value: string | null): string {
  if (!value) return "Time pending";
  const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60_000);
  if (minutes < 0) return "Released";
  if (minutes < 60) return `T-${minutes}m`;
  if (minutes < 1_440) return `T-${Math.round(minutes / 60)}h`;
  return `T-${Math.round(minutes / 1_440)}d`;
}

export function EconomicCalendar({
  events,
  impact,
  onImpactChange,
}: {
  events: CalendarModel[];
  impact: "all" | "high" | "medium" | "low";
  onImpactChange: (impact: "all" | "high" | "medium" | "low") => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CalendarClock className="size-5 text-primary" />
              <CardTitle>CryptoCraft Economic Calendar</CardTitle>
            </div>
            <CardDescription className="mt-2">
              Point-in-time revisions, actual/forecast/previous and source attribution.
            </CardDescription>
          </div>
          <Tabs value={impact} onValueChange={(value) => onImpactChange(value as typeof impact)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="high">High</TabsTrigger>
              <TabsTrigger value="medium">Medium</TabsTrigger>
              <TabsTrigger value="low">Low</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {events.map((event) => (
          <article
            key={event.id}
            className="grid gap-3 rounded-lg border p-3 md:grid-cols-[8rem_1fr_auto] md:items-center"
          >
            <div>
              <p className="font-mono text-sm font-medium">
                {event.eventAt ? new Date(event.eventAt).toLocaleString() : event.eventDate}
              </p>
              <p className="text-xs text-muted-foreground">
                {countdown(event.eventAt)} · {event.currency}
              </p>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{event.event}</h3>
                <Badge variant={event.impact === "high" ? "destructive" : "outline"}>
                  {event.impact}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Actual {event.actual ?? "—"} · Forecast {event.forecast ?? "—"} · Previous{" "}
                {event.previous ?? "—"}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">research_only</Badge>
              <a href={event.sourceUrl} target="_blank" rel="noreferrer" aria-label="Open source">
                <ExternalLink className="size-3.5" />
              </a>
            </div>
          </article>
        ))}
        {events.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No accepted CryptoCraft events in this window.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
