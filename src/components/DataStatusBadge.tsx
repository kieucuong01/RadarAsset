import { Badge } from "@/components/ui/badge";
import { DATA_STATUS_META, type DataStatus } from "@/lib/mvp-ui";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<DataStatus, string> = {
  SYSTEM: "border-bull/30 bg-bull/10 text-bull",
  SAMPLE: "border-chart-4/30 bg-chart-4/10 text-chart-4",
  SIMULATED: "border-primary/30 bg-primary/10 text-primary",
  UNAVAILABLE: "border-border bg-muted text-muted-foreground",
};

export function DataStatusBadge({
  status,
  detail,
  className,
}: {
  status: DataStatus;
  detail?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const meta = DATA_STATUS_META[status];
  const label = t(`dataStatus.${status}.label`);
  const description = t(`dataStatus.${status}.description`);

  return (
    <Badge
      variant="outline"
      className={cn(
        "whitespace-nowrap font-mono text-[10px] uppercase tracking-wider",
        STATUS_STYLES[status],
        className,
      )}
      title={detail ?? description ?? meta.description}
    >
      {label ?? meta.label}
    </Badge>
  );
}
