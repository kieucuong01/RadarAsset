import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://radarasset.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return ["", "/portfolio", "/quant-lab"].map((path) => ({
    url: `${siteUrl}${path}`,
    lastModified: now,
    changeFrequency: "daily",
    priority: path === "" ? 1 : 0.8,
  }));
}
