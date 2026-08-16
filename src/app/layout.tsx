import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppShell } from "@/components/AppShell";
import { BRAND, resolveSiteUrl } from "@/lib/brand";
import { buildBrandJsonLd, safeJsonLd } from "@/lib/seo";
import "./globals.css";

const siteUrl = resolveSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${BRAND.name} | ${BRAND.descriptor}`,
    template: `%s | ${BRAND.name}`,
  },
  description: BRAND.description,
  applicationName: BRAND.name,
  authors: [{ name: BRAND.name }],
  creator: BRAND.name,
  publisher: BRAND.name,
  alternates: { canonical: BRAND.origin },
  openGraph: {
    title: `${BRAND.name} | ${BRAND.descriptor}`,
    description: BRAND.description,
    type: "website",
    locale: BRAND.locale,
    siteName: BRAND.name,
    url: BRAND.origin,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: `${BRAND.name} — ${BRAND.descriptor}`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${BRAND.name} | ${BRAND.descriptor}`,
    description: BRAND.description,
    images: ["/opengraph-image"],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={BRAND.language} suppressHydrationWarning>
      <body className="antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(buildBrandJsonLd(BRAND.origin)) }}
        />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
