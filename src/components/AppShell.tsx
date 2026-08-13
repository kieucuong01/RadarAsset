"use client";

import { ThemeProvider } from "@/lib/theme";
import { I18nProvider } from "@/lib/i18n/provider";
import { Header } from "@/components/Header";
import { TickerTape } from "@/components/TickerTape";
import { Footer } from "@/components/Footer";
import { CommandPalette } from "@/components/CommandPalette";
import { Toaster } from "@/components/ui/sonner";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <ThemeProvider>
        <div className="min-h-screen flex flex-col bg-background text-foreground">
          <Header />
          <TickerTape />
          <div className="min-w-0 flex-1">{children}</div>
          <Footer />
          <CommandPalette />
          <Toaster />
        </div>
      </ThemeProvider>
    </I18nProvider>
  );
}
