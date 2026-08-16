import type { Metadata } from "next";

import { MockPortfolio } from "@/components/MockPortfolio";
import { requireTenantPage } from "@/lib/auth/page-guard";

export const metadata: Metadata = {
  title: "Danh mục mô phỏng",
  description:
    "Theo dõi phân bổ, giao dịch mô phỏng, hiệu suất và rủi ro danh mục đa tài sản trên DataVest.vn.",
  alternates: { canonical: "/portfolio" },
};

export default async function PortfolioPage() {
  await requireTenantPage("/portfolio");
  return <MockPortfolio />;
}
