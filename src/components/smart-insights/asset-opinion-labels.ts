import type { AssetOpinionModel } from "@/lib/smart-insights-client";

export type AssetOpinionLocale = "vi" | "en";

const METRICS: Record<string, { vi: string; en: string }> = {
  "market.return_20d": { vi: "Lợi suất 20 ngày", en: "20-day return" },
  "market.return_60d": { vi: "Lợi suất 60 ngày", en: "60-day return" },
  "market.ma_50_position": { vi: "Vị trí so với MA50", en: "Position vs MA50" },
  "market.ma_200_position": { vi: "Vị trí so với MA200", en: "Position vs MA200" },
  "market.current_drawdown": { vi: "Mức giảm từ đỉnh", en: "Current drawdown" },
  "crypto.btc.return_20d": { vi: "Xu hướng BTC 20 ngày", en: "BTC 20-day trend" },
  "crypto.btc.return_60d": { vi: "Xu hướng BTC 60 ngày", en: "BTC 60-day trend" },
  "crypto.cycle.altcoin_season.index": {
    vi: "Chỉ số Altcoin Season",
    en: "Altcoin Season Index",
  },
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
  "macro.m2_change_4w": { vi: "Cung tiền M2 4 tuần", en: "M2 money supply 4W" },
  "gold.cftc.managed_money_net_oi": { vi: "Vị thế quỹ CFTC", en: "CFTC fund positioning" },
};

const PILLARS: Record<string, { vi: string; en: string }> = {
  trend: { vi: "Xu hướng giá", en: "Price trend" },
  fund_flow: { vi: "Dòng tiền", en: "Fund flow" },
  macro: { vi: "Vĩ mô", en: "Macro" },
  sentiment_onchain: { vi: "Tâm lý & on-chain", en: "Sentiment & on-chain" },
  btc_trend: { vi: "Xu hướng BTC", en: "BTC trend" },
  altcoin_rotation: { vi: "Luân chuyển Altcoin", en: "Altcoin rotation" },
  etf_flow: { vi: "Dòng tiền ETF", en: "ETF flow" },
  broad_sentiment: { vi: "Tâm lý thị trường", en: "Broad sentiment" },
  positioning: { vi: "Vị thế thị trường", en: "Positioning" },
  relative_liquidity: { vi: "Sức mạnh & thanh khoản", en: "Relative strength & liquidity" },
  foreign_flow: { vi: "Dòng tiền nước ngoài", en: "Foreign flow" },
};

const FAILED_GATES: Record<string, { vi: string; en: string }> = {
  MINIMUM_60_DAILY_BARS: {
    vi: "Thiếu tối thiểu 60 phiên giá ngày",
    en: "Fewer than 60 daily price bars",
  },
  NUMERIC_FACTS_MINIMUM_3: {
    vi: "Cần ít nhất 3 chỉ số định lượng đạt chuẩn",
    en: "At least 3 qualified quant metrics are required",
  },
  SOURCE_FAMILIES_MINIMUM_1: {
    vi: "Chưa có nguồn dữ liệu đạt chuẩn",
    en: "No qualified data source is available",
  },
  SOURCE_FAMILIES_MINIMUM_2: {
    vi: "Cần ít nhất 2 nhóm nguồn dữ liệu độc lập",
    en: "At least 2 independent source families are required",
  },
  CRITICAL_INPUT_STALE: {
    vi: "Dữ liệu quan trọng đã quá hạn cập nhật",
    en: "A critical input is stale",
  },
  PILLAR_COVERAGE_MINIMUM_50: {
    vi: "Độ phủ các trụ cột chưa đạt 50%",
    en: "Pillar coverage is below 50%",
  },
  PILLAR_COVERAGE_MINIMUM_60: {
    vi: "Độ phủ các trụ cột chưa đạt 60%",
    en: "Pillar coverage is below 60%",
  },
  STORED_CONTRACT_INVALID: {
    vi: "Bản phân tích lưu trữ không còn đúng định dạng",
    en: "The stored analysis contract is invalid",
  },
};

export function metricLabel(code: string, locale: AssetOpinionLocale) {
  return METRICS[code]?.[locale] ?? code.replaceAll(".", " · ");
}

export function pillarLabel(code: string, locale: AssetOpinionLocale) {
  return PILLARS[code]?.[locale] ?? code.replaceAll("_", " ");
}

export function failedGateLabel(code: string, locale: AssetOpinionLocale) {
  return FAILED_GATES[code]?.[locale] ?? code.replaceAll("_", " ");
}

export function isTechnicalQuantOpinion(opinion: AssetOpinionModel) {
  return (
    opinion.quantScore !== null &&
    opinion.decisionInputs.length >= 3 &&
    opinion.decisionInputs.every((input) => input.metricCode.startsWith("market."))
  );
}

export function technicalQuantLimitation(opinion: AssetOpinionModel, locale: AssetOpinionLocale) {
  if (!isTechnicalQuantOpinion(opinion)) return null;
  if (opinion.symbol === "XAU") {
    return locale === "vi"
      ? "Độ tin cậy được giới hạn vì chưa có dữ liệu vĩ mô/lợi suất và vị thế CFTC đạt chuẩn."
      : "Confidence is capped because qualified macro/yield and CFTC positioning data are absent.";
  }
  return locale === "vi"
    ? "Độ tin cậy được giới hạn vì chưa có dòng tiền độc lập ngoài dữ liệu giá và VNINDEX."
    : "Confidence is capped because independent flow data beyond price and VNINDEX is absent.";
}
