# Crypto Market Pulse Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Smart Insights Market Pulse for Crypto with quantitative 30-day Fear & Greed, 30-day BTC/ETH/SOL ETF flow, and 12-week CoinShares fund-flow charts plus exact-value tables.

**Architecture:** Add one bounded database read model and one authenticated route dedicated to this surface. Parse that contract with Zod on the client, then compose three focused Recharts panels inside the restored `LegacyMarketPulse` card while keeping explicit system, unavailable, and sample states.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.8, Prisma 7/PostgreSQL, Zod 4, Recharts 2, Tailwind CSS 4, Vitest 4.

## Global Constraints

- Keep the restored Smart Insights layout and existing card, color, spacing, and typography styles.
- Fixed server windows: Fear & Greed 30 days, Farside ETF flow 30 calendar days, CoinShares latest 12 reported weeks.
- Query only observations with `qualityStatus` equal to `passed` or `warning`.
- Farside must use only rows whose `dimensions.fund` equals `TOTAL`; missing asset values stay `null`, never zero.
- Flow values remain USD in the API and are formatted as `US$m` or `US$bn` only in the UI.
- Seed data must be defined only in UI modules and visibly labelled `Dữ liệu mẫu`; it must never enter the API, database, regimes, or briefings.
- CoinShares stays unavailable until its live fail-closed OCR collector publishes accepted observations.
- Use direct Recharts imports; add no dependency.
- Preserve unrelated dirty files, especially `next-env.d.ts`, and stage only files named by each task.

---

## File map

- `src/lib/backend/crypto-market-pulse.ts`: database queries, revision deduplication, classification, pivoting, and summaries.
- `src/lib/backend/crypto-market-pulse.test.ts`: unit contract for all aggregation rules.
- `src/app/api/smart-insights/crypto-market-pulse/route.ts`: `research:read` authorization and JSON response.
- `src/app/api/smart-insights/crypto-market-pulse/route.test.ts`: route authorization and failure behavior.
- `src/lib/crypto-market-pulse-client.ts`: Zod schemas, inferred UI types, and fetch helper.
- `src/lib/crypto-market-pulse-client.test.ts`: malformed payload rejection and valid nullable-flow parsing.
- `src/components/smart-insights/CryptoFearGreedPanel.tsx`: gauge, 30-day trend, classification bands, and 7-day table.
- `src/components/smart-insights/CryptoEtfFlowPanel.tsx`: asset summaries, grouped flow bars, legend controls, and 30-day table.
- `src/components/smart-insights/CryptoFundFlowPanel.tsx`: system/sample 12-week stacked bars and latest breakdown.
- `src/components/smart-insights/LegacyMarketPulse.tsx`: request lifecycle and Crypto panel composition.
- `src/components/smart-insights/source-guard.test.ts`: source-level UI/provenance regression guard.

### Task 1: Build the bounded Crypto read model

**Files:**

- Create: `src/lib/backend/crypto-market-pulse.ts`
- Create: `src/lib/backend/crypto-market-pulse.test.ts`

**Interfaces:**

- Produces: `loadCryptoMarketPulse(now?: Date): Promise<CryptoMarketPulseResponse>`.
- Produces: exported `CryptoMarketPulseResponse` and its nested row/status types for the route.
- Consumes: `getPrisma().metricObservation.findMany` and existing Prisma relations `metricDefinition`, `provider`, and `rawSnapshot`.

- [ ] **Step 1: Write failing aggregation tests**

Mock `getPrisma()` as existing backend tests do. Use rows that deliberately include a lower revision, a Farside non-total fund row, missing ETH on one date, and more than five BTC trading dates.

```ts
it("deduplicates revisions and keeps only Farside TOTAL rows", async () => {
  prisma.metricObservation.findMany
    .mockResolvedValueOnce([
      fearRow({ revision: 2, value: 24 }),
      fearRow({ revision: 1, value: 20 }),
    ])
    .mockResolvedValueOnce([
      etfRow({ provider: "farside-btc-etf", fund: "TOTAL", value: 100 }),
      etfRow({ provider: "farside-btc-etf", fund: "IBIT", value: 999 }),
    ])
    .mockResolvedValueOnce([]);

  const result = await loadCryptoMarketPulse(new Date("2026-08-14T12:00:00Z"));
  expect(result.fearGreed.series).toHaveLength(1);
  expect(result.fearGreed.latest?.classification).toBe("Extreme Fear");
  expect(result.etfFlows.series[0]?.btc).toBe(100);
});
```

Add separate tests asserting:

```ts
expect(result.etfFlows.series[0]).toEqual({
  effectiveAt: "2026-08-12T00:00:00.000Z",
  btc: 100,
  eth: null,
  sol: -25,
  total: 75,
});
expect(result.etfFlows.summaries.find((row) => row.asset === "BTC")?.fiveDay).toBe(150);
expect(result.fundFlows.series.at(-1)?.total).toBe(12_000_000);
expect(result.fundFlows.latestBreakdown[0]).toEqual({ label: "Bitcoin", value: 10_000_000 });
```

- [ ] **Step 2: Run the backend test and confirm the red state**

Run: `npx vitest run src/lib/backend/crypto-market-pulse.test.ts`

Expected: FAIL because `crypto-market-pulse.ts` and `loadCryptoMarketPulse` do not exist.

- [ ] **Step 3: Define exact read-model types and pure helpers**

Implement these exported shapes exactly:

```ts
export type CryptoMarketPulseResponse = {
  generatedAt: string;
  fearGreed: {
    status: "system" | "unavailable";
    sourceCode: "alternative-fng";
    sourceUrl: string;
    latest: { effectiveAt: string; value: number; classification: string } | null;
    series: Array<{ effectiveAt: string; value: number; classification: string }>;
  };
  etfFlows: {
    status: "system" | "partial" | "unavailable";
    sourceCodes: string[];
    series: Array<{
      effectiveAt: string;
      btc: number | null;
      eth: number | null;
      sol: number | null;
      total: number;
    }>;
    summaries: Array<{
      asset: "BTC" | "ETH" | "SOL";
      latest: number | null;
      fiveDay: number | null;
      thirtyDay: number | null;
      latestEffectiveAt: string | null;
    }>;
  };
  fundFlows: {
    status: "system" | "unavailable";
    sourceCode: "coinshares-weekly";
    sourceUrl: string;
    series: Array<{
      effectiveAt: string;
      total: number;
      assets: Array<{ label: string; value: number }>;
    }>;
    latestBreakdown: Array<{ label: string; value: number }>;
  };
};
```

Use helpers with these signatures so revision and dimension rules remain unit-testable:

```ts
function classifyFearGreed(value: number): string;
function dimensions(value: Prisma.JsonValue): Record<string, unknown>;
function latestRevision<T extends { naturalKey: string; revision: number }>(rows: T[]): T[];
function sumOrNull(values: Array<number | null>): number | null;
```

Classification boundaries are `0-24 Extreme Fear`, `25-44 Fear`, `45-54 Neutral`, `55-74 Greed`, and `75-100 Extreme Greed`.

- [ ] **Step 4: Implement the three bounded queries and shaping rules**

In `loadCryptoMarketPulse(now = new Date())`, run the independent queries with `Promise.all`:

```ts
const accepted = ["passed", "warning"];
const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

const [fearRows, etfRows, coinSharesRows] = await Promise.all([
  prisma.metricObservation.findMany({
    where: {
      qualityStatus: { in: accepted },
      effectiveAt: { gte: thirtyDaysAgo, lte: now },
      metricDefinition: { code: "crypto.fear_greed.index" },
      provider: { code: "alternative-fng" },
    },
    orderBy: [{ effectiveAt: "asc" }, { revision: "desc" }],
    include: { rawSnapshot: { select: { sourceUrl: true } } },
  }),
  prisma.metricObservation.findMany({
    where: {
      qualityStatus: { in: accepted },
      effectiveAt: { gte: thirtyDaysAgo, lte: now },
      metricDefinition: { code: "crypto.etf.net_flow_usd" },
      provider: { code: { in: ["farside-btc-etf", "farside-eth-etf", "farside-sol-etf"] } },
    },
    orderBy: [{ effectiveAt: "asc" }, { revision: "desc" }],
    include: { provider: { select: { code: true } } },
  }),
  prisma.metricObservation.findMany({
    where: {
      qualityStatus: { in: accepted },
      metricDefinition: { code: "crypto.coinshares.net_flow_usd" },
      provider: { code: "coinshares-weekly" },
      effectiveAt: { lte: now },
    },
    orderBy: [{ effectiveAt: "desc" }, { revision: "desc" }],
    take: 500,
  }),
]);
```

Filter `dimensions.fund === "TOTAL"` and `typeof dimensions.asset === "string"` in TypeScript. Deduplicate by `naturalKey`, select the latest 12 distinct CoinShares dates, sort chart rows ascending, use the provider `Total` row as the weekly total, and sort `latestBreakdown` by absolute value descending while excluding `Total`.

Set ETF status to `unavailable` for no accepted total rows, `system` when all BTC/ETH/SOL source codes are present, otherwise `partial`. Compute `fiveDay` from each asset's latest five non-null reported rows and `thirtyDay` from all non-null rows.

- [ ] **Step 5: Run tests and commit the read model**

Run: `npx vitest run src/lib/backend/crypto-market-pulse.test.ts`

Expected: PASS, including revision, null, five-trading-day, provider-total, and 12-week assertions.

```powershell
git add src/lib/backend/crypto-market-pulse.ts src/lib/backend/crypto-market-pulse.test.ts
git commit -m "feat: add crypto market pulse read model"
```

### Task 2: Expose and validate the authenticated API contract

**Files:**

- Create: `src/app/api/smart-insights/crypto-market-pulse/route.ts`
- Create: `src/app/api/smart-insights/crypto-market-pulse/route.test.ts`
- Create: `src/lib/crypto-market-pulse-client.ts`
- Create: `src/lib/crypto-market-pulse-client.test.ts`

**Interfaces:**

- Consumes: `loadCryptoMarketPulse(): Promise<CryptoMarketPulseResponse>` from Task 1.
- Produces: `cryptoMarketPulseSchema`, `CryptoMarketPulseModel`, and `fetchCryptoMarketPulse(signal?)`.

- [ ] **Step 1: Write failing route authorization tests**

Mock the tenant functions and read model, then assert the capability and response:

```ts
it("requires research read and returns the bounded read model", async () => {
  requireTenantContext.mockResolvedValue(context);
  loadCryptoMarketPulse.mockResolvedValue(payload);

  const response = await GET(new Request("http://local/api/smart-insights/crypto-market-pulse"));

  expect(requireTenantCapability).toHaveBeenCalledWith(context, "research", "read");
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual(payload);
});
```

Also make `loadCryptoMarketPulse` reject with `new Error("Database unavailable")` and assert that `apiError` returns HTTP 503 with `{ error: "Database unavailable" }`.

- [ ] **Step 2: Write failing Zod contract tests**

Use one valid payload containing an ETF `null`, then mutate it:

```ts
expect(cryptoMarketPulseSchema.parse(validPayload).etfFlows.series[0]?.eth).toBeNull();
expect(() =>
  cryptoMarketPulseSchema.parse({
    ...validPayload,
    etfFlows: { ...validPayload.etfFlows, status: "seed" },
  }),
).toThrow();
expect(() =>
  cryptoMarketPulseSchema.parse({
    ...validPayload,
    etfFlows: { ...validPayload.etfFlows, series: [{ effectiveAt: "x", btc: "100" }] },
  }),
).toThrow();
```

- [ ] **Step 3: Run both focused tests and confirm the red state**

Run: `npx vitest run src/app/api/smart-insights/crypto-market-pulse/route.test.ts src/lib/crypto-market-pulse-client.test.ts`

Expected: FAIL because the route and client schema do not exist.

- [ ] **Step 4: Implement the route with the existing API error pattern**

```ts
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "research", "read");
    return NextResponse.json(await loadCryptoMarketPulse());
  } catch (error) {
    return apiError(error, 503);
  }
}
```

- [ ] **Step 5: Implement the exact Zod response schema and fetch helper**

Mirror every field and enum from `CryptoMarketPulseResponse`; use `z.number().nullable()` for asset flows and `z.number()` for totals.

```ts
export type CryptoMarketPulseModel = z.infer<typeof cryptoMarketPulseSchema>;

export async function fetchCryptoMarketPulse(
  signal?: AbortSignal,
): Promise<CryptoMarketPulseModel> {
  const response = await fetch("/api/smart-insights/crypto-market-pulse", {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Crypto Market Pulse request failed (${response.status}).`);
  return cryptoMarketPulseSchema.parse(await response.json());
}
```

- [ ] **Step 6: Run tests and commit the API slice**

Run: `npx vitest run src/app/api/smart-insights/crypto-market-pulse/route.test.ts src/lib/crypto-market-pulse-client.test.ts`

Expected: PASS.

```powershell
git add src/app/api/smart-insights/crypto-market-pulse/route.ts src/app/api/smart-insights/crypto-market-pulse/route.test.ts src/lib/crypto-market-pulse-client.ts src/lib/crypto-market-pulse-client.test.ts
git commit -m "feat: expose crypto market pulse API"
```

### Task 3: Add Fear & Greed and ETF chart-table panels

**Files:**

- Create: `src/components/smart-insights/CryptoFearGreedPanel.tsx`
- Create: `src/components/smart-insights/CryptoEtfFlowPanel.tsx`
- Modify: `src/components/smart-insights/source-guard.test.ts`

**Interfaces:**

- Consumes: `CryptoMarketPulseModel["fearGreed"]` and `CryptoMarketPulseModel["etfFlows"]`.
- Produces: `CryptoFearGreedPanel` and `CryptoEtfFlowPanel`, each accepting `{ data, mode, locale }` where `mode` is `"loading" | "system" | "sample" | "unavailable"`.

- [ ] **Step 1: Extend the source guard with failing UI/provenance assertions**

Require component names, charts, table headers, sources, and module-level sample labels:

```ts
for (const token of [
  "CryptoFearGreedPanel",
  "CryptoEtfFlowPanel",
  "LineChart",
  "BarChart",
  "alternative.me/crypto/fear-and-greed-index",
  "farside.co.uk",
  "Dữ liệu mẫu",
  "BTC",
  "ETH",
  "SOL",
])
  expect(source).toContain(token);
```

- [ ] **Step 2: Run the source guard and confirm the red state**

Run: `npx vitest run src/components/smart-insights/source-guard.test.ts`

Expected: FAIL because both panel components are absent.

- [ ] **Step 3: Implement the Fear & Greed panel**

Keep the existing semicircle gauge, and add a responsive `LineChart` with `ReferenceArea` bands at `0-24`, `25-44`, `45-54`, `55-74`, and `75-100`. Use `ResponsiveContainer` with a height class of at least `h-[280px]`.

Render the last seven points in a horizontally scrollable table:

```tsx
<table className="min-w-[620px] text-sm">
  <thead>
    <tr>
      <th>Ngày</th>
      <th>Chỉ số</th>
      <th>Phân loại</th>
      <th>Trạng thái</th>
      <th>Nguồn</th>
    </tr>
  </thead>
  <tbody>{data.series.slice(-7).reverse().map(/* exact row */)}</tbody>
</table>
```

Render `DataStatusBadge status="SYSTEM"` for system rows, `status="SAMPLE"` plus `Dữ liệu mẫu` for request fallback, and an explicit unavailable message for a valid empty API response. Link to Alternative.me with `target="_blank" rel="noreferrer"`.

- [ ] **Step 4: Implement the ETF panel and keyboard-operable legend**

Use stable series keys/colors: BTC `#f59e0b`, ETH `#6366f1`, SOL `#14b8a6`. Maintain a `Set<"btc" | "eth" | "sol">` of visible series and render legend entries as native `<button type="button" aria-pressed={visible}>` controls.

```tsx
<BarChart data={data.series} stackOffset="sign">
  <ReferenceLine y={0} stroke="hsl(var(--border))" />
  {visible.has("btc") ? <Bar dataKey="btc" fill="#f59e0b" /> : null}
  {visible.has("eth") ? <Bar dataKey="eth" fill="#6366f1" /> : null}
  {visible.has("sol") ? <Bar dataKey="sol" fill="#14b8a6" /> : null}
</BarChart>
```

Do not stack the three bars: grouped bars must retain separate positions around the same date. Add BTC/ETH/SOL summary cards for latest, 5D, and 30D. Add a `min-w-[760px]` table with `Date | BTC | ETH | SOL | Total`; show an em dash for null, bull color for positive, bear color for negative, and a source link to Farside.

- [ ] **Step 5: Run the guard and targeted lint**

Run: `npx vitest run src/components/smart-insights/source-guard.test.ts`

Run: `npx eslint src/components/smart-insights/CryptoFearGreedPanel.tsx src/components/smart-insights/CryptoEtfFlowPanel.tsx src/components/smart-insights/source-guard.test.ts`

Expected: both commands PASS.

- [ ] **Step 6: Commit the two panels**

```powershell
git add src/components/smart-insights/CryptoFearGreedPanel.tsx src/components/smart-insights/CryptoEtfFlowPanel.tsx src/components/smart-insights/source-guard.test.ts
git commit -m "feat: visualize crypto sentiment and ETF flows"
```

### Task 4: Add CoinShares system/sample panel and compose Crypto Market Pulse

**Files:**

- Create: `src/components/smart-insights/CryptoFundFlowPanel.tsx`
- Modify: `src/components/smart-insights/LegacyMarketPulse.tsx`
- Modify: `src/components/smart-insights/source-guard.test.ts`

**Interfaces:**

- Consumes: `fetchCryptoMarketPulse(signal?)` and all panel interfaces from Tasks 2-3.
- Produces: the complete Crypto tab with one request lifecycle and three independently visible module states.

- [ ] **Step 1: Add failing guard assertions for CoinShares and composition**

```ts
for (const token of [
  "CryptoFundFlowPanel",
  "COINSHARES_SAMPLE_12_WEEKS",
  "coinshares.com/corp/resources/market-activity",
  "fetchCryptoMarketPulse",
])
  expect(source).toContain(token);
```

Also assert the seed constant does not occur under `src/lib/backend` or `src/app/api`.

- [ ] **Step 2: Run the guard and confirm the red state**

Run: `npx vitest run src/components/smart-insights/source-guard.test.ts`

Expected: FAIL because the CoinShares panel and dedicated request are absent.

- [ ] **Step 3: Implement the fixed 12-week CoinShares sample and system renderer**

Define `COINSHARES_SAMPLE_12_WEEKS` only in `CryptoFundFlowPanel.tsx`. Give each point `effectiveAt`, `total`, and `assets` with stable labels such as `Bitcoin`, `Ethereum`, `Solana`, and `Multi-asset`; do not export it to backend code.

For system data, derive the union of asset labels and render one signed stacked `<Bar stackId="fund-flow">` per label. For unavailable data, chart the fixed sample with a visible `DataStatusBadge status="SAMPLE"` and this note:

```tsx
<p>Dữ liệu mẫu — CoinShares chưa có quan sát đạt kiểm định OCR để công bố.</p>
```

Render the latest breakdown table sorted by absolute flow magnitude and a source link. Use a scroll container on mobile and a chart height of at least 280 px.

- [ ] **Step 4: Add one abortable request to `LegacyMarketPulse`**

Add state that distinguishes a transport failure from a valid empty response:

```ts
const [cryptoPulse, setCryptoPulse] = useState<CryptoMarketPulseModel | null>(null);
const [cryptoPulseState, setCryptoPulseState] = useState<"idle" | "loading" | "loaded" | "failed">(
  "idle",
);

useEffect(() => {
  if (market !== "crypto") return;
  const controller = new AbortController();
  setCryptoPulseState("loading");
  fetchCryptoMarketPulse(controller.signal)
    .then((payload) => {
      if (!controller.signal.aborted) {
        setCryptoPulse(payload);
        setCryptoPulseState("loaded");
      }
    })
    .catch(() => {
      if (!controller.signal.aborted) setCryptoPulseState("failed");
    });
  return () => controller.abort();
}, [market]);
```

Compose the panels inside `TabsContent value="crypto"` before the generic metric grid. Map states as follows:

- `loading`: skeletons in all three modules.
- `failed`: Fear & Greed and Farside use their local fixed samples with `Dữ liệu mẫu`; CoinShares uses its local sample.
- `loaded` plus source status `system`/`partial`: render API data.
- `loaded` plus source status `unavailable`: Fear & Greed/Farside show unavailable; CoinShares shows its explicitly approved sample.

- [ ] **Step 5: Run component checks and commit composition**

Run: `npx vitest run src/components/smart-insights/source-guard.test.ts src/lib/crypto-market-pulse-client.test.ts`

Run: `npx eslint src/components/smart-insights/LegacyMarketPulse.tsx src/components/smart-insights/CryptoFundFlowPanel.tsx src/components/smart-insights/CryptoFearGreedPanel.tsx src/components/smart-insights/CryptoEtfFlowPanel.tsx`

Expected: PASS.

```powershell
git add src/components/smart-insights/CryptoFundFlowPanel.tsx src/components/smart-insights/LegacyMarketPulse.tsx src/components/smart-insights/source-guard.test.ts
git commit -m "feat: complete crypto market pulse panels"
```

### Task 5: Verify data truth, responsive behavior, and delivery scope

**Files:**

- Modify only if a verification failure identifies a defect in files from Tasks 1-4.
- Do not modify: `quant-worker/smart_insights/sources.py` or CoinShares enablement; this feature consumes only already accepted observations.

**Interfaces:**

- Consumes: completed API and UI.
- Produces: evidence that tests, build, database truth, local HTTP, and rendered UI are separately valid.

- [ ] **Step 1: Run the complete automated verification chain**

```powershell
npx vitest run
npx tsc --noEmit
npx eslint src/lib/backend/crypto-market-pulse.ts src/lib/backend/crypto-market-pulse.test.ts src/app/api/smart-insights/crypto-market-pulse/route.ts src/app/api/smart-insights/crypto-market-pulse/route.test.ts src/lib/crypto-market-pulse-client.ts src/lib/crypto-market-pulse-client.test.ts src/components/smart-insights/CryptoFearGreedPanel.tsx src/components/smart-insights/CryptoEtfFlowPanel.tsx src/components/smart-insights/CryptoFundFlowPanel.tsx src/components/smart-insights/LegacyMarketPulse.tsx src/components/smart-insights/source-guard.test.ts
npm run build
```

Expected: all tests pass, TypeScript exits 0, targeted ESLint exits 0, and Next production build exits 0.

- [ ] **Step 2: Verify database provenance without treating seed/sample as live**

Run a read-only Prisma/SQL diagnostic that reports provider code, metric code, `quality_status`, maximum `effective_at`, and count for:

```text
alternative-fng / crypto.fear_greed.index
farside-btc-etf / crypto.etf.net_flow_usd / fund=TOTAL
farside-eth-etf / crypto.etf.net_flow_usd / fund=TOTAL
farside-sol-etf / crypto.etf.net_flow_usd / fund=TOTAL
coinshares-weekly / crypto.coinshares.net_flow_usd
```

Expected: Alternative.me and enabled Farside sources have accepted rows; CoinShares may have zero accepted rows and must then remain visibly sample-backed in the UI.

- [ ] **Step 3: Restart the canonical local stack and verify listeners**

Use `npm run dev` (the repository launcher uses web port 3100 and engine port 8100). Verify separately:

```powershell
Invoke-WebRequest http://127.0.0.1:3100 -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:8100/healthz -UseBasicParsing
```

Expected: both responses return HTTP 200 before reporting a test URL.

- [ ] **Step 4: Perform authenticated desktop and mobile rendered QA**

At `http://127.0.0.1:3100`, open Smart Insights and check:

- Desktop: old blocks remain present; Crypto shows the gauge plus line chart, grouped ETF chart, and CoinShares chart in the existing visual style.
- Tables show exact values and source links; missing ETF observations render as em dashes.
- Legend buttons toggle BTC/ETH/SOL with keyboard activation and expose `aria-pressed`.
- Mobile width near 390 px: panels stack, charts remain at least 280 px high, legends wrap, and tables scroll horizontally without clipping page content.
- Each module visibly distinguishes `SYSTEM`, `Unavailable`, and `Dữ liệu mẫu` according to the state map.

Capture screenshots only if the browser tool is operational. If it is unavailable, report HTTP/build evidence separately and do not claim rendered visual verification.

- [ ] **Step 5: Review the exact delivery diff and commit only verification fixes**

```powershell
git status --short
git diff --check
git log --oneline -5
```

Expected: `git diff --check` has no whitespace errors, `next-env.d.ts` remains unstaged, and the task commits contain only the approved Crypto Market Pulse/spec/UI restoration scope.

If Step 1-4 identifies a defect, return to the owning task, add a named regression test there, rerun that task's focused checks, and stage only the named implementation and regression-test files from that task before committing `fix: harden crypto market pulse verification`.

Do not merge or push until every required local gate above is green and the user confirms the delivery step.
