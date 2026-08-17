import { ExternalLink, FileSearch } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { EvidenceModel } from "@/lib/smart-insights-client";

import { formatEvidenceDisplayValue } from "./evidence-display-value";

export function EvidenceDrawer({
  evidence,
  open,
  locale,
  onClose,
}: {
  evidence: EvidenceModel | null;
  open: boolean;
  locale: "vi" | "en";
  onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <FileSearch className="size-5 text-primary" />
            <SheetTitle>
              {locale === "vi" ? "Bằng chứng & phương pháp" : "Evidence & Methodology"}
            </SheetTitle>
          </div>
          <SheetDescription>
            {locale === "vi"
              ? "Nguồn gốc theo thời điểm của dữ kiện bản tin đã chọn trong không gian làm việc."
              : "Tenant-scoped point-in-time provenance for the selected briefing fact."}
          </SheetDescription>
        </SheetHeader>
        {evidence ? (
          <div className="mt-6 flex flex-col gap-5">
            <div className="rounded-xl border bg-muted/30 p-4">
              <p className="text-xs text-muted-foreground">{evidence.metricCode}</p>
              <p className="mt-2 font-mono text-3xl font-semibold">
                {formatEvidenceDisplayValue(evidence, locale)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline">
                  {evidence.asset ?? (locale === "vi" ? "Toàn cầu" : "Global")}
                </Badge>
                <Badge variant="outline">{evidence.sourceCode}</Badge>
              </div>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">
                  {locale === "vi" ? "Khoảng hiệu lực" : "Effective period"}
                </dt>
                <dd>
                  {evidence.effectiveStart}
                  <br />
                  {evidence.effectiveEnd}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {locale === "vi" ? "Thời điểm quan sát" : "Observed at"}
                </dt>
                <dd>{evidence.observedAt}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {locale === "vi" ? "Phương pháp" : "Methodology"}
                </dt>
                <dd>{evidence.methodologyVersion}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {locale === "vi" ? "Quy tắc định dạng" : "Formatting rule"}
                </dt>
                <dd>{evidence.formula ?? "—"}</dd>
              </div>
            </dl>
            {evidence.warnings.length ? (
              <div>
                <h3 className="font-semibold">{locale === "vi" ? "Cảnh báo" : "Warnings"}</h3>
                <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
                  {evidence.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {evidence.sourceUrl ? (
              <a
                className="inline-flex items-center gap-2 text-sm font-medium text-primary"
                href={evidence.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                {locale === "vi" ? "Mở nguồn dữ liệu" : "Open source"}{" "}
                <ExternalLink className="size-4" />
              </a>
            ) : null}
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">
            {locale === "vi"
              ? "Bằng chứng đang tải hoặc không còn truy cập được."
              : "Evidence is loading or no longer accessible."}
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}
