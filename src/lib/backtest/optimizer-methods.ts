export const OPTIMIZER_METHODS = [
  "equal_weight",
  "inverse_volatility",
  "minimum_variance",
  "maximum_sharpe",
  "target_return",
  "target_volatility",
  "risk_tolerance",
  "risk_parity",
  "most_diversified",
  "minimum_correlation",
] as const;

export type OptimizerMethod = (typeof OPTIMIZER_METHODS)[number];

export const OPTIMIZER_METHOD_LABELS = {
  equal_weight: "Equal Weight",
  inverse_volatility: "Inverse Volatility",
  minimum_variance: "Global Minimum Variance",
  maximum_sharpe: "Maximum Sharpe",
  target_return: "Markowitz Target Return",
  target_volatility: "Markowitz Target Volatility",
  risk_tolerance: "Markowitz Risk Tolerance",
  risk_parity: "Risk Parity / Equal Risk Contribution",
  most_diversified: "Most Diversified",
  minimum_correlation: "Minimum Correlation",
} satisfies Record<OptimizerMethod, string>;

export const OPTIMIZER_METHOD_DESCRIPTIONS = {
  equal_weight: "Baseline 1/N để so sánh mọi phương án tối ưu.",
  inverse_volatility: "Ưu tiên mã biến động thấp; không tự repair nếu vượt max weight.",
  minimum_variance: "Tối thiểu hóa biến động danh mục với constraint long-only/max weight.",
  maximum_sharpe: "Tối đa hóa Sharpe ratio dựa trên return lịch sử và covariance.",
  target_return: "Tìm danh mục Markowitz có volatility thấp nhất tại mức expected return mục tiêu.",
  target_volatility:
    "Tìm danh mục Markowitz có expected return cao nhất tại mức volatility mục tiêu.",
  risk_tolerance: "Tìm điểm trên efficient frontier theo risk tolerance của Markowitz.",
  risk_parity: "Chia đều đóng góp rủi ro thay vì chia đều vốn.",
  most_diversified: "Tối đa hóa diversification ratio với constraint long-only/max weight.",
  minimum_correlation:
    "Heuristic ưu tiên phân tán tương quan; không tự repair nếu vượt max weight.",
} satisfies Record<OptimizerMethod, string>;

export const OPTIMIZER_SOURCES = {
  portfolioAllocation: {
    library: "portfolio-allocation",
    version: "0.0.11",
    repository: "https://github.com/lequant40/portfolio_allocation_js",
    directory: "awesome-quant: Portfolio Optimization & Risk Analysis",
    license: "MIT",
  },
} as const;
