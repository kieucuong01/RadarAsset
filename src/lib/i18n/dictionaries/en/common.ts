import type { DictionaryShape } from "../types";
import { viCommon } from "../vi/common";

export const enCommon = {
  header: {
    mainNav: "Main navigation",
    mobileNav: "Mobile navigation",
    theme: "Toggle light or dark mode",
    menu: "Open main menu",
    mobileDescription: "Choose the workspace you want to open.",
    language: "Language",
  },
  routes: {
    insights: "Smart Insights",
    insightsMobile: "Overview",
    portfolio: "Mock Portfolio",
    portfolioMobile: "Portfolio",
    quantLab: "Quant Lab",
    quantLabMobile: "Quant Lab",
  },
  dataStatus: {
    SYSTEM: { label: "System data", description: "Loaded from the current API or database." },
    SAMPLE: { label: "Sample data", description: "Seed or fallback content, not live data." },
    SIMULATED: {
      label: "Simulated",
      description: "Illustrative output, not real trades or predictions.",
    },
    UNAVAILABLE: {
      label: "Data unavailable",
      description: "No verified system data is currently available to display.",
    },
  },
  common: {
    buy: "Buy",
    sell: "Sell",
    retry: "Retry",
    cancel: "Cancel",
    save: "Save",
    saving: "Saving…",
    applying: "Applying…",
    addAsset: "Add asset",
    remove: "Remove",
    asset: "Asset",
    assets: "assets",
    price: "Price",
    quantity: "Quantity",
    fee: "Fee",
    signal: "Signal",
    strategy: "Strategy",
    portfolio: "Portfolio",
    benchmark: "Benchmark",
    allocation: "Allocation",
    confidence: "Confidence",
    unavailableMvp: "Unavailable in MVP",
    noData: "No data",
    loading: "Loading…",
    notAvailable: "N/A",
  },
} as const satisfies DictionaryShape<typeof viCommon>;
