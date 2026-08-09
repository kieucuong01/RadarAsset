import type { Metadata } from "next";

import { QuantLab } from "@/components/QuantLab";
import { requireTenantPage } from "@/lib/auth/page-guard";

export const metadata: Metadata = {
  title: "Quant Lab",
  description:
    "Build, allocate, and backtest portfolio strategies with rich performance analytics.",
};

export default async function QuantLabPage() {
  await requireTenantPage("/quant-lab");
  return <QuantLab />;
}
