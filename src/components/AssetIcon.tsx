import { cn } from "@/lib/utils";

type AssetIconIdentity = {
  mark: string;
  className: string;
  known: boolean;
};

const KNOWN_IDENTITIES: Record<string, Omit<AssetIconIdentity, "known">> = {
  BTC: { mark: "₿", className: "border-primary/30 bg-primary text-primary-foreground" },
  ETH: { mark: "Ξ", className: "border-foreground/20 bg-foreground text-background" },
  SOL: { mark: "SOL", className: "border-primary/30 bg-gradient-primary text-primary-foreground" },
  BNB: { mark: "BNB", className: "border-primary/30 bg-primary/15 text-primary" },
  XRP: { mark: "XRP", className: "border-foreground/20 bg-muted text-foreground" },
  LTC: { mark: "Ł", className: "border-muted-foreground/30 bg-muted-foreground text-background" },
  ADA: { mark: "ADA", className: "border-primary/30 bg-primary/10 text-primary" },
  LINK: { mark: "LINK", className: "border-primary/30 bg-primary text-primary-foreground" },
  XAU: { mark: "Au", className: "border-primary/40 bg-primary/15 text-primary" },
  VNINDEX: { mark: "VN", className: "border-bear/30 bg-bear text-primary-foreground" },
  VIC: { mark: "VIC", className: "border-bear/30 bg-bear/15 text-bear" },
  VCB: { mark: "VCB", className: "border-bull/30 bg-bull text-primary-foreground" },
  BID: { mark: "BID", className: "border-primary/30 bg-primary text-primary-foreground" },
  FPT: { mark: "FPT", className: "border-primary/30 bg-gradient-primary text-primary-foreground" },
  HPG: { mark: "HPG", className: "border-primary/30 bg-primary/15 text-primary" },
  VNM: { mark: "VNM", className: "border-primary/30 bg-primary text-primary-foreground" },
  GAS: { mark: "GAS", className: "border-bull/30 bg-bull/15 text-bull" },
  MSN: { mark: "MSN", className: "border-bear/30 bg-bear text-primary-foreground" },
  MWG: { mark: "MWG", className: "border-foreground/20 bg-foreground text-background" },
  SSI: { mark: "SSI", className: "border-bear/30 bg-bear/15 text-bear" },
  TCB: { mark: "TCB", className: "border-bear/30 bg-bear text-primary-foreground" },
  MBB: { mark: "MBB", className: "border-primary/30 bg-primary/15 text-primary" },
  CTG: { mark: "CTG", className: "border-primary/30 bg-primary text-primary-foreground" },
  VHM: { mark: "VHM", className: "border-bear/30 bg-bear/15 text-bear" },
  SAB: { mark: "SAB", className: "border-primary/30 bg-primary/15 text-primary" },
};

const FALLBACK_STYLES = [
  "border-primary/25 bg-primary/10 text-primary",
  "border-bull/25 bg-bull/10 text-bull",
  "border-bear/25 bg-bear/10 text-bear",
  "border-foreground/15 bg-muted text-foreground",
] as const;

const SIZE_CLASSES = {
  sm: "size-7 text-[9px]",
  md: "size-9 text-[10px]",
  lg: "size-11 text-xs",
} as const;

function canonicalSymbol(input: string): string {
  return input.trim().toUpperCase();
}

export function assetIconIdentity(input: string): AssetIconIdentity {
  const symbol = canonicalSymbol(input);
  const known = KNOWN_IDENTITIES[symbol];
  if (known) return { ...known, known: true };

  const checksum = [...symbol].reduce((total, character) => total + character.charCodeAt(0), 0);
  return {
    mark: symbol.slice(0, 3) || "?",
    className: FALLBACK_STYLES[checksum % FALLBACK_STYLES.length],
    known: false,
  };
}

export function AssetIcon({
  symbol,
  name,
  size = "md",
  decorative = true,
  className,
}: {
  symbol: string;
  name?: string;
  size?: keyof typeof SIZE_CLASSES;
  decorative?: boolean;
  className?: string;
}) {
  const canonical = canonicalSymbol(symbol);
  const identity = assetIconIdentity(canonical);

  return (
    <span
      data-asset-icon={canonical}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : `${name?.trim() || canonical} (${canonical})`}
      role={decorative ? undefined : "img"}
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full border font-bold leading-none tracking-tight",
        SIZE_CLASSES[size],
        identity.className,
        className,
      )}
    >
      {identity.mark}
    </span>
  );
}
