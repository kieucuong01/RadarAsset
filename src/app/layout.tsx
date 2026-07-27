import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppShell } from "@/components/AppShell";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://radarasset.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "RadarAsset - Global Quant & Insights Platform",
    template: "%s | RadarAsset",
  },
  description:
    "AI-powered financial insights, portfolio analytics, and quantitative backtesting for crypto, equities, and macro markets.",
  authors: [{ name: "RadarAsset" }],
  openGraph: {
    title: "RadarAsset - Global Quant & Insights Platform",
    description: "AI-powered financial insights and quantitative backtesting.",
    type: "website",
    url: siteUrl,
  },
  twitter: {
    card: "summary",
    title: "RadarAsset",
    description: "AI-powered financial insights and quantitative backtesting.",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
