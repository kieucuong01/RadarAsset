import { ArrowUpRight, BrainCircuit, ShieldCheck } from "lucide-react";

import { FreshnessBadge } from "./FreshnessBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BriefingModel } from "@/lib/smart-insights-client";

export function DecisionBrief({
  briefing,
  onEvidence,
}: {
  briefing: BriefingModel | null;
  onEvidence: (id: string) => void;
}) {
  return (
    <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-card via-card to-primary/5">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BrainCircuit className="size-5 text-primary" />
            <CardTitle>Daily Decision Brief</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <FreshnessBadge
              state={
                briefing ? (briefing.status === "complete" ? "fresh" : "partial") : "unavailable"
              }
            />
            {briefing ? <Badge variant="outline">Revision {briefing.revision}</Badge> : null}
          </div>
        </div>
        <CardDescription>
          {briefing
            ? `Point-in-time briefing · ${briefing.localDate} · Data Confidence ${briefing.overallDataConfidence}`
            : "No generated briefing is available. Deterministic market panels remain usable below."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-3">
        {briefing?.primary.length ? (
          briefing.primary.map((item) => (
            <article
              key={item.id}
              className="flex min-h-48 flex-col gap-3 rounded-xl border bg-background/70 p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <Badge variant="secondary">
                  {item.market}
                  {item.asset ? ` · ${item.asset}` : ""}
                </Badge>
                <span className="font-mono text-xs text-muted-foreground">
                  Score {item.score ?? "—"}
                </span>
              </div>
              <h3 className="text-base font-semibold leading-snug">
                {item.headline ?? `${item.regimeLabel} · ${item.signalType}`}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {item.whatChanged ??
                  "AI explanation unavailable; showing deterministic signal only."}
              </p>
              <div className="mt-auto flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <ShieldCheck className="size-3.5" /> {item.confidence}
                </div>
                {item.supportingEvidenceIds[0] ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEvidence(item.supportingEvidenceIds[0])}
                  >
                    Evidence <ArrowUpRight data-icon="inline-end" />
                  </Button>
                ) : null}
              </div>
            </article>
          ))
        ) : (
          <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground lg:col-span-3">
            No ranked change passed the current evidence and coverage gates.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
