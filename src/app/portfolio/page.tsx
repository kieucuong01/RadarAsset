import type { Metadata } from "next";

import { MockPortfolio } from "@/components/MockPortfolio";
import { requireTenantPage } from "@/lib/auth/page-guard";

export const metadata: Metadata = {
  title: "Mock Portfolio",
  description: "Track a simulated multi-asset portfolio with PnL, allocations, and performance.",
};

export default async function PortfolioPage() {
  await requireTenantPage("/portfolio");
  return <MockPortfolio />;
}
