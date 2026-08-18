"use client";

import { cn } from "@/lib/utils";

export function TopLoadingBar({ active, label }: { active: boolean; label: string }) {
  if (!active) return null;

  return (
    <div
      aria-label={label}
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden bg-primary/15"
      role="progressbar"
    >
      <div
        aria-hidden="true"
        className={cn(
          "h-full w-1/3 bg-primary shadow-[0_0_8px_var(--primary)]",
          "animate-[datavest-top-progress_1.2s_ease-in-out_infinite]",
        )}
      />
    </div>
  );
}
