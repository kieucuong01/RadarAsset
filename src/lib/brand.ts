export const BRAND = {
  name: "DataVest.vn",
  shortName: "DataVest",
  origin: "https://datavest.vn",
  locale: "vi_VN",
  language: "vi",
  descriptor: "Dữ liệu định lượng cho nhà đầu tư cá nhân",
  tagline: "Dữ liệu trước. Quyết định sau.",
  positioning:
    "DataVest.vn là nền tảng hỗ trợ nhà đầu tư cá nhân Việt Nam phân tích thị trường, quản lý danh mục và kiểm định chiến lược bằng dữ liệu định lượng.",
  description:
    "DataVest.vn giúp nhà đầu tư cá nhân Việt Nam phân tích bối cảnh thị trường, quản lý danh mục và kiểm định chiến lược bằng dữ liệu định lượng. Nội dung chỉ nhằm mục đích thông tin và giáo dục, không phải tư vấn tài chính.",
  logoPath: "/brand/datavest-mark.svg",
  wordmarkPath: "/brand/datavest-wordmark.svg",
} as const;

export const BRAND_COLORS = {
  cobalt: "#1746A2",
  amber: "#F2B84B",
  midnight: "#0E1B32",
  paper: "#F5F7FB",
  white: "#FFFFFF",
} as const;

export function resolveSiteUrl(configured = process.env.NEXT_PUBLIC_SITE_URL): string {
  if (!configured) return BRAND.origin;

  const url = new URL(configured);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_SITE_URL must use http or https");
  }

  return url.origin;
}
