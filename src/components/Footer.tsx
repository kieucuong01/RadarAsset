import Link from "next/link";
import { Radar, Github, Twitter, ShieldAlert } from "lucide-react";

export function Footer() {
  return (
    <footer className="mt-16 border-t border-border bg-card/40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Link href="/" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-primary grid place-items-center shadow-glow">
              <Radar className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg tracking-tight">RadarAsset</span>
          </Link>
          <p className="mt-3 text-sm text-muted-foreground max-w-sm">
            AI-powered insights and quantitative tools for crypto, equities, gold and macro markets.
          </p>
          <div className="mt-4 flex gap-2">
            <a
              href="#"
              aria-label="Twitter"
              className="w-9 h-9 grid place-items-center rounded-full border border-border hover:bg-muted transition-colors"
            >
              <Twitter className="w-4 h-4" />
            </a>
            <a
              href="#"
              aria-label="GitHub"
              className="w-9 h-9 grid place-items-center rounded-full border border-border hover:bg-muted transition-colors"
            >
              <Github className="w-4 h-4" />
            </a>
          </div>
        </div>

        <FooterCol
          title="Product"
          links={[
            { to: "/", label: "Smart Insights" },
            { to: "/quant-lab", label: "Quant Lab" },
            { to: "/portfolio", label: "Mock Portfolio" },
          ]}
        />
        <FooterCol
          title="Resources"
          links={[
            { to: "/", label: "Documentation" },
            { to: "/", label: "API Reference" },
            { to: "/", label: "Changelog" },
            { to: "/", label: "Status" },
          ]}
        />
        <FooterCol
          title="Company"
          links={[
            { to: "/", label: "About" },
            { to: "/", label: "Careers" },
            { to: "/", label: "Privacy" },
            { to: "/", label: "Terms" },
          ]}
        />
      </div>

      <div className="border-t border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-start gap-2 max-w-3xl">
            <ShieldAlert className="w-4 h-4 text-bear shrink-0 mt-0.5" />
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

function FooterCol({ title, links }: { title: string; links: { to: string; label: string }[] }) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
        {title}
      </h3>
      <ul className="space-y-2 text-sm">
        {links.map((l) => (
          <li key={l.label}>
            <a href={l.to} className="hover:text-primary transition-colors">
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
