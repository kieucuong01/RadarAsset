"use client";

import { ArrowDownRight, ArrowUpRight, Calculator, ExternalLink } from "lucide-react";

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
import { cn } from "@/lib/utils";

import { metricLabel, pillarLabel } from "./asset-opinion-labels";

type Locale = "vi" | "en";

function scoreLabel(value: string, locale: Locale) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US", {
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(parsed);
}

function HighlightGroup({
  title,
  ids,
  opinion,
  locale,
  kind,
  onEvidence,
}: {
  title: string;
  ids: string[];
  opinion: AssetOpinionModel;
  locale: Locale;
  kind: "support" | "contradiction";
  onEvidence: (id: string) => void;
}) {
  const evidenceById = new Map(opinion.evidence.map((row) => [row.id, row]));
  const inputById = new Map(opinion.decisionInputs.map((row) => [row.evidenceId, row]));
  const rows = ids.flatMap((id) => {
    const evidence = evidenceById.get(id);
    const input = inputById.get(id);
    return evidence && input ? [{ evidence, input }] : [];
  });
  const Icon = kind === "support" ? ArrowUpRight : ArrowDownRight;

  return (
    <section
      className={cn(
        "min-w-0 rounded-xl border p-4",
        kind === "support" ? "border-bull/20 bg-bull/5" : "border-bear/20 bg-bear/5",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-semibold">{title}</h4>
        <Badge variant="outline">{rows.length}</Badge>
      </div>
      {rows.length ? (
        <ol className="mt-3 grid gap-2">
          {rows.map(({ evidence, input }) => (
            <li key={evidence.id} className="rounded-lg border bg-background/70 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {metricLabel(input.metricCode, locale)}
                  </p>
                  <p className="mt-1 font-mono text-base font-semibold tabular-nums">
                    {evidence.displayValue}
                  </p>
                </div>
                <span
                  className={cn(
                    "flex shrink-0 items-center gap-1 font-mono text-sm font-semibold tabular-nums",
                    kind === "support" ? "text-bull" : "text-bear",
                  )}
                  aria-label={`${locale === "vi" ? "Đóng góp" : "Contribution"} ${scoreLabel(input.contribution, locale)}`}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {scoreLabel(input.contribution, locale)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {locale === "vi" ? "Điểm chuẩn hóa" : "Normalized"}:{" "}
                  {scoreLabel(input.normalizedScore, locale)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  onClick={() => onEvidence(evidence.id)}
                >
                  {evidence.sourceCode}
                  <ExternalLink data-icon="inline-end" />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          {kind === "contradiction"
            ? locale === "vi"
              ? "Chưa có số liệu phản biện đủ lớn."
              : "No material counter-signal."
            : locale === "vi"
              ? "Chưa có số liệu đóng góp đạt chuẩn."
              : "No qualified contributor."}
        </p>
      )}
    </section>
  );
}

export function AssetOpinionCalculation({
  opinion,
  locale,
  onEvidence,
}: {
  opinion: AssetOpinionModel;
  locale: Locale;
  onEvidence: (id: string) => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <HighlightGroup
          title={locale === "vi" ? "Vì các số liệu này" : "Supported by these numbers"}
          ids={opinion.supportingEvidenceIds}
          opinion={opinion}
          locale={locale}
          kind="support"
          onEvidence={onEvidence}
        />
        <HighlightGroup
          title={locale === "vi" ? "Yếu tố phản biện" : "Counter-signals"}
          ids={opinion.contradictingEvidenceIds}
          opinion={opinion}
          locale={locale}
          kind="contradiction"
          onEvidence={onEvidence}
        />
      </div>

      <details className="group rounded-xl border bg-background/60">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 py-3 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Calculator className="size-4 text-primary" aria-hidden="true" />
          {locale === "vi" ? "Cách tính chi tiết" : "Detailed calculation"}
          <Badge variant="secondary" className="ml-auto">
            {opinion.decisionInputs.length} input
          </Badge>
        </summary>
        <div className="border-t p-4">
          <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <p className="font-medium">
              {locale === "vi"
                ? "Điểm tài sản = Σ(điểm trụ cột × trọng số) ÷ độ phủ dữ liệu"
                : "Asset score = Σ(pillar score × weight) ÷ data coverage"}
            </p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              Σ contribution = {scoreLabel(opinion.totalContribution, locale)} · coverage ={" "}
              {Math.round(Number(opinion.dataCoverage) * 100)}% · score ={" "}
              {opinion.quantScore ?? "—"}
            </p>
          </div>
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{locale === "vi" ? "Chỉ số" : "Metric"}</TableHead>
                  <TableHead>{locale === "vi" ? "Dữ liệu gốc" : "Raw"}</TableHead>
                  <TableHead>{locale === "vi" ? "Điểm chuẩn hóa" : "Normalized"}</TableHead>
                  <TableHead>{locale === "vi" ? "Trọng số input" : "Input weight"}</TableHead>
                  <TableHead>{locale === "vi" ? "Trọng số trụ cột" : "Pillar weight"}</TableHead>
                  <TableHead className="text-right">
                    {locale === "vi" ? "Đóng góp" : "Contribution"}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {opinion.decisionInputs.map((input) => (
                  <TableRow key={input.evidenceId}>
                    <TableCell>
                      <p className="font-medium">{metricLabel(input.metricCode, locale)}</p>
                      <p className="text-xs text-muted-foreground">
                        {pillarLabel(input.pillarCode, locale)} · {input.normalizationMethod}
                        {input.lookback ? ` · ${input.lookback}` : ""}
                      </p>
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {input.rawValue} {input.unit}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {scoreLabel(input.normalizedScore, locale)}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {scoreLabel(String(Number(input.inputWeight) * 100), locale)}%
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {scoreLabel(String(Number(input.pillarWeight) * 100), locale)}%
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono font-semibold tabular-nums",
                        Number(input.contribution) >= 0 ? "text-bull" : "text-bear",
                      )}
                    >
                      {scoreLabel(input.contribution, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </details>
    </div>
  );
}
