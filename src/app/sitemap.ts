import type { MetadataRoute } from "next";

import { BRAND } from "@/lib/brand";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return ["", "/portfolio", "/quant-lab", "/gioi-thieu"].map((path) => ({
    url: `${BRAND.origin}${path}`,
    lastModified: now,
    changeFrequency: "daily",
    priority: path === "" ? 1 : 0.8,
  }));
}
