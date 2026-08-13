export const DATA_STATUS_META = {
  SYSTEM: {
    label: "Dữ liệu hệ thống",
    description: "Được tải từ API hoặc database hiện có.",
  },
  SAMPLE: {
    label: "Dữ liệu mẫu",
    description: "Nội dung seed hoặc fallback, không phải dữ liệu live.",
  },
  SIMULATED: {
    label: "Mô phỏng",
    description: "Kết quả minh họa, không phải giao dịch hoặc dự báo thực.",
  },
  UNAVAILABLE: {
    label: "Dữ liệu chưa khả dụng",
    description: "Chưa có dữ liệu hệ thống đã xác thực để hiển thị.",
  },
} as const;

export type DataStatus = keyof typeof DATA_STATUS_META;

export const AUTH_PAGE_COPY = {
  signIn: {
    heading: "Welcome back",
    description: "Sign in to open your portfolio and quantitative workspace.",
  },
  signUp: {
    heading: "Create your account",
    description: "Start with a private workspace for your research and portfolio.",
  },
  onboarding: {
    heading: "Set up your workspace",
    description: "Create the organization that will own your financial data.",
  },
} as const;

export const MVP_FEATURES = {
  listenBriefing: { available: false },
  applyPortfolio: { available: false },
  watchlistAdd: { available: true },
  alertEdit: { available: false },
  notifications: { available: true },
} as const;

export type MvpFeature = keyof typeof MVP_FEATURES;

export function isFeatureAvailable(feature: MvpFeature): boolean {
  return MVP_FEATURES[feature].available;
}
