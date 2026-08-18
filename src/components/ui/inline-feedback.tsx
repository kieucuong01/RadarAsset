"use client";

import { AlertCircle, AlertTriangle, CheckCircle2, LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";

export type InlineFeedbackTone = "loading" | "success" | "warning" | "error";
export type InlineFeedbackState = {
  tone: InlineFeedbackTone;
  message: string;
};

const toneStyles: Record<InlineFeedbackTone, string> = {
  loading: "border-primary/20 bg-primary/5 text-primary",
  success: "border-bull/20 bg-bull/5 text-bull",
  warning: "border-accent-foreground/20 bg-accent/40 text-accent-foreground",
  error: "border-bear/20 bg-bear/5 text-bear",
};

export function InlineFeedback({
  tone,
  message,
  className,
}: {
  tone: InlineFeedbackTone;
  message: string;
  className?: string;
}) {
  if (!message) return null;

  const Icon =
    tone === "loading"
      ? LoaderCircle
      : tone === "success"
        ? CheckCircle2
        : tone === "warning"
          ? AlertTriangle
          : AlertCircle;

  return (
    <div
      role={tone === "error" || tone === "warning" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
        toneStyles[tone],
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("mt-0.5 size-4 shrink-0", tone === "loading" && "animate-spin")}
      />
      <span>{message}</span>
    </div>
  );
}
