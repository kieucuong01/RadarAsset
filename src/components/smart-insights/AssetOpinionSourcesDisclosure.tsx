"use client";

import { useState } from "react";
import { ArrowUpRight, ChevronDown, Database } from "lucide-react";

import { FreshnessBadge } from "./FreshnessBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AssetOpinionModel } from "@/lib/smart-insights-client";
import { formatMetricValue } from "@/lib/financial-format";
import { cn } from "@/lib/utils";

type Locale = "vi" | "en";

const DATE_FORMATTERS: Record<Locale, Intl.DateTimeFormat> = {
  vi: new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }),
  en: new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "2-digit" }),
};

export function AssetOpinionSourcesDisclosure({
  opinion,
  locale,
  onEvidence,
}: {
  opinion: AssetOpinionModel;
  locale: Locale;
  onEvidence: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const regionId = `asset-opinion-sources-${opinion.symbol.toLowerCase()}`;
  const inputByEvidenceId = new Map(
    opinion.decisionInputs
      .filter((input) => input.evidenceId)
      .map((input) => [input.evidenceId, input]),
  );
  const evidenceValue = (evidence: AssetOpinionModel["evidence"][number]) => {
    const input = inputByEvidenceId.get(evidence.id);
    return input
      ? formatMetricValue(input.rawValue, { locale, unit: input.unit })
      : evidence.displayValue;
  };

  return (
    <section className="border-b bg-muted/10 px-4 py-3 sm:px-6">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((value) => !value)}
      >
        <Database data-icon="inline-start" aria-hidden="true" />
        {locale === "vi" ? "Nguồn dữ liệu" : "Data sources"} ({opinion.evidence.length})
        <ChevronDown
          data-icon="inline-end"
          className={cn("transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </Button>

      {open ? (
        <div
          id={regionId}
          data-testid="asset-opinion-sources"
          className="mt-3 max-h-72 overflow-y-auto rounded-xl border bg-background"
        >
          {opinion.evidence.length ? (
            <>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{locale === "vi" ? "Chỉ số" : "Metric"}</TableHead>
                      <TableHead>{locale === "vi" ? "Giá trị" : "Value"}</TableHead>
                      <TableHead>{locale === "vi" ? "Vai trò" : "Impact"}</TableHead>
                      <TableHead>{locale === "vi" ? "Nguồn" : "Source"}</TableHead>
                      <TableHead>{locale === "vi" ? "Cập nhật" : "As of"}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {opinion.evidence.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.metricCode}</TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {evidenceValue(item)}
                          {item.delta ? ` · Δ ${item.delta}` : ""}
                          {item.percentile ? ` · Pctl ${item.percentile}` : ""}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{item.impact}</Badge>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => onEvidence(item.id)}>
                            {item.sourceCode}
                            <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
                          </Button>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <time dateTime={item.effectiveAt}>
                              {DATE_FORMATTERS[locale].format(new Date(item.effectiveAt))}
                            </time>
                            <FreshnessBadge state={item.freshness} />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="grid gap-3 p-3 md:hidden">
                {opinion.evidence.map((item) => (
                  <article
                    key={item.id}
                    className="flex flex-col gap-3 rounded-xl border bg-background p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <strong className="text-sm">{item.metricCode}</strong>
                      <FreshnessBadge state={item.freshness} />
                    </div>
                    <p className="font-mono text-lg tabular-nums">{evidenceValue(item)}</p>
                    <div className="flex items-center justify-between gap-3">
                      <Badge variant="outline">{item.impact}</Badge>
                      <Button variant="ghost" size="sm" onClick={() => onEvidence(item.id)}>
                        {item.sourceCode}
                        <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">
              {locale === "vi"
                ? "Chưa có bằng chứng số đạt chuẩn hiển thị."
                : "No qualified numerical evidence is available."}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
