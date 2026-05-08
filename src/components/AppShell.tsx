import { ThemeProvider } from "@/lib/theme";
import { Header } from "@/components/Header";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <div className="min-h-screen bg-background text-foreground">
        <Header />
        {children}
      </div>
    </ThemeProvider>
  );
}
