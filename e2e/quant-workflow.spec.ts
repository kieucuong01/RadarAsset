import { expect, test } from "@playwright/test";

test.setTimeout(240_000);

test("authenticated Quant shell is usable without overflow", async ({ page }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const errors: string[] = [];
  let authenticated = false;
  page.on("console", (message) => {
    if (authenticated && message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    if (authenticated) errors.push(error.message);
  });
  page.on("response", async (response) => {
    if (authenticated && response.url().includes("/api/") && response.status() >= 400) {
      errors.push(`${response.url()} ${response.status()}: ${await response.text()}`);
    }
  });

  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Quant Browser E2E");
  await page.getByLabel("Email").fill(`quant-browser-${suffix}@example.test`);
  await page.getByLabel("Password").fill("Quant-Browser!2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByLabel("Workspace name")).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Workspace name").fill(`Quant Browser ${suffix}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/portfolio/, { timeout: 30_000 });
  authenticated = true;

  await page.goto("/quant-lab?symbols=E2EVN,E2EBTC,E2EXAU", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Quant/);
  const backtestTab = page.getByRole("tab", { name: /Backtest/ });
  await expect(backtestTab).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
  const addAsset = page.getByRole("button", { name: /Thêm mã|Add asset/ });
  await expect(addAsset).toBeEnabled({ timeout: 60_000 });
  for (const symbol of ["E2EVN", "E2EBTC", "E2EXAU"]) {
    await expect(page.getByText(symbol, { exact: true }).first()).toBeVisible();
  }
  const runBacktest = page.getByRole("button", { name: /Run Portfolio Backtest|Chạy backtest/ });
  await expect(runBacktest).toBeEnabled({ timeout: 30_000 });
  await runBacktest.click();
  await expect(page.getByText(/Active Portfolio|Danh mục đang chạy/)).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText("Equity Curve & Drawdown")).toBeVisible();
  await expect(page.getByText(/Trade List|Danh sách lệnh/)).toBeVisible();
  if (testInfo.project.name === "desktop") {
    await page
      .locator("summary")
      .filter({ hasText: /Phân tích nâng cao|Advanced Analysis/ })
      .click();
    await page.getByRole("tab", { name: "E2EVN" }).click();
    const apply = page.getByRole("button", { name: /Áp dụng|Apply/ }).first();
    const appliedResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/portfolio/strategy-assignments") &&
        response.request().method() === "POST",
    );
    await apply.click();
    expect((await appliedResponse).ok()).toBe(true);
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("E2EVN", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});
