"use client";

import { LoaderCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Props = {
  locale: "vi" | "en";
  today: string;
  dates: string[];
  value: string;
  loading: boolean;
  onChange: (date: string) => void;
};

export function analysisDateOptions(today: string, dates: string[]): string[] {
  return [...new Set([today, ...dates])];
}

function displayDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function AnalysisDateControl({ locale, today, dates, value, loading, onChange }: Props) {
  const historical = value !== today;
  const label = locale === "vi" ? "Ngày phân tích" : "Analysis date";

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-analysis-date={value}
      aria-busy={loading}
    >
      <span className="text-sm font-medium">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-44" aria-label={label}>
          <SelectValue>{displayDate(value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {analysisDateOptions(today, dates).map((date) => (
            <SelectItem key={date} value={date}>
              {displayDate(date)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant={historical ? "outline" : "secondary"}
        onClick={() => onChange(today)}
        disabled={!historical}
      >
        {locale === "vi" ? "Hôm nay" : "Today"}
      </Button>
      {historical ? (
        <Badge variant="outline">{locale === "vi" ? "Lịch sử" : "Historical"}</Badge>
      ) : null}
      {loading ? (
        <LoaderCircle
          className="size-4 animate-spin text-muted-foreground"
          aria-label={locale === "vi" ? "Đang tải phân tích" : "Loading analysis"}
        />
      ) : null}
    </div>
  );
}
