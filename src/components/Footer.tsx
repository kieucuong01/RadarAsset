import Link from "next/link";
import { Radar, ShieldAlert } from "lucide-react";

import { APP_ROUTES } from "@/lib/navigation";

export function Footer() {
  return (
    <footer className="mt-16 border-t border-border bg-card/40">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <Link href="/" className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-xl bg-gradient-primary shadow-glow">
              <Radar className="size-5 text-primary-foreground" />
            </div>
            <span className="text-lg font-bold tracking-tight">RadarAsset</span>
          </Link>
          <p className="mt-3 max-w-sm text-sm text-muted-foreground">
            AI-powered insights and quantitative tools for crypto, equities, gold and macro markets.
          </p>
        </div>

        <div className="min-w-0 md:justify-self-end">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Product
          </h3>
          <ul className="flex flex-col gap-2 text-sm">
            {APP_ROUTES.map((route) => (
              <li key={route.id}>
                <Link href={route.href} className="transition-colors hover:text-primary">
                  {route.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-5 text-xs text-muted-foreground sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="flex max-w-3xl items-start gap-2">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-bear" />
            <p>
              <span className="font-semibold text-foreground">Not financial advice.</span>{" "}
              RadarAsset is for informational and educational purposes only. Markets carry risk;
              past performance does not guarantee future results. Always do your own research.
            </p>
          </div>
          <p className="shrink-0">© {new Date().getFullYear()} RadarAsset. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
