import type { Metadata } from "next";

import { MockPortfolio } from "@/components/MockPortfolio";

export const metadata: Metadata = {
  title: "Mock Portfolio",
  description: "Track a simulated multi-asset portfolio with PnL, allocations, and performance.",
};

export default function PortfolioPage() {
  return <MockPortfolio />;
}
