import { createFileRoute } from "@tanstack/react-router";
import { SmartInsights } from "@/components/SmartInsights";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Smart Insights — RadarAsset" },
      { name: "description", content: "AI-curated financial briefings, market pulse, and expert signals across crypto, equities, and macro." },
      { property: "og:title", content: "Smart Insights — RadarAsset" },
      { property: "og:description", content: "AI-curated briefings and expert signals." },
    ],
  }),
  component: SmartInsights,
});
