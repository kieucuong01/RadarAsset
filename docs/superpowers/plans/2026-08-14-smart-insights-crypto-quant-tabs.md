# Smart Insights Crypto Quant Pulse Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the long Crypto Quant Pulse column with five chart-first decision tabs while preserving the existing live data, source attribution, status semantics, and Smart Insights style.

**Architecture:** Add pure builders that turn the existing 31-day `MetricModel[]` into unit-safe time series and deterministic overview observations. A focused `CryptoQuantPulseTabs` component composes the existing Fear & Greed, ETF, CoinShares, and BTC-whale panels with a generic metric-trend chart. `LegacyMarketPulse` retains the only Crypto Market Pulse request and passes data into the nested workspace.

**Tech Stack:** TypeScript 5.8, React 19, Next.js 16 App Router, Radix/shadcn tabs, Recharts 2.15, Tailwind CSS 4, Vitest 4, Playwright/Browser plugin for rendered QA.

## Global Constraints

- Keep the existing outer Crypto/Macro/Gold tabs and all non-Crypto Smart Insights blocks.
- Nested tabs are exactly `Tổng quan`, `Dòng tiền`, `Tâm lý & Phái sinh`, `On-chain`, and `Cá voi BTC`.
- Default nested tab is `Tổng quan`.
- Use only existing API observations and existing sample datasets already visibly labelled `Dữ liệu mẫu`.
- Never create zeroes, interpolate missing data, or draw a trend from one point.
- Do not combine incompatible unit, asset, source frequency, or missing periods into one series.
- Keep source URL, effective time, unit, and freshness visible.
- Do not add provider acquisition, metric definitions, AI recommendations, or signal methodology.
- Do not change CryptoCraft scraping or scheduling.
- Preserve unrelated `next-env.d.ts` work.

---

## File structure

- `src/lib/crypto-quant-pulse.ts`: pure metric-series and deterministic overview builders.
- `src/lib/crypto-quant-pulse.test.ts`: time ordering, boundary, snapshot, and observation tests.
- `src/components/smart-insights/CryptoMetricTrendPanel.tsx`: reusable chart/snapshot panel with provenance.
- `src/components/smart-insights/CryptoQuantPulseTabs.tsx`: five-tab composition.
- `src/components/smart-insights/LegacyMarketPulse.tsx`: delegates Crypto rendering to the new workspace while retaining fetch ownership.
- `src/components/smart-insights/source-guard.test.ts`: approved tabs, chart-first composition, and no-long-grid regression.
- `docs/operations/smart-insights-runbook.md`: UI verification note and confirmed CryptoCraft state only if current evidence remains valid.

### Task 1: Build unit-safe Crypto metric series

**Files:**
- Create: `src/lib/crypto-quant-pulse.ts`
- Create: `src/lib/crypto-quant-pulse.test.ts`

**Interfaces:**
- Consumes: `MetricModel` from `src/lib/smart-insights-client.ts` and `CryptoMarketPulseModel` from `src/lib/crypto-market-pulse-client.ts`.
- Produces: `DERIVATIVE_METRIC_CODES`, `ONCHAIN_METRIC_CODES`, `CryptoMetricSeries`, `CryptoOverviewObservation`, `buildCryptoMetricSeries(metrics, codes)`, `mergeSeriesPoints(series)`, and `buildCryptoOverviewObservations(pulse, metrics)`.

- [ ] **Step 1: Write failing series tests**

```ts
import { describe, expect, it } from "vitest";
import { buildCryptoMetricSeries } from "./crypto-quant-pulse";
import { cryptoMarketPulseSchema } from "./crypto-market-pulse-client";
import type { MetricModel } from "./smart-insights-client";

const metric = (
  observationId: string,
  metricCode: string,
  value: string,
  effectiveStart: string,
  unit = "ratio",
  asset: string | null = "BTC",
): MetricModel => ({
  observationId,
  metricCode,
  market: "crypto",
  asset,
  value,
  unit,
  delta: null,
  percentile: null,
  effectiveStart,
  effectiveEnd: effectiveStart,
  observedAt: effectiveStart,
  sourceCode: "coinmetrics-community",
  sourceUrl: "https://community-api.coinmetrics.io",
  freshness: "fresh",
  qualityWarnings: [],
  methodologyVersion: "v1",
});

it("sorts points and keeps asset and unit boundaries", () => {
  const rows = [
    metric("2", "crypto.onchain.nvt", "20", "2026-08-14T00:00:00Z"),
    metric("1", "crypto.onchain.nvt", "18", "2026-08-13T00:00:00Z"),
    metric("3", "crypto.onchain.nvt", "9", "2026-08-14T00:00:00Z", "ratio", "ETH"),
  ];
  const series = buildCryptoMetricSeries(rows, new Set(["crypto.onchain.nvt"]));
  expect(series).toHaveLength(2);
  expect(series[0].points.map((point) => point.value)).toEqual([18, 20]);
  expect(series[0].trendPoints).toHaveLength(2);
});

it("keeps a single observation as a snapshot without a trend", () => {
  const [series] = buildCryptoMetricSeries(
    [metric("1", "crypto.onchain.mvrv", "1.8", "2026-08-14T00:00:00Z")],
    new Set(["crypto.onchain.mvrv"]),
  );
  expect(series.latest.value).toBe(1.8);
  expect(series.trendPoints).toEqual([]);
});

it("merges compatible trend points without connecting missing dates", () => {
  const series = buildCryptoMetricSeries(
    [
      metric("1", "crypto.derivatives.btc_dvol", "40", "2026-08-13T00:00:00Z", "index"),
      metric("2", "crypto.derivatives.btc_dvol", "42", "2026-08-14T00:00:00Z", "index"),
      metric("3", "crypto.derivatives.eth_dvol", "55", "2026-08-14T00:00:00Z", "index", "ETH"),
    ],
    DERIVATIVE_METRIC_CODES,
  );
  expect(mergeSeriesPoints(series)).toEqual([
    { effectiveAt: "2026-08-13T00:00:00Z", [series[0].key]: 40 },
    { effectiveAt: "2026-08-14T00:00:00Z", [series[0].key]: 42 },
  ]);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- src/lib/crypto-quant-pulse.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the metric groups and builder**

Use these exact code sets:

```ts
export const DERIVATIVE_METRIC_CODES = new Set([
  "crypto.derivatives.btc_dvol",
  "crypto.derivatives.eth_dvol",
  "crypto.derivatives.funding_rate",
  "crypto.derivatives.open_interest",
]);

export const ONCHAIN_METRIC_CODES = new Set([
  "crypto.onchain.active_addresses",
  "crypto.onchain.adjusted_transfer_usd",
  "crypto.onchain.mvrv",
  "crypto.onchain.nvt",
  "crypto.stablecoin.supply_usd",
]);
```

Define each point as `{ effectiveAt, value, sourceCode, sourceUrl, freshness }`. Group with the key `${metricCode}:${asset ?? "global"}:${unit}`, parse only finite numeric values, sort by `effectiveStart`, set `latest` to the final point, and set `trendPoints` to all points only when length is at least two.

Use these exported contracts:

```ts
export type CryptoMetricPoint = {
  effectiveAt: string;
  value: number;
  sourceCode: string;
  sourceUrl: string;
  freshness: MetricModel["freshness"];
};

export type CryptoMetricSeries = {
  key: string;
  metricCode: string;
  asset: string | null;
  unit: string;
  latest: CryptoMetricPoint;
  points: CryptoMetricPoint[];
  trendPoints: CryptoMetricPoint[];
};

export type CryptoOverviewObservation = {
  kind: "sentiment" | "etf" | "onchain";
  label: string;
  value: number;
  unit: string;
  sourceCode: string;
  sourceUrl: string;
  effectiveAt: string;
  freshness: MetricModel["freshness"] | "fresh" | "unavailable";
};
```

`mergeSeriesPoints` accepts only already unit-compatible series, uses `effectiveAt` as the row key, and omits absent series keys instead of inserting zero. It includes only `trendPoints`, so one-point snapshots cannot become lines.

- [ ] **Step 4: Add failing deterministic-overview tests**

```ts
it("builds sourced overview observations without recommendations", () => {
  const pulse = cryptoMarketPulseSchema.parse({
    generatedAt: "2026-08-14T00:00:00Z",
    fearGreed: {
      status: "system",
      sourceCode: "alternative-fng",
      sourceUrl: "https://alternative.me/crypto/fear-and-greed-index/",
      latest: { effectiveAt: "2026-08-14T00:00:00Z", value: 62, classification: "Greed" },
      series: [{ effectiveAt: "2026-08-14T00:00:00Z", value: 62, classification: "Greed" }],
    },
    etfFlows: {
      status: "system",
      sourceCodes: ["farside-btc-etf", "farside-eth-etf", "farside-sol-etf"],
      series: [{ effectiveAt: "2026-08-14T00:00:00Z", btc: 10, eth: 2, sol: -1, total: 11 }],
      summaries: [
        { asset: "BTC", latest: 10, fiveDay: 20, thirtyDay: 40, latestEffectiveAt: "2026-08-14T00:00:00Z" },
        { asset: "ETH", latest: 2, fiveDay: 3, thirtyDay: 5, latestEffectiveAt: "2026-08-14T00:00:00Z" },
        { asset: "SOL", latest: -1, fiveDay: 1, thirtyDay: 2, latestEffectiveAt: "2026-08-14T00:00:00Z" },
      ],
    },
    fundFlows: {
      status: "unavailable",
      sourceCode: "coinshares-weekly",
      sourceUrl: "https://coinshares.com/corp/resources/market-activity/",
      series: [],
      latestBreakdown: [],
    },
  });
  const metrics = [
    metric(
      "onchain-change",
      "crypto.onchain.active_addresses_change_30d",
      "0.08",
      "2026-08-14T00:00:00Z",
      "return",
    ),
  ];
  const observations = buildCryptoOverviewObservations(pulse, metrics);
  expect(observations.map((item) => item.kind)).toEqual(["sentiment", "etf", "onchain"]);
  expect(observations).toHaveLength(3);
  expect(observations.every((item) => item.sourceCode && item.effectiveAt)).toBe(true);
  expect(observations.map((item) => item.label).join(" ")).not.toMatch(/mua|bán|buy|sell/i);
});
```

- [ ] **Step 5: Implement deterministic overview observations**

Return at most three observations in this priority order:

1. latest Fear & Greed value/classification from `alternative-fng`;
2. latest ETF series total and effective date using the pulse source codes;
3. latest available metric in order `crypto.onchain.adjusted_transfer_change_30d`, `crypto.onchain.active_addresses_change_30d`, `crypto.stablecoin.supply_change_7d`.

Each object is `{ kind, label, value, unit, sourceCode, sourceUrl, effectiveAt, freshness }`. Do not emit an item when its source data is absent.

- [ ] **Step 6: Run tests and verify GREEN**

Run: `npm test -- src/lib/crypto-quant-pulse.test.ts src/lib/crypto-market-pulse-client.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the pure data model**

```powershell
git add -- src/lib/crypto-quant-pulse.ts src/lib/crypto-quant-pulse.test.ts
git commit -m "feat: build Crypto Quant Pulse chart series"
```

### Task 2: Add reusable metric trend panel

**Files:**
- Create: `src/components/smart-insights/CryptoMetricTrendPanel.tsx`
- Modify: `src/components/smart-insights/source-guard.test.ts`

**Interfaces:**
- Consumes: `CryptoMetricSeries[]`, title, description, locale, and empty-state copy.
- Produces: one responsive chart per compatible unit group plus truthful single-value snapshots.

- [ ] **Step 1: Write the failing source contract**

Add a test that calls the existing `readSmartInsightsSourceTree()` helper and asserts these tokens against the joined source tree. This produces an assertion failure, not an `ENOENT`, before the new file exists:

```ts
const source = readSmartInsightsSourceTree();
expect(source).toContain("function CryptoMetricTrendPanel");
for (const token of [
  "ResponsiveContainer",
  "LineChart",
  "trendPoints",
  "FreshnessBadge",
  "sourceUrl",
  "effectiveAt",
  'status="UNAVAILABLE"',
]) expect(source).toContain(token);
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- src/components/smart-insights/source-guard.test.ts`

Expected: FAIL because the component is absent.

- [ ] **Step 3: Implement the panel**

Use existing `Card`, `FreshnessBadge`, `DataStatusBadge`, and Recharts imports. Partition the supplied series by unit. For each unit group:

- render a `LineChart` only when at least one series has `trendPoints.length >= 2`;
- use `connectNulls={false}`;
- use `ResponsiveContainer` in a `h-64 min-w-0` wrapper;
- show the latest value, unit, source link, freshness, and effective date for every series;
- show a compact snapshot row for a single-point series;
- render `DataStatusBadge status="UNAVAILABLE"` when the series array is empty.

Use the existing chart color CSS variables and tabular figures. Do not introduce a new chart library or palette.

The public signature is:

```ts
export function CryptoMetricTrendPanel({
  title,
  description,
  series,
  emptyDescription,
  locale,
}: {
  title: string;
  description: string;
  series: CryptoMetricSeries[];
  emptyDescription: string;
  locale: "vi" | "en";
})
```

The core rendering branch is:

```tsx
if (!series.length) {
  return <DataStatusBadge status="UNAVAILABLE" detail={emptyDescription} />;
}

return unitGroups.map(([unit, compatibleSeries]) => {
  const chartRows = mergeSeriesPoints(compatibleSeries);
  const hasTrend = compatibleSeries.some((item) => item.trendPoints.length >= 2);
  return (
    <section key={unit} className="min-w-0 space-y-3">
      {hasTrend ? (
        <div className="h-64 min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartRows}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="effectiveAt" minTickGap={24} />
              <YAxis unit={unit} width={72} />
              <Tooltip />
              {compatibleSeries.map((item, index) => (
                <Line
                  key={item.key}
                  dataKey={item.key}
                  connectNulls={false}
                  dot={false}
                  stroke={`var(--chart-${(index % 5) + 1})`}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
      <MetricLatestRows series={compatibleSeries} />
    </section>
  );
});
```

Define `mergeSeriesPoints` as a pure exported helper in `src/lib/crypto-quant-pulse.ts` and cover it in Task 1 tests; define `MetricLatestRows` at module scope, not inside the component.

- [ ] **Step 4: Run the source contract and full type check through build**

Run: `npm test -- src/components/smart-insights/source-guard.test.ts`

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: Commit the chart panel**

```powershell
git add -- src/components/smart-insights/CryptoMetricTrendPanel.tsx src/components/smart-insights/source-guard.test.ts
git commit -m "feat: add sourced Crypto metric trend charts"
```

### Task 3: Compose five Crypto decision tabs

**Files:**
- Create: `src/components/smart-insights/CryptoQuantPulseTabs.tsx`
- Modify: `src/components/smart-insights/LegacyMarketPulse.tsx`
- Modify: `src/components/smart-insights/source-guard.test.ts`

**Interfaces:**
- Consumes: `cryptoPulse`, `cryptoPulseState`, `metrics`, `regime`, and `locale` from `LegacyMarketPulse`.
- Consumes: the series and overview builders from Task 1 and `CryptoMetricTrendPanel` from Task 2.
- Produces: one nested tab workspace; it performs no fetch.

- [ ] **Step 1: Write the failing five-tab composition test**

Add:

```ts
it("groups Crypto Quant Pulse into the five approved decision tabs", () => {
  const tabs = readSmartInsightsSourceTree();
  expect(tabs).toContain("function CryptoQuantPulseTabs");
  for (const value of ["overview", "flows", "sentiment", "onchain", "whales"])
    expect(tabs).toContain(`value="${value}"`);
  for (const label of ["Tổng quan", "Dòng tiền", "Tâm lý & Phái sinh", "On-chain", "Cá voi BTC"])
    expect(tabs).toContain(label);
  expect(tabs).toContain('defaultValue="overview"');
  expect(tabs).not.toContain("fetch(");
});
```

Also assert `LegacyMarketPulse.tsx` contains `CryptoQuantPulseTabs` and no longer renders the Crypto `MetricGrid` or the old `onchain.map` block inside `TabsContent value="crypto"`.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- src/components/smart-insights/source-guard.test.ts`

Expected: FAIL because the workspace is absent and Crypto remains a long column.

- [ ] **Step 3: Implement the nested workspace**

Use the existing `Tabs`, `TabsList`, `TabsTrigger`, and `TabsContent`. The list uses `w-full justify-start overflow-x-auto` on narrow widths. Compose:

- `overview`: regime/confidence header, deterministic observation cards, `CryptoFearGreedPanel`, and `CryptoEtfFlowPanel` in a responsive two-column grid;
- `flows`: `CryptoEtfFlowPanel` followed by `CryptoFundFlowPanel`;
- `sentiment`: `CryptoFearGreedPanel` plus `CryptoMetricTrendPanel` built from `DERIVATIVE_METRIC_CODES`;
- `onchain`: `CryptoMetricTrendPanel` built from `ONCHAIN_METRIC_CODES`;
- `whales`: `CryptoLargeAddressPanel`.

Reuse the existing request-mode calculations by moving them into the new component or pass the four derived modes explicitly. Every nested `TabsContent` uses `min-w-0`.

The component signature is:

```ts
export function CryptoQuantPulseTabs({
  cryptoPulse,
  cryptoPulseState,
  metrics,
  regime,
  locale,
}: {
  cryptoPulse: CryptoMarketPulseModel | null;
  cryptoPulseState: "idle" | "loading" | "loaded" | "failed";
  metrics: MetricModel[];
  regime: RegimeModel | undefined;
  locale: "vi" | "en";
})
```

```tsx
<Tabs defaultValue="overview" className="min-w-0">
  <TabsList className="w-full justify-start overflow-x-auto">
    <TabsTrigger value="overview">Tổng quan</TabsTrigger>
    <TabsTrigger value="flows">Dòng tiền</TabsTrigger>
    <TabsTrigger value="sentiment">Tâm lý &amp; Phái sinh</TabsTrigger>
    <TabsTrigger value="onchain">On-chain</TabsTrigger>
    <TabsTrigger value="whales">Cá voi BTC</TabsTrigger>
  </TabsList>
  <TabsContent value="overview" className="min-w-0 space-y-6">
    <CryptoOverviewSummary observations={overviewObservations} regime={regime} />
    <div className="grid min-w-0 gap-6 xl:grid-cols-2">
      <CryptoFearGreedPanel data={cryptoPulse?.fearGreed ?? null} mode={fearMode} locale={locale} />
      <CryptoEtfFlowPanel data={cryptoPulse?.etfFlows ?? null} mode={etfMode} locale={locale} />
    </div>
  </TabsContent>
  <TabsContent value="flows" className="min-w-0 space-y-6">
    <CryptoEtfFlowPanel data={cryptoPulse?.etfFlows ?? null} mode={etfMode} locale={locale} />
    <CryptoFundFlowPanel data={cryptoPulse?.fundFlows ?? null} mode={fundMode} locale={locale} />
  </TabsContent>
  <TabsContent value="sentiment" className="min-w-0 space-y-6">
    <CryptoFearGreedPanel data={cryptoPulse?.fearGreed ?? null} mode={fearMode} locale={locale} />
    <CryptoMetricTrendPanel
      title="Phái sinh"
      description="Funding, open interest và biến động theo thời gian."
      series={derivativeSeries}
      emptyDescription="Chưa có chuỗi phái sinh đã xác thực."
      locale={locale}
    />
  </TabsContent>
  <TabsContent value="onchain" className="min-w-0">
    <CryptoMetricTrendPanel
      title="On-chain"
      description="Hoạt động mạng, định giá và thanh khoản stablecoin."
      series={onchainSeries}
      emptyDescription="Chưa có chuỗi on-chain đã xác thực."
      locale={locale}
    />
  </TabsContent>
  <TabsContent value="whales" className="min-w-0">
    <CryptoLargeAddressPanel data={cryptoPulse?.largeAddressActivity ?? null} mode={largeAddressMode} locale={locale} />
  </TabsContent>
</Tabs>
```

`CryptoOverviewSummary` is a module-scope component in the same file. It renders no recommendation; it maps the three sourced observation objects and displays the regime label, confidence, coverage, effective time, and freshness.

- [ ] **Step 4: Delegate from LegacyMarketPulse**

Keep its `fetchCryptoMarketPulse` effect unchanged as the single owner. Replace only the sequential Crypto panel block with:

```tsx
<CryptoQuantPulseTabs
  cryptoPulse={cryptoPulse}
  cryptoPulseState={cryptoPulseState}
  metrics={cryptoMetrics}
  regime={selectedRegime}
  locale={locale}
/>
```

Keep Macro and Gold `MetricGrid` behavior unchanged.

- [ ] **Step 5: Run focused tests and build**

Run: `npm test -- src/components/smart-insights/source-guard.test.ts src/lib/crypto-quant-pulse.test.ts src/lib/crypto-market-pulse-client.test.ts`

Run: `npm run build`

Expected: PASS and no duplicate fetch exists in `CryptoQuantPulseTabs.tsx`.

- [ ] **Step 6: Commit the five-tab workspace**

```powershell
git add -- src/components/smart-insights/CryptoQuantPulseTabs.tsx src/components/smart-insights/LegacyMarketPulse.tsx src/components/smart-insights/source-guard.test.ts
git commit -m "feat: organize Crypto Quant Pulse into decision tabs"
```

### Task 4: Verify complete Smart Insights and CryptoCraft state

**Files:**
- Modify: `docs/operations/smart-insights-runbook.md` only when recording current verified evidence.
- Modify production/test files only after a failing regression reproduces a rendered defect.

**Interfaces:**
- Consumes: completed ticker plan and Tasks 1-3.
- Produces: regression, build, local runtime, rendered UI, and Calendar truth evidence.

- [ ] **Step 1: Run complete automated gates**

```powershell
npm test
npm run lint
npm run build
```

Expected: full Vitest and build PASS; no new lint errors. Distinguish pre-existing warnings or format failures from changed-file failures.

- [ ] **Step 2: Verify local services**

Start or reuse `npm run dev`, then require HTTP 200 from:

```powershell
Invoke-WebRequest http://127.0.0.1:3100 -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:8100/healthz -UseBasicParsing
```

- [ ] **Step 3: Verify CryptoCraft database truth read-only**

Using the configured Prisma client, read only:

- latest `ProviderRun` where `provider = "cryptocraft"`;
- current and next week `EconomicEvent` count where `sourceCode = "cryptocraft"`;
- latest event `observedAt` and `qualityStatus`.

Expected from the approved 2026-08-14 baseline: latest run `succeeded`, 20 records, null error code, and 44 current-plus-next-week event/revision rows. If live state has changed, report the current values and do not rewrite them to match the baseline.

- [ ] **Step 4: Run authenticated rendered QA**

Use the available Browser plugin and existing signed-in session. The flow is: open Smart Insights -> open Crypto -> switch through all five nested tabs -> verify each visible chart/snapshot and source state -> inspect CryptoCraft Economic Calendar.

At desktop and mobile widths confirm:

- page identity and meaningful content;
- no framework overlay or relevant console error;
- tab list remains navigable without widening the page;
- each tab switch changes the visible chart content without refetching Crypto Market Pulse;
- chart axes/tooltips do not clip and use explicit units;
- one-point metrics render as snapshots;
- source, effective time, and freshness remain visible;
- Whale tab preserves chart-first BTC-only content;
- Calendar displays live events when returned and uses `Dữ liệu mẫu` only for an empty result.

Capture screenshots outside the repository.

- [ ] **Step 5: Update operational evidence and rerun changed-file tests**

Add a dated, concise runbook note containing only status, counts, URLs, and QA state; do not include raw CryptoCraft event payloads. Run `git diff --check`, focused tests for every corrected file, then the full web suite again.

- [ ] **Step 6: Commit verified evidence**

```powershell
git add -- docs/operations/smart-insights-runbook.md
git commit -m "docs: record Smart Insights Crypto tabs verification"
```

If the runbook did not change, create no empty commit.
