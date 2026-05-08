import { createFileRoute } from "@tanstack/react-router";
import { QuantLab } from "@/components/QuantLab";

export const Route = createFileRoute("/quant-lab")({
  head: () => ({
    meta: [
      { title: "Quant Lab — RadarAsset" },
      { name: "description", content: "Build, allocate and backtest portfolio strategies with rich performance analytics." },
      { property: "og:title", content: "Quant Lab — RadarAsset" },
      { property: "og:description", content: "Backtest portfolio strategies with rich analytics." },
    ],
  }),
  component: QuantLab,
});
