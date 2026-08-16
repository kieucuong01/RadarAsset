import { describe, expect, it } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

import { buildBrandJsonLd, safeJsonLd } from "./seo";

describe("DataVest SEO surfaces", () => {
  it("publishes one connected Organization and WebSite graph", () => {
    const graph = buildBrandJsonLd("https://datavest.vn");

    expect(graph["@graph"].map((item) => item["@type"])).toEqual([
      "Organization",
      "WebSite",
    ]);
    expect(graph["@graph"][0]).toMatchObject({
      name: "DataVest.vn",
      url: "https://datavest.vn",
      logo: "https://datavest.vn/brand/datavest-mark.svg",
    });
    expect(safeJsonLd({ value: "</script>" })).not.toContain("</script>");
  });

  it("lists public routes and excludes private routes", () => {
    const urls = sitemap().map((entry) => entry.url);

    expect(urls).toEqual([
      "https://datavest.vn",
      "https://datavest.vn/portfolio",
      "https://datavest.vn/quant-lab",
      "https://datavest.vn/gioi-thieu",
    ]);
    expect(urls.join(" ")).not.toMatch(/sign-in|sign-up|onboarding|api/);
  });

  it("keeps public pages crawlable and private surfaces disallowed", () => {
    const policy = robots();

    expect(policy.sitemap).toBe("https://datavest.vn/sitemap.xml");
    expect(policy.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userAgent: "*",
          allow: "/",
          disallow: expect.arrayContaining(["/api/", "/sign-in", "/sign-up", "/onboarding"]),
        }),
      ]),
    );
  });
});
