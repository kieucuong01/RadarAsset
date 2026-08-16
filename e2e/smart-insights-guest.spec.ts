import { expect, test } from "@playwright/test";

const TENANT_ONLY_PATHS = [
  "/api/auth/organization/list",
  "/api/notifications",
  "/api/portfolio",
  "/api/watchlist",
  "/api/smart-insights/briefing",
  "/api/smart-insights/calendar",
  "/api/smart-insights/crypto-market-pulse",
  "/api/smart-insights/forecast/",
  "/api/smart-insights/macro/",
  "/api/smart-insights/metrics",
  "/api/smart-insights/preferences",
  "/api/smart-insights/regimes",
] as const;

test("anonymous homepage stays guest-safe without tenant API traffic", async ({ page }) => {
  const tenantRequests: string[] = [];
  const failedApiResponses: string[] = [];

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (TENANT_ONLY_PATHS.some((path) => url.pathname.startsWith(path))) {
      tenantRequests.push(`${request.method()} ${url.pathname}`);
    }
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/") && response.status() >= 400) {
      failedApiResponses.push(`${response.status()} ${url.pathname}`);
    }
  });

  const response = await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Quan điểm AI theo tài sản" })).toBeVisible({
    timeout: 60_000,
  });

  expect(response?.status()).toBe(200);
  expect(tenantRequests).toEqual([]);
  expect(failedApiResponses).toEqual([]);
});
