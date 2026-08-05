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
    label: "Chưa khả dụng trong MVP",
    description: "Tính năng chưa có luồng vận hành thực.",
  },
} as const;

export type DataStatus = keyof typeof DATA_STATUS_META;

export const MVP_FEATURES = {
  listenBriefing: { available: false },
  applyPortfolio: { available: false },
  watchlistAdd: { available: true },
  alertEdit: { available: false },
  notifications: { available: false },
} as const;

export type MvpFeature = keyof typeof MVP_FEATURES;

export function isFeatureAvailable(feature: MvpFeature): boolean {
  return MVP_FEATURES[feature].available;
}
