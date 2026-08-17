# Smart Insights Analysis Date Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authenticated investors select a published Smart Insights analysis date while keeping market data explicitly current, and run queued manual briefing refreshes promptly on the VPS.

**Architecture:** Add a tenant-scoped date-catalog read next to the existing exact-date briefing API, then make `SmartInsights` own a server-derived selected date and isolate briefing-bound loading from current market sections. Add a dedicated hardened systemd consumer for `smart_insight_refresh_requests` and teach atomic deploy/provision flows to install, restart, enable, and verify it.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.8, Zod 4, Prisma 7/PostgreSQL, Vitest 4, Playwright, Python 3.12/psycopg, Bash/systemd, GitHub Actions.

## Global Constraints

- The selected date changes only the daily briefing, portfolio-change digest, and AI asset opinions.
- Market Pulse, current portfolio/watchlist state, quotes, and Economic Calendar remain current and receive a visible current-data label.
- Default to `Today`; never silently substitute the latest older briefing.
- Offer `Today` plus at most 90 tenant-and-user-scoped published dates, newest first.
- Use `Asia/Bangkok`, matching the existing Smart Insights generator and production environment.
- Historical analysis is read-only; refresh actions and polling are today-only.
- Interactive briefing reads remain in PostgreSQL, not S3.
- Do not generate placeholder opinions, backfill arbitrary history, or change quant scoring, evidence gates, AI prompts, or recommendation logic.
- Add no new npm or Python dependency.
- Follow strict TDD: name the production break, observe the focused test fail, implement the minimum, observe it pass, then commit only that task's files.

---

## File Structure

### New files

- `src/app/api/smart-insights/briefing/dates/route.ts` — authenticated date-catalog HTTP boundary.
- `src/app/api/smart-insights/briefing/dates/route.test.ts` — authorization, payload, and private-cache route behavior.
- `src/components/smart-insights/AnalysisDateControl.tsx` — accessible Today shortcut and published-date selector.
- `src/components/smart-insights/AnalysisDateControl.test.tsx` — deterministic date-option and rendered-state behavior.
- `deploy/linux/systemd/datavest-smart-insights-refresh.service` — continuous refresh-queue consumer.

### Modified files

- `src/lib/backend/smart-insights.ts` — strict ISO date parsing, business-date derivation, and bounded date catalog.
- `src/lib/backend/smart-insights.test.ts` — real repository contract tests for date parsing and catalog scoping.
- `src/app/api/smart-insights/briefing/route.ts` — distinguish missing today lifecycle from missing history.
- `src/app/api/smart-insights/briefing/route.test.ts` — exact-date lifecycle behavior.
- `src/app/api/tenant-routes.test.ts` — mock/export wiring for the new backend read where required.
- `src/lib/smart-insights-client.ts` — date-catalog schema/client and exact-date briefing fetch.
- `src/lib/smart-insights-client.test.ts` — literal URL and response-contract tests.
- `src/components/SmartInsights.tsx` — selected-date orchestration, abortable fetches, today-only polling, and briefing-only loading.
- `src/components/smart-insights/AssetOpinions.tsx` — one section-level missing-briefing state and today-only refresh surface.
- `src/components/smart-insights/AssetOpinionList.tsx` — date-aware per-asset absence without repeated page-level errors.
- `src/components/smart-insights/AssetOpinions.test.tsx` — missing-briefing versus missing-symbol behavior.
- `src/components/smart-insights/LegacyMarketPulse.tsx` — current-data label.
- `src/components/smart-insights/EconomicCalendar.tsx` — localized current-data label.
- `e2e/smart-insights-asset-opinions.spec.ts` — authenticated Today/historical selection flow.
- `scripts/release/deployment-config-contract.test.mjs` — parse and validate the new unit.
- `scripts/release/deploy-contract.test.mjs` — release activation/rollback service contract.
- `scripts/release/provision-contract.test.mjs` — provisioning syntax and unit-install contract.
- `deploy/linux/provision-datavest.sh` — install the unit during provisioning.
- `deploy/linux/deploy-datavest.sh` — install/reload/restart/enable/verify the unit on an existing VPS and during rollback.

---

### Task 1: Tenant-scoped briefing date catalog

**Files:**
- Modify: `src/lib/backend/smart-insights.ts`
- Modify: `src/lib/backend/smart-insights.test.ts`
- Create: `src/app/api/smart-insights/briefing/dates/route.ts`
- Create: `src/app/api/smart-insights/briefing/dates/route.test.ts`
- Modify: `src/app/api/tenant-routes.test.ts`

**Interfaces:**
- Consumes: `TenantContext`, `getPrisma().dailyBriefing.groupBy`, `requireTenantContext`, and `requireTenantCapability`.
- Produces: `BriefingDateCatalog`, `smartInsightsToday(now?: Date): string`, and `loadBriefingDateCatalog(context, now?): Promise<BriefingDateCatalog>`.

- [ ] **Step 1: Write failing backend tests for the server date and bounded tenant scope**

Add `dailyBriefing.groupBy: vi.fn()` to the Prisma double and import the new functions. Use literal expected dates:

```ts
it("returns Bangkok today and the newest tenant-member briefing dates", async () => {
  prisma.dailyBriefing.groupBy.mockResolvedValue([
    { effectiveDate: new Date("2026-08-16T00:00:00.000Z") },
    { effectiveDate: new Date("2026-08-15T00:00:00.000Z") },
  ]);

  await expect(
    loadBriefingDateCatalog(
      { organizationId: "org-a", userId: "user-a", role: "viewer" } as never,
      new Date("2026-08-16T18:30:00.000Z"),
    ),
  ).resolves.toEqual({
    today: "2026-08-17",
    dates: ["2026-08-16", "2026-08-15"],
  });
  expect(prisma.dailyBriefing.groupBy).toHaveBeenCalledWith({
    by: ["effectiveDate"],
    where: { organizationId: "org-a", userId: "user-a" },
    orderBy: { effectiveDate: "desc" },
    take: 90,
  });
});
```

Add a second case whose mocked rows contain a duplicate effective date and more than 90 values. This makes the response bound observable even if the repository adapter changes how `groupBy` applies `take`:

```ts
it("deduplicates and caps the catalog at 90 dates", async () => {
  const rows = Array.from({ length: 91 }, (_, index) => {
    const effectiveDate = new Date("2026-08-17T00:00:00.000Z");
    effectiveDate.setUTCDate(effectiveDate.getUTCDate() - index);
    return { effectiveDate };
  });
  prisma.dailyBriefing.groupBy.mockResolvedValue([rows[0], ...rows]);
  const result = await loadBriefingDateCatalog(
    { organizationId: "org-a", userId: "user-a", role: "viewer" } as never,
  );
  expect(result.dates).toHaveLength(90);
  expect(new Set(result.dates).size).toBe(90);
});
```

- [ ] **Step 2: Run the backend test and observe the missing function failure**

Run: `npx vitest run src/lib/backend/smart-insights.test.ts`

Expected: FAIL because `loadBriefingDateCatalog` and `smartInsightsToday` do not exist.

- [ ] **Step 3: Implement the minimal backend catalog**

Add focused exports in `smart-insights.ts`:

```ts
export type BriefingDateCatalog = { today: string; dates: string[] };

export function smartInsightsToday(now = new Date()): string {
  const timeZone = process.env.SMART_INSIGHTS_TIMEZONE?.trim() || "Asia/Bangkok";
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export async function loadBriefingDateCatalog(
  context: TenantContext,
  now = new Date(),
): Promise<BriefingDateCatalog> {
  const rows = await getPrisma().dailyBriefing.groupBy({
    by: ["effectiveDate"],
    where: { organizationId: context.organizationId, userId: context.userId },
    orderBy: { effectiveDate: "desc" },
    take: 90,
  });
  const dates = [...new Set(rows.map((row) => dateOnly(row.effectiveDate)))].slice(0, 90);
  return { today: smartInsightsToday(now), dates };
}
```

- [ ] **Step 4: Write the failing route test**

Mock only auth and the repository boundary, then assert user-visible HTTP behavior:

```ts
it("returns a private tenant-scoped date catalog", async () => {
  mocks.loadBriefingDateCatalog.mockResolvedValue({
    today: "2026-08-17",
    dates: ["2026-08-16", "2026-08-15"],
  });
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  await expect(response.json()).resolves.toEqual({
    today: "2026-08-17",
    dates: ["2026-08-16", "2026-08-15"],
  });
  expect(mocks.requireTenantCapability).toHaveBeenCalledWith(context, "research", "read");
});

it("requires an authenticated tenant member", async () => {
  mocks.requireTenantContext.mockRejectedValue(new AuthenticationRequiredError());
  const response = await GET();
  expect(response.status).toBe(401);
  expect(mocks.loadBriefingDateCatalog).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Run the route test and observe the missing route failure**

Run: `npx vitest run src/app/api/smart-insights/briefing/dates/route.test.ts`

Expected: FAIL because the route module does not exist.

- [ ] **Step 6: Implement the authenticated private route**

```ts
export async function GET() {
  try {
    const context = await requireTenantContext();
    requireTenantCapability(context, "research", "read");
    return NextResponse.json(await loadBriefingDateCatalog(context), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
```

Update the broad tenant-route mock only if its module factory requires the new named export.

- [ ] **Step 7: Run focused backend and route tests**

Run: `npx vitest run src/lib/backend/smart-insights.test.ts src/app/api/smart-insights/briefing/dates/route.test.ts src/app/api/tenant-routes.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the catalog boundary**

```bash
git add src/lib/backend/smart-insights.ts src/lib/backend/smart-insights.test.ts src/app/api/smart-insights/briefing/dates/route.ts src/app/api/smart-insights/briefing/dates/route.test.ts src/app/api/tenant-routes.test.ts
git commit -m "feat: expose Smart Insights analysis dates"
```

---

### Task 2: Exact-date briefing lifecycle and client contracts

**Files:**
- Modify: `src/lib/backend/smart-insights.ts`
- Modify: `src/lib/backend/smart-insights.test.ts`
- Modify: `src/app/api/smart-insights/briefing/route.ts`
- Modify: `src/app/api/smart-insights/briefing/route.test.ts`
- Modify: `src/lib/smart-insights-client.ts`
- Modify: `src/lib/smart-insights-client.test.ts`

**Interfaces:**
- Consumes: `smartInsightsToday()` and `loadBriefingEnvelope(context, date)` from Task 1/current backend.
- Produces: `briefingDatesSchema`, `BriefingDatesModel`, `fetchBriefingDates(signal?)`, and `fetchBriefing(date, signal?)`.

- [ ] **Step 1: Write failing strict-date repository tests**

```ts
it.each(["2026-8-01", "2026-02-30", "17-08-2026", "2026-08-17T00:00:00Z"])(
  "rejects malformed or impossible exact date %s before querying",
  async (value) => {
    await expect(
      loadBriefingEnvelope(
        { organizationId: "org-a", userId: "user-a", role: "viewer" } as never,
        value,
      ),
    ).rejects.toBeInstanceOf(SmartInsightsInputError);
    expect(prisma.dailyBriefing.findFirst).not.toHaveBeenCalled();
  },
);
```

- [ ] **Step 2: Run the repository test and observe an accepted malformed date**

Run: `npx vitest run src/lib/backend/smart-insights.test.ts`

Expected: FAIL because JavaScript's current `Date` parsing accepts at least one non-contract value.

- [ ] **Step 3: Implement strict canonical parsing**

```ts
function parseBriefingLocalDate(value?: string | null): Date | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new SmartInsightsInputError("Invalid local date.");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || dateOnly(parsed) !== value)
    throw new SmartInsightsInputError("Invalid local date.");
  return parsed;
}
```

Use this helper at the top of `loadBriefingEnvelope` before the Prisma call.

- [ ] **Step 4: Write failing route tests for today versus history**

Freeze time to a Bangkok-safe instant and assert the actual response branch, not merely mock calls:

```ts
it("does not project today's queued refresh onto a missing historical date", async () => {
  vi.setSystemTime(new Date("2026-08-17T05:00:00.000Z"));
  mocks.loadBriefingEnvelope.mockResolvedValue(null);
  mocks.loadBriefingRefreshState.mockResolvedValue({ state: "generating", errorCode: null });
  const response = await GET(
    new Request("http://localhost/api/smart-insights/briefing?date=2026-08-15"),
  );
  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toEqual({
    state: "idle",
    errorCode: "BRIEFING_NOT_GENERATED_FOR_DATE",
  });
});

it("keeps the queued lifecycle for an exact missing today briefing", async () => {
  vi.setSystemTime(new Date("2026-08-17T05:00:00.000Z"));
  mocks.loadBriefingRefreshState.mockResolvedValue({ state: "generating", errorCode: null });
  const response = await GET(
    new Request("http://localhost/api/smart-insights/briefing?date=2026-08-17"),
  );
  expect(response.status).toBe(202);
  await expect(response.json()).resolves.toMatchObject({ state: "generating" });
});
```

Restore real timers in `afterEach`.

- [ ] **Step 5: Run the route test and observe the historical lifecycle failure**

Run: `npx vitest run src/app/api/smart-insights/briefing/route.test.ts`

Expected: FAIL because the current route reads refresh state for every requested date.

- [ ] **Step 6: Implement date-aware route branching**

Parse `requestedDate` once, compare it with `smartInsightsToday()`, and call `loadBriefingRefreshState` only for an authenticated today/no-date request. Return the explicit historical error before the general lifecycle branches:

```ts
if (!envelope && requestedDate && requestedDate !== today) {
  return NextResponse.json(
    { state: "idle", errorCode: "BRIEFING_NOT_GENERATED_FOR_DATE" },
    { status: 404, headers },
  );
}
```

- [ ] **Step 7: Write failing client tests for literal URLs and catalog parsing**

```ts
it("requests one exact analysis date", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ...base, localDate: "2026-08-15", assetOpinions: [] }), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  await fetchBriefing("2026-08-15");
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/smart-insights/briefing?date=2026-08-15",
    expect.objectContaining({ headers: { Accept: "application/json" } }),
  );
});

it("loads the bounded date catalog", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ today: "2026-08-17", dates: ["2026-08-16"] })),
    ),
  );
  await expect(fetchBriefingDates()).resolves.toEqual({
    today: "2026-08-17",
    dates: ["2026-08-16"],
  });
});
```

- [ ] **Step 8: Run the client test and observe missing signatures**

Run: `npx vitest run src/lib/smart-insights-client.test.ts`

Expected: FAIL because `fetchBriefing` has no date parameter and `fetchBriefingDates` does not exist.

- [ ] **Step 9: Implement the minimal client contracts**

```ts
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const briefingDatesSchema = z.object({
  today: isoDateSchema,
  dates: z.array(isoDateSchema).max(90),
});
export type BriefingDatesModel = z.infer<typeof briefingDatesSchema>;

export async function fetchBriefing(
  date: string,
  signal?: AbortSignal,
): Promise<BriefingFetchResult> {
  const response = await fetch(
    `/api/smart-insights/briefing?date=${encodeURIComponent(date)}`,
    { signal, headers: { Accept: "application/json" } },
  );
  // Keep the existing 200/202/404/503 parsing branches unchanged.
}

export async function fetchBriefingDates(signal?: AbortSignal): Promise<BriefingDatesModel> {
  return fetchParsed("/api/smart-insights/briefing/dates", briefingDatesSchema, signal);
}
```

Update every existing test/caller to pass the intended exact date.

- [ ] **Step 10: Run all focused exact-date tests**

Run: `npx vitest run src/lib/backend/smart-insights.test.ts src/app/api/smart-insights/briefing/route.test.ts src/lib/smart-insights-client.test.ts src/app/api/tenant-routes.test.ts`

Expected: PASS.

- [ ] **Step 11: Commit exact-date lifecycle**

```bash
git add src/lib/backend/smart-insights.ts src/lib/backend/smart-insights.test.ts src/app/api/smart-insights/briefing/route.ts src/app/api/smart-insights/briefing/route.test.ts src/lib/smart-insights-client.ts src/lib/smart-insights-client.test.ts src/app/api/tenant-routes.test.ts
git commit -m "fix: isolate Smart Insights date lifecycle"
```

---

### Task 3: Accessible analysis-date control

**Files:**
- Create: `src/components/smart-insights/AnalysisDateControl.tsx`
- Create: `src/components/smart-insights/AnalysisDateControl.test.tsx`

**Interfaces:**
- Consumes: existing `Button`, `Badge`, and Radix-backed `Select` components.
- Produces: `AnalysisDateControl({ locale, today, dates, value, loading, onChange })` and `analysisDateOptions(today, dates)`.

- [ ] **Step 1: Write failing deterministic component tests**

```tsx
it("puts Today first and deduplicates published dates", () => {
  expect(analysisDateOptions("2026-08-17", ["2026-08-17", "2026-08-16"])).toEqual([
    "2026-08-17",
    "2026-08-16",
  ]);
});

it("labels a historical selection without implying current analysis", () => {
  const html = renderToStaticMarkup(
    <AnalysisDateControl
      locale="vi"
      today="2026-08-17"
      dates={["2026-08-16"]}
      value="2026-08-16"
      loading={false}
      onChange={() => undefined}
    />,
  );
  expect(html).toContain('aria-label="Ngày phân tích"');
  expect(html).toContain("16/08/2026");
  expect(html).toContain("Lịch sử");
  expect(html).toContain("Hôm nay");
});
```

- [ ] **Step 2: Run the test and observe the missing component failure**

Run: `npx vitest run src/components/smart-insights/AnalysisDateControl.test.tsx`

Expected: FAIL because the component module does not exist.

- [ ] **Step 3: Implement the compact controlled component**

Use ISO values and deterministic display formatting:

```tsx
export function analysisDateOptions(today: string, dates: string[]): string[] {
  return [today, ...dates.filter((date) => date !== today)];
}

function displayDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

type Props = {
  locale: "vi" | "en";
  today: string;
  dates: string[];
  value: string;
  loading: boolean;
  onChange: (date: string) => void;
};

export function AnalysisDateControl(props: Props) {
  const historical = props.value !== props.today;
  return (
    <div className="flex flex-wrap items-center gap-2" data-analysis-date={props.value} aria-busy={props.loading}>
      <span className="text-sm font-medium">
        {props.locale === "vi" ? "Ngày phân tích" : "Analysis date"}
      </span>
      <Select value={props.value} onValueChange={props.onChange}>
        <SelectTrigger className="w-44" aria-label={props.locale === "vi" ? "Ngày phân tích" : "Analysis date"}>
          <SelectValue>{displayDate(props.value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {analysisDateOptions(props.today, props.dates).map((date) => (
            <SelectItem key={date} value={date}>{displayDate(date)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="button" variant={historical ? "outline" : "secondary"} onClick={() => props.onChange(props.today)} disabled={!historical}>
        {props.locale === "vi" ? "Hôm nay" : "Today"}
      </Button>
      {historical ? <Badge variant="outline">{props.locale === "vi" ? "Lịch sử" : "Historical"}</Badge> : null}
      {props.loading ? <LoaderCircle className="size-4 animate-spin" aria-label={props.locale === "vi" ? "Đang tải phân tích" : "Loading analysis"} /> : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the component test**

Run: `npx vitest run src/components/smart-insights/AnalysisDateControl.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the date control**

```bash
git add src/components/smart-insights/AnalysisDateControl.tsx src/components/smart-insights/AnalysisDateControl.test.tsx
git commit -m "feat: add Smart Insights date control"
```

---

### Task 4: Date-aware briefing and opinion presentation

**Files:**
- Modify: `src/components/smart-insights/AssetOpinions.tsx`
- Modify: `src/components/smart-insights/AssetOpinionList.tsx`
- Modify: `src/components/smart-insights/AssetOpinions.test.tsx`
- Modify: `src/components/smart-insights/LegacyMarketPulse.tsx`
- Modify: `src/components/smart-insights/EconomicCalendar.tsx`

**Interfaces:**
- Consumes: `analysisDate`, `today`, `briefingAvailable`, and the existing generation lifecycle.
- Produces: one section-level missing-briefing notice and `AssetOpinionList.missingOpinionLabel: string | null`.

- [ ] **Step 1: Write failing tests that distinguish whole-briefing and per-symbol absence**

```tsx
it("shows one today-level notice when the entire briefing is missing", () => {
  const html = renderToStaticMarkup(
    <AssetOpinions
      opinions={[]}
      portfolioState="missing"
      locale="vi"
      onEvidence={() => undefined}
      generationState="idle"
      analysisDate="2026-08-17"
      today="2026-08-17"
      briefingAvailable={false}
      watchlist={watchlist}
      watchlistAvailable
    />,
  );
  expect(html.match(/Chưa có bản phân tích hôm nay/g)).toHaveLength(1);
  expect(html).not.toContain("Chưa có quan điểm hôm nay");
});

it("labels an omitted symbol against the selected historical date", () => {
  const html = renderToStaticMarkup(
    <AssetOpinions
      opinions={[opinion()]}
      portfolioState="available"
      locale="vi"
      onEvidence={() => undefined}
      analysisDate="2026-08-16"
      today="2026-08-17"
      briefingAvailable
      watchlist={watchlist}
      watchlistAvailable
      onRefresh={() => undefined}
    />,
  );
  expect(html).toContain("Chưa có quan điểm cho ngày đã chọn");
  expect(html).not.toContain("Cập nhật AI");
});
```

- [ ] **Step 2: Run the opinion test and observe incorrect `today` copy and refresh visibility**

Run: `npx vitest run src/components/smart-insights/AssetOpinions.test.tsx`

Expected: FAIL because the new props and date-aware states do not exist.

- [ ] **Step 3: Implement one missing-briefing notice and date-aware row copy**

Derive the label once in `AssetOpinions`:

```ts
type AnalysisDateProps = {
  analysisDate: string;
  today: string;
  briefingAvailable: boolean;
};

const isToday = analysisDate === today;
const missingOpinionLabel = briefingAvailable
  ? isToday
    ? locale === "vi" ? "Chưa có quan điểm hôm nay" : "No opinion today"
    : locale === "vi" ? "Chưa có quan điểm cho ngày đã chọn" : "No opinion for selected date"
  : null;
```

Render the lifecycle notice once above `AssetOpinionList` when `briefingAvailable` is false, hide `PortfolioChangeDigest` in that state, pass `missingOpinionLabel`, and render an em dash instead of `PendingOpinion` when the label is null. Gate the refresh button with `isToday && onRefresh` even if a future caller passes it accidentally.

- [ ] **Step 4: Write failing current-data label tests**

Use `renderToStaticMarkup` with complete existing fixtures and assert both components expose `Dữ liệu hiện tại` in Vietnamese and `Current data` in English.

```tsx
const pulse = renderToStaticMarkup(
  <I18nProvider>
    <LegacyMarketPulse
      market="macro"
      metrics={[]}
      regimes={[]}
      macroEventRisk={null}
      energyPulse={null}
      macroPulseState="idle"
      onMarketChange={() => undefined}
    />
  </I18nProvider>,
);
expect(pulse).toContain("Dữ liệu hiện tại");

const calendar = renderToStaticMarkup(
  <EconomicCalendar locale="en" events={[]} impact="all" onImpactChange={() => undefined} />,
);
expect(calendar).toContain("Current data");
```

- [ ] **Step 5: Run the label tests and observe missing labels**

Run: `npx vitest run src/components/smart-insights/AssetOpinions.test.tsx src/components/smart-insights/SmartInsightsNumberFormatting.test.tsx`

Expected: FAIL on the new current-data assertions.

- [ ] **Step 6: Add localized current-data badges**

Add a small secondary/outline badge beside the `Market Pulse` heading. Add a required `locale: "vi" | "en"` prop to `EconomicCalendar` and place the same semantic badge beside its title. Update all component callers and complete fixtures.

- [ ] **Step 7: Run the focused presentation tests**

Run: `npx vitest run src/components/smart-insights/AssetOpinions.test.tsx src/components/smart-insights/SmartInsightsNumberFormatting.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit date-aware presentation**

```bash
git add src/components/smart-insights/AssetOpinions.tsx src/components/smart-insights/AssetOpinionList.tsx src/components/smart-insights/AssetOpinions.test.tsx src/components/smart-insights/LegacyMarketPulse.tsx src/components/smart-insights/EconomicCalendar.tsx src/components/smart-insights/SmartInsightsNumberFormatting.test.tsx
git commit -m "feat: label dated Smart Insights analysis"
```

---

### Task 5: Smart Insights selected-date orchestration and authenticated flow

**Files:**
- Modify: `src/components/SmartInsights.tsx`
- Modify: `e2e/smart-insights-asset-opinions.spec.ts`

**Interfaces:**
- Consumes: `fetchBriefingDates`, `fetchBriefing(date, signal)`, `AnalysisDateControl`, and date-aware `AssetOpinions`.
- Produces: server-derived `selectedDate`, abortable briefing-only loading, and today-only refresh polling.

- [ ] **Step 1: Extend the E2E fixture with two literal briefing dates**

Change `seedBriefing` to publish today's fixture and a prior-day fixture whose BTC thesis contains `Bản phân tích lịch sử E2E`. Return both ISO dates to the test. Keep complete opinion structures; do not use partial mocks or fabricated frontend responses.

Replace the fixture's UTC calendar-date calculation with the same explicit business timezone:

```ts
function bangkokDate(value: Date): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

const today = bangkokDate(asOf);
const effectiveDate = new Date(`${today}T00:00:00.000Z`);
```

After the existing complete `assetOpinions` array has been persisted for today, add:

```ts
const historicalDate = new Date(effectiveDate);
historicalDate.setUTCDate(historicalDate.getUTCDate() - 1);
const historicalRun = await prisma.researchRun.create({
  data: {
    organizationId,
    userId: user.id,
    source: "smart-insights-e2e-history",
    kind: "daily_asset_opinion",
    status: "succeeded",
    parameters: { fixture: true, historical: true },
    startedAt: asOf,
    finishedAt: asOf,
  },
});
await prisma.dailyBriefing.create({
  data: {
    organizationId,
    userId: user.id,
    researchRunId: historicalRun.id,
    effectiveDate: historicalDate,
    effectiveAt: new Date(asOf.getTime() - 86_400_000),
    timezone: "Asia/Bangkok",
    revision: 1,
    fingerprint: `${historicalRun.id.replaceAll("-", "")}`.padEnd(64, "0").slice(0, 64),
    modelName: "e2e-grounded-fixture",
    promptVersion: "asset-opinion-v1",
    methodologyVersion: "asset-opinion-quant-v1",
    status: "complete",
    marketSummary: {
      portfolioState: "available",
      assetOpinions: assetOpinions.map((item, index) =>
        index === 0 ? { ...item, thesis: "Bản phân tích lịch sử E2E" } : item,
      ),
    },
    dataConfidence: 76,
    portfolioSnapshot: { portfolioState: "available" },
    preferenceSnapshot: { locale: "vi", riskTolerance: "moderate" },
  },
});
return {
  today: effectiveDate.toISOString().slice(0, 10),
  historical: historicalDate.toISOString().slice(0, 10),
};
```

- [ ] **Step 2: Add the failing authenticated date-selection assertions**

```ts
const { today, historical } = await seedBriefing(email);
const displayDate = (value: string) => {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
};
await page.goto("/", { waitUntil: "networkidle" });
await expect(page.getByLabel("Ngày phân tích")).toBeVisible();
await page.getByLabel("Ngày phân tích").click();
await page.getByRole("option", { name: displayDate(historical) }).click();
await expect(page.locator(`[data-analysis-date="${historical}"]`)).toHaveAttribute(
  "aria-busy",
  "false",
);
await page.getByRole("button", { name: "Xem phân tích BTC Bitcoin", exact: true }).click();
await expect(page.getByTestId("asset-opinion-detail")).toContainText(
  "Bản phân tích lịch sử E2E",
);
await page.keyboard.press("Escape");
await expect(page.getByRole("button", { name: "Cập nhật AI" })).toHaveCount(0);
await expect(page.getByText("Dữ liệu hiện tại").first()).toBeVisible();
await page.getByRole("button", { name: "Hôm nay" }).click();
await expect(page.locator(`[data-analysis-date="${today}"]`)).toBeVisible();
```

Capture requests before and after the historical selection and assert that the action adds one exact-date briefing request but no new metrics, calendar, macro, crypto-pulse, or forecast request.

- [ ] **Step 3: Run the desktop E2E test and observe the missing selector failure**

Run: `npx playwright test e2e/smart-insights-asset-opinions.spec.ts --project=desktop`

Expected: FAIL because `Ngày phân tích` is absent.

- [ ] **Step 4: Refactor initial loading around the server date catalog**

In `SmartInsights`, add:

```ts
const [dateCatalog, setDateCatalog] = useState<BriefingDatesModel | null>(null);
const [selectedDate, setSelectedDate] = useState<string | null>(null);
const [briefingLoading, setBriefingLoading] = useState(false);
```

Fetch the catalog concurrently with regimes/preferences. On success set both `dateCatalog` and `selectedDate` to the returned `today`. Do not call the no-date briefing route.

- [ ] **Step 5: Add an abortable exact-date briefing effect**

```ts
useEffect(() => {
  if (!authenticatedUserId || !selectedDate) return;
  const controller = new AbortController();
  setBriefing(null);
  setBriefingLoading(true);
  setEvidence(null);
  setEvidenceId(null);
  void fetchBriefing(selectedDate, controller.signal)
    .then((result) => {
      if (controller.signal.aborted) return;
      setBriefing(result.briefing);
      setBriefingState(result.state);
      if (result.errorCode === "BRIEFING_NOT_GENERATED_FOR_DATE") {
        void fetchBriefingDates(controller.signal).then(setDateCatalog).catch(() => undefined);
      }
    })
    .catch(() => {
      if (!controller.signal.aborted) setBriefingState("failed");
    })
    .finally(() => {
      if (!controller.signal.aborted) setBriefingLoading(false);
    });
  return () => controller.abort();
}, [authenticatedUserId, selectedDate, refresh]);
```

Render briefing-specific skeletons while `briefingLoading`; keep Market Pulse and calendar mounted. Never show `LegacyDailyHero` sample copy as if it belonged to the selected date while that date is loading.

If the date catalog itself fails, render a bounded analysis-unavailable notice while leaving current Market Pulse and calendar usable. The always-visible Today shortcut remains the recovery path for a historical date removed between catalog and briefing reads.

- [ ] **Step 6: Make refresh and polling today-only**

Guard both paths with `selectedDate === dateCatalog.today`. Capture `selectedDate` inside the poll effect and abort/clear its timer when selection changes. After a refresh becomes ready, call `fetchBriefingDates` again so today enters the published-date list.

- [ ] **Step 7: Wire the control and date-aware children**

Render `AnalysisDateControl` before the briefing-bound hero/opinions. Pass `briefingAvailable={Boolean(briefing)}`, `analysisDate={selectedDate}`, `today={dateCatalog.today}`, and pass `onRefresh` only for today. Pass `locale` to `EconomicCalendar`.

- [ ] **Step 8: Run the focused unit and desktop E2E tests**

Run: `npx vitest run src/lib/smart-insights-client.test.ts src/components/smart-insights/AnalysisDateControl.test.tsx src/components/smart-insights/AssetOpinions.test.tsx`

Run: `npx playwright test e2e/smart-insights-asset-opinions.spec.ts --project=desktop`

Expected: PASS, including exact-date network isolation.

- [ ] **Step 9: Commit selected-date orchestration**

```bash
git add src/components/SmartInsights.tsx e2e/smart-insights-asset-opinions.spec.ts
git commit -m "feat: browse Smart Insights by analysis date"
```

---

### Task 6: Production refresh-queue service

**Files:**
- Create: `deploy/linux/systemd/datavest-smart-insights-refresh.service`
- Modify: `scripts/release/deployment-config-contract.test.mjs`
- Modify: `scripts/release/deploy-contract.test.mjs`
- Modify: `scripts/release/provision-contract.test.mjs`
- Modify: `deploy/linux/provision-datavest.sh`
- Modify: `deploy/linux/deploy-datavest.sh`

**Interfaces:**
- Consumes: existing `/opt/datavest/shared/python-venv`, shared env files, `process_smart_insight_refreshes.py --watch`, and atomic release symlink.
- Produces: `datavest-smart-insights-refresh.service`, active after provision/deploy and covered by rollback.

- [ ] **Step 1: Write the failing parsed-unit contract test**

```js
it("runs the Smart Insights refresh queue as a separate hardened worker", async () => {
  const unit = parseUnit(
    await read("deploy/linux/systemd/datavest-smart-insights-refresh.service"),
  );
  expect(unit.Service).toMatchObject({
    User: "datavest",
    Group: "datavest",
    WorkingDirectory: "/opt/datavest/current/quant-worker",
    ExecStart:
      "/opt/datavest/shared/python-venv/bin/python /opt/datavest/current/quant-worker/process_smart_insight_refreshes.py --watch --limit 20 --poll-seconds 5 --env-file /opt/datavest/shared/.env",
    Restart: "on-failure",
    MemoryMax: "750M",
    NoNewPrivileges: "true",
    PrivateTmp: "true",
    ProtectSystem: "strict",
    ProtectHome: "true",
    UMask: "0027",
  });
  expect(values(unit.Service.EnvironmentFile)).toEqual([
    "/opt/datavest/shared/.env",
    "-/opt/datavest/shared/release.env",
  ]);
  expect(unit.Install.WantedBy).toBe("multi-user.target");
});
```

- [ ] **Step 2: Run the service test and observe the missing-unit failure**

Run: `npx vitest run scripts/release/deployment-config-contract.test.mjs`

Expected: FAIL with file not found.

- [ ] **Step 3: Create the hardened service unit**

```ini
[Unit]
Description=DataVest Smart Insights refresh queue worker
Wants=network-online.target
After=network-online.target postgresql.service datavest-quant-engine.service

[Service]
Type=simple
User=datavest
Group=datavest
WorkingDirectory=/opt/datavest/current/quant-worker
EnvironmentFile=/opt/datavest/shared/.env
EnvironmentFile=-/opt/datavest/shared/release.env
ExecStart=/opt/datavest/shared/python-venv/bin/python /opt/datavest/current/quant-worker/process_smart_insight_refreshes.py --watch --limit 20 --poll-seconds 5 --env-file /opt/datavest/shared/.env
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
MemoryMax=750M
UMask=0027
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 4: Write failing provision/deploy lifecycle tests**

Extend the existing contract suites to require:

```js
const provision = await read("deploy/linux/provision-datavest.sh");
const deploy = await read("deploy/linux/deploy-datavest.sh");
expect(provision).toContain("datavest-smart-insights-refresh.service");
expect(deploy).toContain(
  'install -o root -g root -m 0644 "${release_dir}/deploy/linux/systemd/datavest-smart-insights-refresh.service" "/etc/systemd/system/datavest-smart-insights-refresh.service"',
);
expect(deploy).toContain("systemctl daemon-reload");
expect(deploy).toContain("systemctl restart datavest-smart-insights-refresh.service");
expect(deploy).toContain("systemctl is-active --quiet datavest-smart-insights-refresh.service");
expect(deploy).toContain("systemctl enable datavest-smart-insights-refresh.service");
```

Also require the no-previous-release rollback branch to stop the new service. Keep the existing real `bash -n` provision syntax check.

- [ ] **Step 5: Run deployment tests and observe missing lifecycle wiring**

Run: `npx vitest run scripts/release/deployment-config-contract.test.mjs scripts/release/provision-contract.test.mjs scripts/release/deploy-contract.test.mjs`

Expected: FAIL on install/restart/enable/active/rollback assertions.

- [ ] **Step 6: Wire provision and atomic deployment**

Add the unit to the provision loop. In deploy, install the release's unit into `/etc/systemd/system`, run `systemctl daemon-reload`, include it in `restart_services`, stop it in the no-old-release rollback branch, verify it with `systemctl is-active --quiet`, and include it in the final `systemctl enable` call. Keep the unit installed before the first attempted restart so an existing VPS can adopt it without rerunning full provisioning.

- [ ] **Step 7: Run service, Python-worker, and shell contract tests**

Run: `npx vitest run scripts/release/deployment-config-contract.test.mjs scripts/release/provision-contract.test.mjs scripts/release/deploy-contract.test.mjs`

Run: `npm run test:python -- quant-worker/tests/test_smart_insight_refresh_worker.py`

Expected: PASS.

- [ ] **Step 8: Commit production worker wiring**

```bash
git add deploy/linux/systemd/datavest-smart-insights-refresh.service deploy/linux/provision-datavest.sh deploy/linux/deploy-datavest.sh scripts/release/deployment-config-contract.test.mjs scripts/release/provision-contract.test.mjs scripts/release/deploy-contract.test.mjs
git commit -m "ops: run Smart Insights refresh worker"
```

---

### Task 7: Full verification and production release

**Files:**
- Verify only; do not edit generated artifacts or unrelated user files.

**Interfaces:**
- Consumes: all task commits and the existing `Build production artifact` GitHub Actions workflow.
- Produces: pushed main SHA, successful workflow/deploy, active service, consumed queue request, persisted briefing, HTTP health, and authenticated browser evidence.

- [ ] **Step 1: Confirm intended diff and clean scope**

Run: `git status --short`

Run: `git diff 455656a..HEAD --stat`

Expected: only the planned API/UI/test/deploy files plus the approved spec/plan amendment; no unrelated work.

- [ ] **Step 2: Run repository quality gates**

Run: `npm run format:check`

Run: `npm run typecheck`

Run: `npm run lint`

Run: `npm test`

Run: `npm run test:python`

Run: `npm run build`

Expected: every command exits 0. Do not treat a partial or timed-out run as success.

- [ ] **Step 3: Run authenticated desktop and mobile browser flows**

Run: `npx playwright test e2e/smart-insights-asset-opinions.spec.ts --project=desktop --project=mobile`

Expected: PASS with exact-date switching, no current-market refetch on selection, no horizontal overflow, and no unexpected console/API errors.

- [ ] **Step 4: Perform the pre-push verification gate**

Use `superpowers:verification-before-completion`. Re-run any command whose output is stale after formatting or fixes. Record the final `git rev-parse HEAD` and `git status --short`.

- [ ] **Step 5: Push main and dispatch the production workflow**

```bash
git push origin main
gh workflow run "Build production artifact" --ref main
gh run list --workflow "Build production artifact" --branch main --limit 3
```

Select the workflow-dispatch run for the pushed SHA, then run `gh run watch <run-id> --exit-status`.

Expected: GitHub build and deploy jobs both succeed for the exact pushed SHA.

- [ ] **Step 6: Verify public and VPS runtime independently**

Verify `https://datavest.vn/api/health/ready` and `https://datavest.vn/` return HTTP 200. Through the already configured production SSH path, verify:

```bash
systemctl is-active datavest-web.service datavest-quant-engine.service datavest-worker.service datavest-smart-insights-refresh.service
systemctl --no-pager --full status datavest-smart-insights-refresh.service
journalctl -u datavest-smart-insights-refresh.service --since "15 minutes ago" --no-pager
```

Expected: all services are active; the refresh worker has no crash loop or secret-bearing output.

- [ ] **Step 7: Verify queue and PostgreSQL truth**

Using the production `DATABASE_URL` only inside the VPS process environment, query counts/status without printing credentials. Confirm the previously queued request reaches `succeeded` (or a terminal bounded `failed` with a diagnosed code) and confirm a matching tenant/user/effective-date row exists in `daily_briefings`. Service activity alone is not accepted as proof.

Run the equivalent of these read-only SQL statements through `psql` on the VPS:

```sql
SELECT status, reason, request_version, processing_version, attempt_count,
       error_code, requested_at, started_at, finished_at
FROM smart_insight_refresh_requests
ORDER BY requested_at DESC
LIMIT 5;

SELECT organization_id, user_id, effective_date, revision, status, effective_at
FROM daily_briefings
ORDER BY effective_at DESC
LIMIT 5;
```

- [ ] **Step 8: Verify the authenticated production UI**

Open Smart Insights in the existing signed-in browser session. Confirm Today renders or shows the truthful lifecycle; select a published historical date; verify briefing/opinions change, refresh disappears, `Dữ liệu hiện tại` remains on current sections, and returning to Today restores today's analysis. Capture desktop and mobile screenshots if the browser tooling supports them.

- [ ] **Step 9: Report evidence separately**

Report local checks, commit SHA, push, workflow URL/status, public HTTP, systemd, database queue/briefing state, and authenticated browser behavior as separate facts. If any layer cannot be verified, state exactly which one rather than claiming the release complete.
