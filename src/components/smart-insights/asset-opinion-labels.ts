export type AssetOpinionLocale = "vi" | "en";

const METRICS: Record<string, { vi: string; en: string }> = {
  "market.return_20d": { vi: "Lợi suất 20 ngày", en: "20-day return" },
  "market.return_60d": { vi: "Lợi suất 60 ngày", en: "60-day return" },
  "market.ma_50_position": { vi: "Vị trí so với MA50", en: "Position vs MA50" },
  "market.ma_200_position": { vi: "Vị trí so với MA200", en: "Position vs MA200" },
  "market.current_drawdown": { vi: "Mức giảm từ đỉnh", en: "Current drawdown" },
  "crypto.etf.net_flow_usd": { vi: "Dòng tiền ETF", en: "ETF net flow" },
  "crypto.coinshares.net_flow_usd": { vi: "Dòng tiền quỹ CoinShares", en: "CoinShares flow" },
  "crypto.fear_greed.index": { vi: "Sợ hãi & Tham lam", en: "Fear & Greed" },
  "crypto.onchain.adjusted_transfer_usd": {
    vi: "Giá trị chuyển on-chain",
    en: "On-chain transfer value",
  },
  "crypto.onchain.active_addresses": { vi: "Địa chỉ hoạt động", en: "Active addresses" },
  "crypto.onchain.nvt": { vi: "Định giá NVT", en: "NVT valuation" },
  "macro.real_yield.10y_pct": { vi: "Lợi suất thực Mỹ 10Y", en: "US 10Y real yield" },
  "macro.usd_broad_index": { vi: "Sức mạnh USD", en: "Broad USD strength" },
  "macro.fed_balance_sheet_change_4w": {
    vi: "Bảng cân đối Fed 4 tuần",
    en: "Fed balance sheet 4W",
  },
  "macro.reverse_repo_change_4w": { vi: "Reverse repo 4 tuần", en: "Reverse repo 4W" },
  "macro.tga_change_4w": { vi: "TGA 4 tuần", en: "TGA 4W" },
  "gold.cftc.managed_money_net_oi": { vi: "Vị thế quỹ CFTC", en: "CFTC fund positioning" },
};

const PILLARS: Record<string, { vi: string; en: string }> = {
  trend: { vi: "Xu hướng giá", en: "Price trend" },
  fund_flow: { vi: "Dòng tiền", en: "Fund flow" },
  macro: { vi: "Vĩ mô", en: "Macro" },
  sentiment_onchain: { vi: "Tâm lý & on-chain", en: "Sentiment & on-chain" },
  positioning: { vi: "Vị thế thị trường", en: "Positioning" },
  relative_liquidity: { vi: "Sức mạnh & thanh khoản", en: "Relative strength & liquidity" },
  foreign_flow: { vi: "Dòng tiền nước ngoài", en: "Foreign flow" },
};

export function metricLabel(code: string, locale: AssetOpinionLocale) {
  return METRICS[code]?.[locale] ?? code.replaceAll(".", " · ");
}

export function pillarLabel(code: string, locale: AssetOpinionLocale) {
  return PILLARS[code]?.[locale] ?? code.replaceAll("_", " ");
}
