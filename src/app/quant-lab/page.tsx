import type { Metadata } from "next";

import { QuantLab } from "@/components/QuantLab";

export const metadata: Metadata = {
  title: "Quant Lab",
  description:
    "Build, allocate, and backtest portfolio strategies with rich performance analytics.",
};

export default function QuantLabPage() {
  return <QuantLab />;
}
