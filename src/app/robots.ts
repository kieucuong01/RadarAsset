import type { MetadataRoute } from "next";

import { BRAND } from "@/lib/brand";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/sign-in", "/sign-up", "/onboarding"],
      },
    ],
    sitemap: `${BRAND.origin}/sitemap.xml`,
    host: BRAND.origin,
  };
}
