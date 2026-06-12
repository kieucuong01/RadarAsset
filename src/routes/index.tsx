import { createFileRoute } from "@tanstack/react-router";
import { SmartInsights } from "@/components/SmartInsights";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Smart Insights — RadarAsset" },
      { name: "description", content: "AI-curated financial briefings, market pulse, and expert signals across crypto, equities, and macro." },
      { property: "og:title", content: "Smart Insights — RadarAsset" },
      { property: "og:description", content: "AI-curated briefings and expert signals." },
      { property: "og:type", content: "article" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: "Risk-on returns as BTC reclaims $67K, but Fed minutes cap upside in equities.",
          description:
            "AI daily briefing synthesizing crypto ETF flows, hawkish FOMC minutes and VN30 banking leadership into an actionable market thesis.",
          datePublished: new Date().toISOString().slice(0, 10),
          author: { "@type": "Organization", name: "RadarAsset" },
          publisher: { "@type": "Organization", name: "RadarAsset" },
        }),
      },
    ],
  }),
  component: SmartInsights,
});
