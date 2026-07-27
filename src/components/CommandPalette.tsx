"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Newspaper,
  FlaskConical,
  Wallet,
  TrendingUp,
  Sparkles,
  Sun,
  Moon,
  Bitcoin,
  LineChart,
  Coins,
} from "lucide-react";
import { useTheme } from "@/lib/theme";
import { toast } from "sonner";

const OPEN_EVENT = "radar:command-palette:open";

export function openCommandPalette() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(OPEN_EVENT));
  }
}

export function CommandPaletteTrigger() {
  return (
    <button
      onClick={openCommandPalette}
      className="hidden sm:flex items-center gap-2 bg-muted/60 hover:bg-muted rounded-full px-3 py-1.5 w-56 text-sm text-muted-foreground transition-colors"
    >
      <Sparkles className="w-4 h-4" />
      <span className="flex-1 text-left">Search anything…</span>
      <kbd className="hidden md:inline-flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded border border-border bg-background/60">
        ⌘K
      </kbd>
    </button>
  );
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { theme, toggle } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  const go = (to: string) => {
    setOpen(false);
    router.push(to);
  };

  const run = (label: string) => {
    setOpen(false);
    toast.success(label);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command, asset, or page…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => go("/")}>
            <Newspaper className="mr-2 h-4 w-4" /> Smart Insights
            <CommandShortcut>G I</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/quant-lab")}>
            <FlaskConical className="mr-2 h-4 w-4" /> Quant Lab
            <CommandShortcut>G Q</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/portfolio")}>
            <Wallet className="mr-2 h-4 w-4" /> Mock Portfolio
            <CommandShortcut>G P</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Assets">
          <CommandItem onSelect={() => go("/asset/BTC")}>
            <Bitcoin className="mr-2 h-4 w-4 text-bull" /> Bitcoin · BTC
          </CommandItem>
          <CommandItem onSelect={() => go("/asset/ETH")}>
            <Coins className="mr-2 h-4 w-4 text-primary" /> Ethereum · ETH
          </CommandItem>
          <CommandItem onSelect={() => go("/asset/NVDA")}>
            <LineChart className="mr-2 h-4 w-4 text-bull" /> NVIDIA · NVDA
          </CommandItem>
          <CommandItem onSelect={() => go("/asset/SPY")}>
            <LineChart className="mr-2 h-4 w-4" /> S&P 500 ETF · SPY
          </CommandItem>
          <CommandItem onSelect={() => go("/asset/GOLD")}>
            <Coins className="mr-2 h-4 w-4 text-chart-4" /> Gold Spot · GOLD
          </CommandItem>
          <CommandItem onSelect={() => go("/asset/VN30")}>
            <TrendingUp className="mr-2 h-4 w-4" /> VN30 Index
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run("Backtest triggered")}>
            <FlaskConical className="mr-2 h-4 w-4" /> Run new backtest
          </CommandItem>
          <CommandItem onSelect={() => run("AI Briefing refreshing…")}>
            <Sparkles className="mr-2 h-4 w-4" /> Refresh AI briefing
          </CommandItem>
          <CommandItem
            onSelect={() => {
              toggle();
              setOpen(false);
            }}
          >
            {theme === "dark" ? (
              <Sun className="mr-2 h-4 w-4" />
            ) : (
              <Moon className="mr-2 h-4 w-4" />
            )}
            Toggle theme
            <CommandShortcut>⌘J</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
