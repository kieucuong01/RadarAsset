export const APP_ROUTES = [
  { id: "insights", href: "/", label: "Smart Insights", mobileLabel: "Tổng quan" },
  { id: "portfolio", href: "/portfolio", label: "Mock Portfolio", mobileLabel: "Danh mục" },
  { id: "quantLab", href: "/quant-lab", label: "Quant Lab", mobileLabel: "Quant Lab" },
] as const;

export type AppRouteId = (typeof APP_ROUTES)[number]["id"];
