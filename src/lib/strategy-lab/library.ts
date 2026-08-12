import { STRATEGY_CATALOG } from "@/lib/backtest/strategy-catalog";

export type StrategyFamily = "technical" | "fundamental" | "systematic";
export type StrategyStyle = "trend" | "momentum" | "mean_reversion" | "pattern";

type StrategyGuide = {
  style: StrategyStyle;
  thesis: string;
  entryRule: string;
  exitRule: string;
  idealConditions: readonly string[];
  risks: readonly string[];
  dataRequirements: readonly string[];
};

const GUIDES: Record<string, StrategyGuide> = {
  ma_crossover: {
    style: "trend",
    thesis: "Theo xu hướng bằng cách so sánh động lượng giá ngắn hạn và dài hạn.",
    entryRule: "Mua khi SMA nhanh cắt lên SMA chậm; khớp ở giá mở cửa nến kế tiếp.",
    exitRule: "Bán khi SMA nhanh cắt xuống SMA chậm.",
    idealConditions: ["Thị trường có xu hướng kéo dài", "Thanh khoản ổn định"],
    risks: ["Nhiều tín hiệu nhiễu khi giá đi ngang", "Tín hiệu trễ sau điểm đảo chiều"],
    dataRequirements: ["OHLCV"],
  },
  turtle_breakout: {
    style: "trend",
    thesis: "Bám theo xu hướng mới khi giá vượt khỏi vùng cực trị gần nhất.",
    entryRule: "Mua khi giá đóng cửa vượt đỉnh của cửa sổ entry trước đó.",
    exitRule: "Bán khi giá đóng cửa xuống dưới đáy của cửa sổ exit.",
    idealConditions: ["Breakout có xu hướng tiếp diễn", "Biến động mở rộng"],
    risks: ["False breakout", "Khoảng dừng lỗ có thể rộng"],
    dataRequirements: ["OHLCV"],
  },
  signal_rolling_reversal: {
    style: "momentum",
    thesis: "Xác nhận sự đổi hướng bằng chuỗi nến tăng hoặc giảm liên tục.",
    entryRule: "Mua sau số nến xác nhận tăng được cấu hình.",
    exitRule: "Bán sau số nến xác nhận giảm được cấu hình.",
    idealConditions: ["Động lượng ngắn hạn rõ ràng"],
    risks: ["Vào lệnh trễ", "Nhạy với chuỗi nến nhiễu"],
    dataRequirements: ["OHLCV"],
  },
  abcd_causal: {
    style: "pattern",
    thesis: "Tìm cấu trúc ABCD đã được xác nhận mà không sử dụng dữ liệu tương lai.",
    entryRule: "Mua khi pivot D và tỷ lệ retracement/extension hợp lệ được xác nhận.",
    exitRule: "Bán khi đạt mục tiêu giá của pattern.",
    idealConditions: ["Swing price rõ", "Biên độ đủ lớn sau phí"],
    risks: ["Ít tín hiệu", "Kết quả nhạy với tham số pivot"],
    dataRequirements: ["OHLCV"],
  },
  ema_trend: {
    style: "trend",
    thesis: "Theo xu hướng bằng EMA để phản ứng nhanh hơn SMA với thay đổi gần đây.",
    entryRule: "Mua khi EMA nhanh cắt lên EMA chậm.",
    exitRule: "Bán khi EMA nhanh cắt xuống EMA chậm.",
    idealConditions: ["Xu hướng trung hạn", "Tài sản giao dịch liên tục"],
    risks: ["Whipsaw trong vùng tích lũy", "Nhạy hơn với nhiễu ngắn hạn"],
    dataRequirements: ["OHLCV"],
  },
  rsi_mean_reversion: {
    style: "mean_reversion",
    thesis: "Mua khi động lượng giảm quá mức và chờ giá hồi về trạng thái cân bằng.",
    entryRule: "Mua khi RSI xuống dưới ngưỡng oversold.",
    exitRule: "Bán khi RSI hồi lên ngưỡng recovery.",
    idealConditions: ["Thị trường đi ngang", "Giá thường hồi về trung bình"],
    risks: ["Bắt dao rơi trong downtrend", "RSI có thể quá bán lâu"],
    dataRequirements: ["OHLCV"],
  },
  bollinger_mean_reversion: {
    style: "mean_reversion",
    thesis: "Kỳ vọng giá quay về trung tâm sau khi lệch xa khỏi phân phối gần đây.",
    entryRule: "Mua khi giá đóng cửa dưới dải Bollinger dưới.",
    exitRule: "Bán khi giá quay về đường trung tâm.",
    idealConditions: ["Biến động ổn định", "Thị trường không có xu hướng mạnh"],
    risks: ["Giá có thể tiếp tục bám dải", "Độ lệch chuẩn thay đổi nhanh"],
    dataRequirements: ["OHLCV"],
  },
  macd_momentum: {
    style: "momentum",
    thesis: "Theo sự thay đổi động lượng được phản ánh qua MACD histogram.",
    entryRule: "Mua khi MACD histogram cắt lên mức 0.",
    exitRule: "Bán khi MACD histogram cắt xuống mức 0.",
    idealConditions: ["Động lượng tăng bền", "Xu hướng vừa hình thành"],
    risks: ["Tín hiệu trễ", "Nhiễu khi histogram dao động quanh 0"],
    dataRequirements: ["OHLCV"],
  },
  atr_breakout: {
    style: "trend",
    thesis: "Chỉ tham gia breakout đủ lớn so với biến động thông thường của tài sản.",
    entryRule: "Mua khi giá vượt đỉnh trước cộng vùng đệm ATR.",
    exitRule: "Bán khi giá xuống dưới đáy của cửa sổ exit.",
    idealConditions: ["Biến động mở rộng", "Xu hướng sau breakout"],
    risks: ["Khoảng vào lệnh xa", "False breakout vẫn có thể xảy ra"],
    dataRequirements: ["OHLCV"],
  },
};

export function listStrategyLibrary() {
  return STRATEGY_CATALOG.map((definition) => {
    const guide = GUIDES[definition.code];
    if (!guide) throw new Error(`Missing Strategy Lab guide for ${definition.code}.`);
    return { ...definition, ...guide, family: "technical" as const };
  });
}

export type StrategyLibraryEntry = ReturnType<typeof listStrategyLibrary>[number];
