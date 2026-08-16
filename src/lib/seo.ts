import { BRAND } from "@/lib/brand";

export function buildBrandJsonLd(siteUrl = BRAND.origin) {
  const origin = new URL(siteUrl).origin;
  const organizationId = `${origin}/#organization`;
  const websiteId = `${origin}/#website`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organizationId,
        name: BRAND.name,
        alternateName: BRAND.shortName,
        url: origin,
        logo: `${origin}${BRAND.logoPath}`,
        description: BRAND.description,
      },
      {
        "@type": "WebSite",
        "@id": websiteId,
        name: BRAND.name,
        url: origin,
        description: BRAND.description,
        inLanguage: BRAND.language,
        publisher: { "@id": organizationId },
      },
    ],
  } as const;
}

export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}
