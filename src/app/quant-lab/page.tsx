import type { Metadata } from "next";

import { QuantLab } from "@/components/QuantLab";
import { requireTenantPage } from "@/lib/auth/page-guard";
import { normalizePreselectedSymbols } from "@/lib/backtest/preselection";

export const metadata: Metadata = {
  title: "Phòng Quant",
  description:
    "Tối ưu phân bổ và kiểm định chiến lược trên dữ liệu lịch sử với phân tích hiệu suất và rủi ro.",
  alternates: { canonical: "/quant-lab" },
};

export default async function QuantLabPage({
  searchParams,
}: {
  searchParams: Promise<{ symbols?: string | string[] }>;
}) {
  await requireTenantPage("/quant-lab");
  const query = await searchParams;
  return <QuantLab initialSymbols={normalizePreselectedSymbols(query.symbols)} />;
}
