import { CalendarClock, ExternalLink } from "lucide-react";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CalendarModel } from "@/lib/smart-insights-client";

const SAMPLE_CALENDAR_EVENTS: CalendarModel[] = [
  {
    id: "sample-calendar-event",
    event: "Ví dụ: Sự kiện vĩ mô quan trọng",
    country: "US",
    currency: "USD",
    impact: "high",
    actual: null,
    forecast: "Mẫu",
    previous: "Mẫu",
    eventDate: "Dữ liệu mẫu",
    eventAt: null,
    timeStatus: "sample",
    surprise: null,
    portfolioRelevance: "0",
    sourceCode: "cryptocraft-sample",
    sourceUrl: "https://www.cryptocraft.com/calendar",
    observedAt: "sample",
    licenseScope: "research_only",
  },
];

function countdown(value: string | null, locale: "vi" | "en"): string {
  if (!value) return locale === "vi" ? "Chưa xác định giờ" : "Time pending";
  const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60_000);
  if (minutes < 0) return locale === "vi" ? "Đã công bố" : "Released";
  if (minutes < 60) return `T-${minutes}m`;
  if (minutes < 1_440) return `T-${Math.round(minutes / 60)}h`;
  return `T-${Math.round(minutes / 1_440)}d`;
}

export function EconomicCalendar({
  locale,
  events,
  impact,
  onImpactChange,
}: {
  locale: "vi" | "en";
  events: CalendarModel[];
  impact: "all" | "high" | "medium" | "low";
  onImpactChange: (impact: "all" | "high" | "medium" | "low") => void;
}) {
  const visibleEvents = events.length ? events : SAMPLE_CALENDAR_EVENTS;
  return (
    <Card className="overflow-hidden rounded-2xl">
      <CardHeader className="border-b border-border bg-muted/30">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CalendarClock className="size-5 text-primary" />
              <CardTitle>
                {locale === "vi" ? "Lịch kinh tế CryptoCraft" : "CryptoCraft Economic Calendar"}
              </CardTitle>
              <Badge variant="outline">
                {locale === "vi" ? "Dữ liệu hiện tại" : "Current data"}
              </Badge>
              {!events.length ? <DataStatusBadge status="SAMPLE" /> : null}
            </div>
            <CardDescription className="mt-2">
              {locale === "vi"
                ? "Điều chỉnh theo thời điểm công bố, số thực tế/dự báo/trước đó và nguồn dữ liệu."
                : "Point-in-time revisions, actual/forecast/previous and source attribution."}
            </CardDescription>
          </div>
          <Tabs value={impact} onValueChange={(value) => onImpactChange(value as typeof impact)}>
            <TabsList>
              <TabsTrigger value="all">{locale === "vi" ? "Tất cả" : "All"}</TabsTrigger>
              <TabsTrigger value="high">{locale === "vi" ? "Cao" : "High"}</TabsTrigger>
              <TabsTrigger value="medium">{locale === "vi" ? "Vừa" : "Medium"}</TabsTrigger>
              <TabsTrigger value="low">{locale === "vi" ? "Thấp" : "Low"}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent className="flex max-h-[420px] flex-col gap-2 overflow-y-auto p-5">
        {visibleEvents.map((event) => (
          <article
            key={event.id}
            className="grid gap-3 rounded-lg border p-3 md:grid-cols-[8rem_1fr_auto] md:items-center"
          >
            <div>
              <p className="font-mono text-sm font-medium">
                {event.eventAt ? new Date(event.eventAt).toLocaleString() : event.eventDate}
              </p>
              <p className="text-xs text-muted-foreground">
                {countdown(event.eventAt, locale)} · {event.currency}
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
                {locale === "vi" ? "Thực tế" : "Actual"} {event.actual ?? "—"} ·{" "}
                {locale === "vi" ? "Dự báo" : "Forecast"} {event.forecast ?? "—"} ·{" "}
                {locale === "vi" ? "Trước đó" : "Previous"} {event.previous ?? "—"}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">
                {locale === "vi" ? "chỉ nghiên cứu" : "research_only"}
              </Badge>
              <a
                href={event.sourceUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={locale === "vi" ? "Mở nguồn dữ liệu" : "Open source"}
              >
                <ExternalLink className="size-3.5" />
              </a>
            </div>
          </article>
        ))}
      </CardContent>
    </Card>
  );
}
