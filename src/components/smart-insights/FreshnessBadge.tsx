import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { FreshnessState } from "@/lib/backend/smart-insights-types";

const styles: Record<FreshnessState, string> = {
  fresh: "border-bull/30 bg-bull/10 text-bull",
  stale: "border-chart-4/30 bg-chart-4/10 text-chart-4",
  conflicting: "border-bear/30 bg-bear/10 text-bear",
  partial: "border-primary/30 bg-primary/10 text-primary",
  unavailable: "border-border bg-muted text-muted-foreground",
};

const labels: Record<FreshnessState, string> = {
  fresh: "Fresh",
  stale: "Stale",
  conflicting: "Conflicting",
  partial: "Partial",
  unavailable: "Unavailable",
};

export function FreshnessBadge({ state }: { state: FreshnessState }) {
  return (
    <Badge
      variant="outline"
      className={cn("font-mono text-[10px] uppercase tracking-wider", styles[state])}
    >
      {labels[state]}
    </Badge>
  );
}
