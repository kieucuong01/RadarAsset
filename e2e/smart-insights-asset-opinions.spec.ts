import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { config as loadEnvFile } from "dotenv";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { assertBudgets, benchmark } from "../scripts/benchmark-smart-insights.mjs";
import { resolveLocalEnvFile } from "../scripts/dev-local.mjs";

test.setTimeout(240_000);

const symbols = [
  "BTC",
  "XAU",
  "VNINDEX",
  "ETH",
  "SOL",
  "BNB",
  "XRP",
  "LTC",
  "ADA",
  "LINK",
  "VCB",
  "BID",
  "VIC",
  "FPT",
  "HPG",
  "VNM",
  "GAS",
  "MSN",
  "MWG",
  "SSI",
  "TCB",
  "MBB",
  "CTG",
  "VHM",
  "SAB",
] as const;

function market(symbol: string) {
  if (["BTC", "ETH", "SOL", "BNB", "XRP", "LTC", "ADA", "LINK"].includes(symbol)) return "crypto";
  if (symbol === "XAU") return "gold";
  return "equity";
}

function name(symbol: string) {
  return (
    {
      BTC: "Bitcoin",
      ETH: "Ethereum",
      SOL: "Solana",
      ADA: "Cardano",
      XAU: "Gold Spot",
      VNINDEX: "VN-Index",
    }[symbol] ?? symbol
  );
}

function factorDefinitions(symbol: string, index: number) {
  const score = 55 + (index % 20);
  if (["ETH", "SOL"].includes(symbol)) {
    return [
      [
        "market.return_20d",
        "trend",
        index + 1,
        "PERCENT",
        score,
        0.25,
        "return_x400_bounded_v1",
        "20D",
      ],
      [
        "crypto.btc.return_20d",
        "btc_trend",
        8.2,
        "PERCENT",
        32,
        0.2,
        "return_x400_bounded_v1",
        "20D",
      ],
      [
        "crypto.cycle.altcoin_season.index",
        "altcoin_rotation",
        78,
        "INDEX",
        56,
        0.15,
        "altcoin_season_centered_v1",
        "90D",
      ],
      [
        "crypto.etf.net_flow_usd",
        "etf_flow",
        symbol === "ETH" ? 184 : 47,
        "USD_MILLIONS",
        42,
        0.25,
        "empirical_percentile_90d",
        "1D",
      ],
      [
        "crypto.fear_greed.index",
        "broad_sentiment",
        61,
        "INDEX",
        22,
        0.05,
        "centered_index_v1",
        "1D",
      ],
    ] as const;
  }
  if (market(symbol) === "crypto" && symbol !== "BTC") {
    return [
      [
        "market.return_20d",
        "trend",
        index + 1,
        "PERCENT",
        score,
        0.3,
        "return_x400_bounded_v1",
        "20D",
      ],
      [
        "crypto.btc.return_20d",
        "btc_trend",
        8.2,
        "PERCENT",
        32,
        0.25,
        "return_x400_bounded_v1",
        "20D",
      ],
      [
        "crypto.cycle.altcoin_season.index",
        "altcoin_rotation",
        78,
        "INDEX",
        56,
        0.2,
        "altcoin_season_centered_v1",
        "90D",
      ],
      [
        "crypto.fear_greed.index",
        "broad_sentiment",
        61,
        "INDEX",
        22,
        0.1,
        "centered_index_v1",
        "1D",
      ],
    ] as const;
  }
  return [
    ["market.return_20d", "trend", index + 1, "PERCENT", score, 0.8, "empirical_percentile", "20D"],
  ] as const;
}

async function seedBriefing(email: string) {
  const fileEnv: Record<string, string> = {};
  const envFile = resolveLocalEnvFile(process.cwd(), existsSync);
  if (envFile) loadEnvFile({ path: envFile, processEnv: fileEnv, quiet: true });
  const developmentUrl = process.env.DATABASE_URL ?? fileEnv.DATABASE_URL;
  const configuredTestUrl = process.env.TEST_DATABASE_URL ?? fileEnv.TEST_DATABASE_URL;
  const databaseUrl =
    configuredTestUrl ??
    (() => {
      if (!developmentUrl) return undefined;
      const parsed = new URL(developmentUrl);
      parsed.pathname = `${parsed.pathname.replace(/_test$/, "")}_test`;
      return parsed.toString();
    })();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for Smart Insights E2E.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const user = await prisma.appUser.findUniqueOrThrow({
      where: { email },
      include: { memberships: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    const organizationId = user.memberships[0]?.organizationId;
    if (!organizationId) throw new Error("E2E workspace membership was not created.");
    const asOf = new Date();
    const effectiveDate = new Date(
      Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
    );
    const run = await prisma.researchRun.create({
      data: {
        organizationId,
        userId: user.id,
        source: "smart-insights-e2e",
        kind: "daily_asset_opinion",
        status: "succeeded",
        parameters: { fixture: true },
        startedAt: asOf,
        finishedAt: asOf,
      },
    });
    const briefing = await prisma.dailyBriefing.create({
      data: {
        organizationId,
        userId: user.id,
        researchRunId: run.id,
        effectiveDate,
        effectiveAt: asOf,
        timezone: "Asia/Bangkok",
        revision: 1,
        fingerprint: `${user.id.replaceAll("-", "")}`.padEnd(64, "0").slice(0, 64),
        modelName: "e2e-grounded-fixture",
        promptVersion: "asset-opinion-v1",
        methodologyVersion: "asset-opinion-quant-v1",
        status: "complete",
        marketSummary: {},
        dataConfidence: 76,
        portfolioSnapshot: { portfolioState: "available" },
        preferenceSnapshot: { locale: "vi", riskTolerance: "moderate" },
      },
    });
    const assetOpinions: Array<Record<string, unknown>> = [];

    for (const [index, symbol] of symbols.entries()) {
      const factors = factorDefinitions(symbol, index);
      const asset = await prisma.asset.upsert({
        where: { symbol },
        create: {
          symbol,
          name: name(symbol),
          assetClass: market(symbol) === "equity" ? "equity" : "spot",
          market: market(symbol),
          currency: symbol === "XAU" ? "USD" : market(symbol) === "equity" ? "VND" : "USDT",
        },
        update: { name: name(symbol), market: market(symbol) },
      });
      const evidence = await prisma.evidenceItem.create({
        data: {
          researchRunId: run.id,
          assetId: asset.id,
          sourceType: "metric",
          sourceName: symbol === "BTC" ? "farside" : "e2e-quant",
          url: "https://example.test/quant-source",
          title: "trend.return_20d",
          excerpt: JSON.stringify({
            metric_code: "trend.return_20d",
            display_value: `${(index + 1).toFixed(2)}%`,
            source_code: symbol === "BTC" ? "farside" : "e2e-quant",
            source_url: "https://example.test/quant-source",
            effective_end: asOf.toISOString(),
            observed_at: asOf.toISOString(),
            warnings: [],
          }),
          observedAt: asOf,
        },
      });
      const insight = await prisma.aiInsight.create({
        data: {
          assetId: asset.id,
          researchRunId: run.id,
          source: "e2e-grounded-fixture",
          title: `${symbol}: xu hướng 20 ngày đạt ${(index + 1).toFixed(2)}%.`,
          summary: `Kịch bản cơ sở giữ nguyên khi xu hướng 20 ngày còn ${(index + 1).toFixed(2)}%.`,
          sentiment: "constructive",
          confidence: 76,
          catalyst: `Kịch bản tích cực được hỗ trợ bởi mức ${(index + 1).toFixed(2)}%.`,
          risk: JSON.stringify({
            bearCase: `Kịch bản tiêu cực nếu mức ${(index + 1).toFixed(2)}% đảo chiều.`,
            invalidationConditions: [`Xu hướng 20 ngày không còn mức ${(index + 1).toFixed(2)}%.`],
          }),
          publishedAt: asOf,
        },
      });
      await prisma.evidenceItem.update({
        where: { id: evidence.id },
        data: { insightId: insight.id },
      });
      const evidenceIds = factors.map((_, factorIndex) =>
        factorIndex === 0 ? evidence.id : randomUUID(),
      );
      const coverage = factors.reduce((total, factor) => total + factor[5], 0);
      const totalContribution = factors.reduce((total, factor) => total + factor[4] * factor[5], 0);
      await prisma.signalSnapshot.create({
        data: {
          market: market(symbol) === "equity" ? "macro" : market(symbol),
          assetId: asset.id,
          effectiveAt: asOf,
          methodologyVersion: "asset-opinion-quant-v1",
          signalType: "asset_opinion",
          score: 55 + (index % 20),
          label: "CONSTRUCTIVE",
          dataConfidence: 76,
          coverage,
          inputs: {
            schemaVersion: "asset-opinion-v2",
            assetName: name(symbol),
            portfolioWeightPct: index < 8 ? String(18 - index) : "0",
            freshness: "fresh",
            gate: { failed_gates: [] },
            pillars: factors.map((factor, factorIndex) => ({
              code: factor[1],
              score: String(factor[4]),
              configured_weight: String(factor[5]),
              confidence: "80",
              available_input_weight: "1",
              contribution: String(factor[4] * factor[5]),
              fact_ids: [evidenceIds[factorIndex]],
              series: [[asOf.toISOString(), String(factor[4])]],
            })),
            decisionInputs: factors.map((factor, factorIndex) => ({
              fact_id: evidenceIds[factorIndex],
              metric_code: factor[0],
              pillar_code: factor[1],
              raw_value: String(factor[2]),
              unit: factor[3],
              normalized_score: String(factor[4]),
              input_weight: "1",
              weighted_score: String(factor[4]),
              pillar_weight: String(factor[5]),
              contribution: String(factor[4] * factor[5]),
              normalization_method: factor[6],
              percentile: "0.8",
              lookback: factor[7],
            })),
            formula: "asset_score = Σ(pillar_score × pillar_weight) ÷ data_coverage",
            totalContribution: String(totalContribution),
          },
          status: "active",
          idempotencyKey: `e2e:${organizationId}:${user.id}:${symbol}`,
        },
      });
      assetOpinions.push({
        symbol,
        assetName: name(symbol),
        stance: "CONSTRUCTIVE",
        quantScore: String(55 + (index % 20)),
        confidence: "76",
        horizon: "WEEKS_1_4",
        portfolioWeightPct: index < 8 ? String(18 - index) : "0",
        unrealizedReturn: index < 8 ? String((index + 1) / 100) : null,
        riskTolerance: "moderate",
        personalizedAction: index === 0 ? "REVIEW_INCREASE" : "HOLD",
        pillars: factors.map((factor, factorIndex) => ({
          code: factor[1],
          score: String(factor[4]),
          weight: String(factor[5]),
          confidence: "80",
          availableInputWeight: "1",
          contribution: String(factor[4] * factor[5]),
          factIds: [evidenceIds[factorIndex]],
          series: [{ ts: asOf.toISOString(), value: factor[4] }],
        })),
        thesis: `${symbol}: xu hướng 20 ngày đạt ${(index + 1).toFixed(2)}%.`,
        bullCase: `Kịch bản tích cực được hỗ trợ bởi mức ${(index + 1).toFixed(2)}%.`,
        baseCase: `Kịch bản cơ sở giữ nguyên khi xu hướng 20 ngày còn ${(index + 1).toFixed(2)}%.`,
        bearCase: `Kịch bản tiêu cực nếu mức ${(index + 1).toFixed(2)}% đảo chiều.`,
        invalidationConditions: [`Xu hướng 20 ngày không còn mức ${(index + 1).toFixed(2)}%.`],
        quantInvalidationConditions: ["ASSET_SCORE_BELOW_15"],
        formula: "asset_score = Σ(pillar_score × pillar_weight) ÷ data_coverage",
        totalContribution: String(totalContribution),
        decisionInputs: factors.map((factor, factorIndex) => ({
          evidenceId: evidenceIds[factorIndex],
          metricCode: factor[0],
          pillarCode: factor[1],
          rawValue: String(factor[2]),
          unit: factor[3],
          normalizedScore: String(factor[4]),
          inputWeight: "1",
          weightedScore: String(factor[4]),
          pillarWeight: String(factor[5]),
          contribution: String(factor[4] * factor[5]),
          normalizationMethod: factor[6],
          percentile: "0.8",
          lookback: factor[7],
        })),
        supportingEvidenceIds: evidenceIds,
        contradictingEvidenceIds: [],
        evidence: factors.map((factor, factorIndex) => ({
          id: evidenceIds[factorIndex],
          metricCode: factor[0],
          displayValue: `${factor[2]} ${factor[3]}`,
          delta: null,
          percentile: null,
          impact: "supporting",
          sourceCode: factor[1] === "etf_flow" ? "farside" : "e2e-quant",
          sourceUrl: "https://example.test/quant-source",
          effectiveAt: asOf.toISOString(),
          observedAt: asOf.toISOString(),
          freshness: "fresh",
          usedInDecision: true,
        })),
        dataCoverage: String(coverage),
        freshness: "fresh",
        explanationStatus: "accepted",
        failedGates: [],
      });
    }
    await prisma.dailyBriefing.update({
      where: { id: briefing.id },
      data: { marketSummary: { portfolioState: "available", assetOpinions } },
    });
  } finally {
    await prisma.$disconnect();
  }
}

test("Smart Insights asset opinions are responsive, bounded, and request-efficient", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const email = `smart-insights-${suffix}@example.test`;
  const requests: string[] = [];
  const errors: string[] = [];
  let authenticated = false;
  page.on("request", (request) => {
    if (authenticated) requests.push(request.url());
  });
  page.on("console", (message) => {
    if (authenticated && message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    if (authenticated) errors.push(error.message);
  });
  page.on("response", async (response) => {
    if (authenticated && response.url().includes("/api/") && response.status() >= 500) {
      errors.push(`${response.url()} ${response.status()}: ${await response.text()}`);
    }
  });
  await page.addInitScript(() => {
    const metrics = { cls: 0, lcp: 0, inp: 0 };
    Object.defineProperty(window, "__smartInsightsVitals", { value: metrics, writable: true });
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) metrics.lcp = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<
          PerformanceEntry & { hadRecentInput?: boolean; value?: number }
        >) {
          if (!entry.hadRecentInput) metrics.cls += entry.value ?? 0;
        }
      }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { duration: number }>) {
          metrics.inp = Math.max(metrics.inp, entry.duration);
        }
      }).observe({ type: "event", buffered: true, durationThreshold: 16 });
    } catch {
      // Older engines may not expose every Web Vitals observer type.
    }
  });

  // Wait for the client bundle before submitting. Clicking the SSR form before
  // hydration falls back to a GET navigation and never calls Better Auth.
  await page.goto("/sign-up", { waitUntil: "networkidle" });
  await page.getByLabel("Name").fill("Smart Insights E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Smart-Insights!2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByLabel("Workspace name")).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Workspace name").fill(`Smart Insights ${suffix}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/portfolio/, { timeout: 30_000 });
  await seedBriefing(email);
  authenticated = true;

  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Quan điểm AI theo tài sản" })).toBeVisible({
    timeout: 60_000,
  });
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Quan điểm AI theo tài sản" })).toBeVisible();
  await expect(page.getByText("Research run", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Investor Intelligence", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Tài sản nổi bật", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /USDT/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /USDC/ })).toHaveCount(0);
  const detail = page.getByTestId("asset-opinion-detail");
  const openAsset = async (symbol: string, assetName: string) => {
    const trigger = page.getByRole("button", {
      name: `Xem phân tích ${symbol} ${assetName}`,
      exact: true,
    });
    await trigger.click();
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(`${symbol} · ${assetName}`);
    return trigger;
  };
  const closeAsset = async () => {
    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);
  };

  await expect(detail).toHaveCount(0);
  const btcTrigger = await openAsset("BTC", "Bitcoin");
  await expect(page.getByRole("heading", { name: /Quan điểm định lượng chung/ })).toBeVisible();
  await expect(detail).toContainText("AI đã phân tích");
  await expect(detail).toContainText("Vì các số liệu này");
  await expect(detail).toContainText("Yếu tố phản biện");
  await expect(detail).toContainText("Khẩu vị rủi ro");
  await expect(detail.getByTestId("asset-opinion-sources")).toHaveCount(0);
  const sourceButton = detail.getByRole("button", { name: /Nguồn dữ liệu \(\d+\)/ });
  await sourceButton.click();
  await expect(detail.getByTestId("asset-opinion-sources")).toBeVisible();

  await detail.getByRole("tab", { name: "Cách tính", exact: true }).click();
  await expect(detail).toContainText("Điểm tài sản = Σ(điểm trụ cột × trọng số) ÷ độ phủ dữ liệu");
  await expect(detail.locator("th", { hasText: "Điểm chuẩn hóa" })).toBeVisible();
  await detail.getByRole("tab", { name: /Kịch bản/ }).click();
  await expect(detail.getByText("Kịch bản cơ sở", { exact: true })).toBeVisible();
  await closeAsset();
  await expect(btcTrigger).toBeFocused();

  await openAsset("ETH", "Ethereum");
  await detail.getByRole("tab", { name: "Cách tính", exact: true }).click();
  await expect(detail).toContainText("Xu hướng BTC");
  await expect(detail).toContainText("Luân chuyển Altcoin");
  await expect(detail).toContainText("Dòng tiền ETF");
  await closeAsset();

  await openAsset("ADA", "Cardano");
  await detail.getByRole("tab", { name: "Cách tính", exact: true }).click();
  await expect(detail).toContainText("Luân chuyển Altcoin");
  await expect(detail).not.toContainText("Dòng tiền ETF");
  await closeAsset();

  await openAsset("SOL", "Solana");
  await detail.getByRole("tab", { name: "Cách tính", exact: true }).click();
  await expect(detail).toContainText("Dòng tiền ETF");
  await closeAsset();

  await openAsset("XAU", "Gold Spot");
  await closeAsset();

  if (testInfo.project.name === "mobile") {
    await expect(page.getByTestId("asset-opinion-table")).toBeHidden();
    await expect(page.getByTestId("asset-opinion-cards")).toBeVisible();
  } else {
    await expect(page.getByTestId("asset-opinion-table")).toBeVisible();
    await expect(page.getByTestId("asset-opinion-cards")).toBeHidden();
  }

  expect(requests.some((url) => url.includes("/api/research/runs"))).toBe(false);
  expect(requests.some((url) => url.includes("/intelligence"))).toBe(false);
  expect(requests.some((url) => url.includes("/api/insights"))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);

  const vitals = await page.evaluate(
    () =>
      (window as unknown as { __smartInsightsVitals: { cls: number; lcp: number; inp: number } })
        .__smartInsightsVitals,
  );
  const initialJs = await page.evaluate(() => {
    const resources = performance
      .getEntriesByType("resource")
      .filter(
        (entry): entry is PerformanceResourceTiming =>
          entry instanceof PerformanceResourceTiming &&
          entry.name.includes("/_next/static/") &&
          entry.name.endsWith(".js"),
      );
    const unique = new Map(resources.map((entry) => [entry.name, entry.encodedBodySize]));
    return {
      resourceCount: unique.size,
      encodedBytes: [...unique.values()].reduce((total, bytes) => total + bytes, 0),
    };
  });
  expect(vitals.cls).toBeLessThanOrEqual(0.1);
  if (process.env.E2E_PRODUCTION === "1") {
    if (vitals.lcp > 0) expect(vitals.lcp).toBeLessThanOrEqual(2_500);
    if (vitals.inp > 0) expect(vitals.inp).toBeLessThanOrEqual(200);
  }
  console.log(
    `SMART_INSIGHTS_VITALS ${testInfo.project.name} ${JSON.stringify({ ...vitals, initialJs })}`,
  );

  if (testInfo.project.name === "desktop") {
    const cookies = await context.cookies();
    const result = await benchmark({
      url: `${baseURL}/api/smart-insights/briefing`,
      cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
      iterations: 20,
    });
    expect(result.assetCount).toBe(25);
    expect(result.maxDecisionInputs).toBeLessThanOrEqual(12);
    expect(result.maxEvidence).toBeLessThanOrEqual(12);
    expect(result.maxSupporting).toBeLessThanOrEqual(5);
    expect(result.maxContradicting).toBeLessThanOrEqual(3);
    assertBudgets(result);
    console.log(`SMART_INSIGHTS_BENCHMARK ${JSON.stringify({ ...result, vitals, initialJs })}`);
    await testInfo.attach("smart-insights-benchmark.json", {
      body: JSON.stringify({ ...result, requestUrls: requests.length, vitals }, null, 2),
      contentType: "application/json",
    });
  }
  expect(errors).toEqual([]);
});
