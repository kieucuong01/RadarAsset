"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FlaskConical,
  Moon,
  Newspaper,
  Sparkles,
  Sun,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { APP_ROUTES, type AppRouteId } from "@/lib/navigation";
import { useTheme } from "@/lib/theme";

const OPEN_EVENT = "radar:command-palette:open";

const routeIcons: Record<AppRouteId, LucideIcon> = {
  insights: Newspaper,
  portfolio: Wallet,
  quantLab: FlaskConical,
};

function openCommandPalette() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(OPEN_EVENT));
  }
}

export function CommandPaletteTrigger() {
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      aria-label="Mở tìm kiếm nhanh"
      className="hidden w-56 items-center gap-2 rounded-full bg-muted/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted sm:flex"
    >
      <Sparkles className="size-4" />
      <span className="flex-1 text-left">Search pages…</span>
      <kbd className="hidden items-center gap-0.5 rounded border border-border bg-background/60 px-1.5 py-0.5 font-mono text-[10px] md:inline-flex">
        Ctrl K
      </kbd>
    </button>
  );
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { theme, toggle } = useTheme();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
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

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search pages or commands…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          {APP_ROUTES.map((route) => {
            const Icon = routeIcons[route.id];
            return (
              <CommandItem key={route.id} onSelect={() => go(route.href)}>
                <Icon className="mr-2 size-4" />
                {route.label}
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem
            onSelect={() => {
              toggle();
              setOpen(false);
            }}
          >
            {theme === "dark" ? <Sun className="mr-2 size-4" /> : <Moon className="mr-2 size-4" />}
            Toggle theme
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
