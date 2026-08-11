import type { Metadata } from "next";

import { QuantLab } from "@/components/QuantLab";
import { requireTenantPage } from "@/lib/auth/page-guard";
import { normalizePreselectedSymbols } from "@/lib/backtest/preselection";

export const metadata: Metadata = {
  title: "Quant Lab",
  description:
    "Build, allocate, and backtest portfolio strategies with rich performance analytics.",
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
