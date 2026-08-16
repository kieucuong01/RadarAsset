import { BRAND, BRAND_COLORS } from "@/lib/brand";
import { cn } from "@/lib/utils";

type DataVestLogoProps = {
  className?: string;
  markClassName?: string;
  lockup?: boolean;
  decorative?: boolean;
};

export function DataVestLogo({
  className,
  markClassName,
  lockup = false,
  decorative = true,
}: DataVestLogoProps) {
  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-2", className)}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : BRAND.name}
      role={decorative ? undefined : "img"}
    >
      <svg
        viewBox="0 0 64 64"
        className={cn("size-9 shrink-0", markClassName)}
        aria-hidden="true"
        focusable="false"
      >
        <rect x="2" y="2" width="60" height="60" rx="17" fill={BRAND_COLORS.cobalt} />
        <path d="M19 15v34" stroke={BRAND_COLORS.white} strokeWidth="5" strokeLinecap="round" />
        <path
          d="M25 17C39 17 46 23 46 32S39 47 25 47"
          fill="none"
          stroke={BRAND_COLORS.amber}
          strokeWidth="4"
          strokeLinecap="round"
        />
        <circle cx="29" cy="18" r="2.8" fill={BRAND_COLORS.white} />
        <circle cx="42" cy="27" r="3.3" fill={BRAND_COLORS.white} />
        <circle cx="42" cy="39" r="6.5" fill={BRAND_COLORS.amber} opacity="0.24" />
        <circle
          cx="42"
          cy="39"
          r="3.8"
          fill={BRAND_COLORS.amber}
          stroke={BRAND_COLORS.white}
          strokeWidth="1.6"
          data-evidence-node="focus"
        />
        <circle cx="29" cy="47" r="2.5" fill={BRAND_COLORS.white} />
      </svg>

      {lockup ? (
        <span className="whitespace-nowrap text-lg font-bold tracking-tight text-foreground">
          Data<span className="text-[#8a5a00] dark:text-[#f2b84b]">Vest</span>
        </span>
      ) : null}
    </span>
  );
}
