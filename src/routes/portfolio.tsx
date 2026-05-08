import { createFileRoute } from "@tanstack/react-router";
import { MockPortfolio } from "@/components/MockPortfolio";

export const Route = createFileRoute("/portfolio")({
  head: () => ({
    meta: [
      { title: "Mock Portfolio — RadarAsset" },
      { name: "description", content: "Track a simulated multi-asset portfolio with live PnL, allocations, and performance." },
      { property: "og:title", content: "Mock Portfolio — RadarAsset" },
      { property: "og:description", content: "Simulated portfolio tracking with live PnL." },
    ],
  }),
  component: MockPortfolio,
});
