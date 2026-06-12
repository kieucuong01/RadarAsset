import { Link, useRouterState } from "@tanstack/react-router";
import { Radar, Bell, Sun, Moon, Newspaper, FlaskConical, Wallet } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { CommandPaletteTrigger } from "@/components/CommandPalette";

const nav = [
  { to: "/", label: "Smart Insights", icon: Newspaper },
  { to: "/quant-lab", label: "Quant Lab", icon: FlaskConical },
  { to: "/portfolio", label: "Mock Portfolio", icon: Wallet },
] as const;

export function Header() {
  const { theme, toggle } = useTheme();
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/70 border-b border-border">
      <div className="max-w-7xl mx-auto h-16 px-4 sm:px-6 flex items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-primary grid place-items-center shadow-glow">
            <Radar className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-bold text-lg tracking-tight">RadarAsset</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1 bg-muted/60 rounded-full p-1">
          {nav.map((item) => {
            const active = path === item.to;
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  active
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <CommandPaletteTrigger />
          <button
            aria-label="Notifications"
            className="relative w-9 h-9 grid place-items-center rounded-full bg-muted/60 hover:bg-muted transition-colors"
          >
            <Bell className="w-4 h-4" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-bear ring-2 ring-background" />
          </button>
          <button
            onClick={toggle}
            aria-label="Toggle theme"
            className="w-9 h-9 grid place-items-center rounded-full bg-muted/60 hover:bg-muted transition-colors"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <div className="w-9 h-9 rounded-full bg-gradient-primary grid place-items-center text-primary-foreground text-sm font-semibold">
            RA
          </div>
        </div>
      </div>
    </header>
  );
}
