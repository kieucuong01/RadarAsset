"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FlaskConical,
  Menu,
  Moon,
  Newspaper,
  Radar,
  Sun,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { CommandPaletteTrigger } from "@/components/CommandPalette";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { APP_ROUTES, type AppRouteId } from "@/lib/navigation";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const routeIcons: Record<AppRouteId, LucideIcon> = {
  insights: Newspaper,
  portfolio: Wallet,
  quantLab: FlaskConical,
};

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const path = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <div className="grid size-9 place-items-center rounded-xl bg-gradient-primary shadow-glow">
            <Radar className="size-5 text-primary-foreground" />
          </div>
          <span className="text-lg font-bold tracking-tight">RadarAsset</span>
        </Link>

        <nav
          aria-label="Điều hướng chính"
          className="hidden items-center gap-1 rounded-full bg-muted/60 p-1 lg:flex"
        >
          {APP_ROUTES.map((route) => {
            const active = path === route.href;
            const Icon = routeIcons[route.id];
            return (
              <Link
                key={route.id}
                href={route.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  active
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {route.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <CommandPaletteTrigger />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label="Đổi giao diện sáng tối"
            className="size-11 rounded-full bg-muted/60 hover:bg-muted sm:size-9"
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </Button>

          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Mở menu chính"
                className="size-11 rounded-full bg-muted/60 hover:bg-muted lg:hidden"
              >
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className="w-[min(20rem,calc(100vw-2rem))] [&>button]:grid [&>button]:size-11 [&>button]:place-items-center"
            >
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 text-left">
                  <span className="grid size-9 place-items-center rounded-xl bg-gradient-primary">
                    <Radar className="size-5 text-primary-foreground" />
                  </span>
                  RadarAsset
                </SheetTitle>
                <SheetDescription className="text-left">Chọn khu vực bạn muốn mở.</SheetDescription>
              </SheetHeader>
              <nav aria-label="Điều hướng mobile" className="mt-6 flex flex-col gap-2">
                {APP_ROUTES.map((route) => {
                  const active = path === route.href;
                  const Icon = routeIcons[route.id];
                  return (
                    <Button
                      key={route.id}
                      asChild
                      variant={active ? "secondary" : "ghost"}
                      className="h-11 w-full justify-start rounded-xl px-4"
                    >
                      <Link
                        href={route.href}
                        aria-current={active ? "page" : undefined}
                        onClick={() => setMobileOpen(false)}
                      >
                        <Icon data-icon="inline-start" />
                        {route.mobileLabel}
                      </Link>
                    </Button>
                  );
                })}
              </nav>
            </SheetContent>
          </Sheet>

          <div className="grid size-9 place-items-center rounded-full bg-gradient-primary text-sm font-semibold text-primary-foreground">
            RA
          </div>
        </div>
      </div>
    </header>
  );
}
