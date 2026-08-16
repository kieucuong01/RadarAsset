# Smart Insights Asset Opinion Modal and Consumer UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the always-visible asset-opinion detail with a discoverable responsive modal, hide consumer-irrelevant operational health data, and restore visible Smart Insights Crypto chart lines.

**Architecture:** `AssetOpinions` owns one active symbol and renders one controlled dialog, while `AssetOpinionList` remains a compact table/cards trigger surface. `AssetOpinionDetail` becomes the dialog and delegates the hidden-by-default provenance block to a focused source-disclosure component. Smart Insights stops fetching the consumer-unused health endpoint, and all active Crypto line charts use complete theme color tokens without changing their raw series.

**Tech Stack:** Next.js 16, React 19, TypeScript, Radix Dialog/Tabs, Tailwind CSS 4, Recharts, Vitest, Playwright.

## Global Constraints

- Preserve the current Smart Insights visual system and existing component primitives.
- Clicking anywhere on an asset desktop row or mobile card opens the analysis.
- The trigger must visibly say `Xem phân tích` / `View analysis` and support Enter and Space.
- Keep DeepSeek output, evidence gates, quant formulas, thresholds, raw chart series, API schemas and database data unchanged.
- Sources and freshness are hidden by default but remain available on demand.
- Remove the Smart Insights consumer data-health request and render; do not delete admin APIs or persistence.
- Use complete theme color values such as `var(--chart-1)`; never wrap an `oklch(...)` token in `hsl(...)`.
- Do not add a dependency.
- Render only one active opinion detail, not one dialog per row.

---

## File Structure

- Modify `src/components/smart-insights/AssetOpinions.tsx`: own active opinion/dialog state and compose the controlled detail modal.
- Modify `src/components/smart-insights/AssetOpinionList.tsx`: turn each row/card into an explicit accessible analysis trigger.
- Modify `src/components/smart-insights/AssetOpinionDetail.tsx`: convert the detail card into the controlled dialog and organize existing sections into investor-oriented tabs.
- Create `src/components/smart-insights/AssetOpinionSourcesDisclosure.tsx`: own the source-button disclosure and existing evidence table/cards.
- Modify `src/components/smart-insights/AssetOpinions.test.tsx`: assert compact default rendering and content contracts.
- Modify `src/components/SmartInsights.tsx`: remove the consumer data-health request, state and panel.
- Modify `src/components/smart-insights/source-guard.test.ts`: guard the consumer/admin boundary and valid chart tokens.
- Modify `src/components/smart-insights/CryptoFearGreedPanel.tsx`: restore line and single-point visibility.
- Modify `src/components/smart-insights/CryptoCyclePanel.tsx`: restore CBBI line and single-point visibility.
- Modify `src/components/smart-insights/CryptoDerivativesPressurePanel.tsx`: repair the same invalid active chart token.
- Modify `src/components/smart-insights/CryptoLargeAddressPanel.tsx`: repair the same invalid active chart token.
- Modify `e2e/smart-insights-asset-opinions.spec.ts`: exercise the modal, tabs, source disclosure, focus return, request removal and responsive behavior.

---

### Task 1: Make Every Asset Row and Card an Explicit Modal Trigger

**Files:**
- Modify: `src/components/smart-insights/AssetOpinions.tsx`
- Modify: `src/components/smart-insights/AssetOpinionList.tsx`
- Modify: `src/components/smart-insights/AssetOpinionDetail.tsx`
- Modify: `src/components/smart-insights/AssetOpinions.test.tsx`

**Interfaces:**
- Consumes: existing `AssetOpinionModel`, `portfolioState`, `locale`, and `onEvidence` props.
- Produces: `AssetOpinionList({ opinions, locale, onSelect })`, where `onSelect(symbol: string): void`; `AssetOpinionDetail({ opinion, open, onOpenChange, portfolioState, locale, onEvidence })`.

- [ ] **Step 1: Replace the old always-visible assertions with failing compact-list assertions**

Update the first `AssetOpinions.test.tsx` case so server rendering proves the list advertises the interaction but does not render detail content before a selection:

```tsx
const html = renderToStaticMarkup(
  <AssetOpinions
    opinions={[opinion()]}
    portfolioState="available"
    locale="vi"
    onEvidence={() => undefined}
  />,
);

expect(html).toContain("Xem phân tích");
expect(html).toContain('data-testid="asset-opinion-table"');
expect(html).toContain('data-testid="asset-opinion-cards"');
expect(html).not.toContain('data-testid="asset-opinion-detail"');
expect(html).not.toContain("Nguồn &amp; độ mới");
```

Add a source-level accessibility contract in the same test file:

```ts
const listSource = readFileSync(
  resolve("src/components/smart-insights/AssetOpinionList.tsx"),
  "utf8",
);
expect(listSource).toContain('role="button"');
expect(listSource).toContain("tabIndex={0}");
expect(listSource).toContain('event.key === "Enter"');
expect(listSource).toContain('event.key === " "');
expect(listSource).toContain("cursor-pointer");
expect(listSource).toContain("ChevronRight");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm test -- src/components/smart-insights/AssetOpinions.test.tsx
```

Expected: FAIL because the old detail is rendered immediately and desktop rows are not whole-row triggers.

- [ ] **Step 3: Implement one active-symbol state and controlled dialog**

In `AssetOpinions.tsx`, replace permanent selection with nullable active state:

```tsx
const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
const activeOpinion = opinions.find((item) => item.symbol === activeSymbol) ?? null;

<AssetOpinionList opinions={opinions} locale={locale} onSelect={setActiveSymbol} />
{activeOpinion ? (
  <AssetOpinionDetail
    opinion={activeOpinion}
    open
    onOpenChange={(open) => {
      if (!open) setActiveSymbol(null);
    }}
    portfolioState={portfolioState}
    locale={locale}
    onEvidence={onEvidence}
  />
) : null}
```

Do not preselect `opinions[0]`.

- [ ] **Step 4: Make the desktop row and mobile card visibly actionable**

In `AssetOpinionList.tsx`, remove `selectedSymbol`, remove the nested symbol button, and add one activation helper:

```tsx
function activateOnKeyboard(
  event: React.KeyboardEvent,
  activate: () => void,
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activate();
}
```

Apply it to each desktop `TableRow`:

```tsx
<TableRow
  role="button"
  tabIndex={0}
  aria-label={`${locale === "vi" ? "Xem phân tích" : "View analysis"} ${opinion.symbol} ${opinion.assetName}`}
  className="cursor-pointer transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
  onClick={() => onSelect(opinion.symbol)}
  onKeyDown={(event) => activateOnKeyboard(event, () => onSelect(opinion.symbol))}
>
```

End the action cell and mobile card with:

```tsx
<span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary">
  {locale === "vi" ? "Xem phân tích" : "View analysis"}
  <ChevronRight className="size-3.5" aria-hidden="true" />
</span>
```

- [ ] **Step 5: Wrap the existing detail in a viewport-safe controlled Dialog**

Change `AssetOpinionDetail` to accept `open` and `onOpenChange`. Use the existing primitives:

```tsx
<Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent
    className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-6xl gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-2rem)]"
    data-testid="asset-opinion-detail"
  >
    <DialogHeader className="sr-only">
      <DialogTitle>{opinion.symbol} · {opinion.assetName}</DialogTitle>
      <DialogDescription>
        {locale === "vi" ? "Phân tích định lượng theo tài sản" : "Quantitative asset analysis"}
      </DialogDescription>
    </DialogHeader>
    <div className="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-h-[calc(100dvh-2rem)]">
      {/* existing detail content, without the outer page Card */}
    </div>
  </DialogContent>
</Dialog>
```

- [ ] **Step 6: Run focused tests and type checking**

Run:

```powershell
npm test -- src/components/smart-insights/AssetOpinions.test.tsx
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```powershell
git add src/components/smart-insights/AssetOpinions.tsx src/components/smart-insights/AssetOpinionList.tsx src/components/smart-insights/AssetOpinionDetail.tsx src/components/smart-insights/AssetOpinions.test.tsx
git commit -m "feat: open asset opinions in a modal"
```

---

### Task 2: Organize the Modal into Decision Tabs and On-Demand Sources

**Files:**
- Create: `src/components/smart-insights/AssetOpinionSourcesDisclosure.tsx`
- Modify: `src/components/smart-insights/AssetOpinionDetail.tsx`
- Modify: `src/components/smart-insights/AssetOpinions.test.tsx`
- Modify: `e2e/smart-insights-asset-opinions.spec.ts`

**Interfaces:**
- Consumes: `AssetOpinionModel`, `Locale`, existing `AssetOpinionCalculation`, existing evidence callback.
- Produces: `AssetOpinionSourcesDisclosure({ opinion, locale, onEvidence }): JSX.Element`; dialog tabs `thesis`, `calculation`, `scenarios`.

- [ ] **Step 1: Add failing structural assertions for the approved modal information architecture**

Add to `AssetOpinions.test.tsx`:

```ts
const detailSource = readFileSync(
  resolve("src/components/smart-insights/AssetOpinionDetail.tsx"),
  "utf8",
);
expect(detailSource).toContain('defaultValue="thesis"');
for (const value of ["thesis", "calculation", "scenarios"]) {
  expect(detailSource).toContain(`value="${value}"`);
}
expect(detailSource).toContain("AssetOpinionSourcesDisclosure");
expect(detailSource).not.toContain("<TableHead>Metric</TableHead>");
```

Add a source component contract:

```ts
const sourceDisclosure = readFileSync(
  resolve("src/components/smart-insights/AssetOpinionSourcesDisclosure.tsx"),
  "utf8",
);
expect(sourceDisclosure).toContain("aria-expanded={open}");
expect(sourceDisclosure).toContain("Nguồn dữ liệu");
expect(sourceDisclosure).toContain("onEvidence(item.id)");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm test -- src/components/smart-insights/AssetOpinions.test.tsx
```

Expected: FAIL because the detail still uses one linear body and the source disclosure file does not exist.

- [ ] **Step 3: Create the hidden-by-default source disclosure**

Create `AssetOpinionSourcesDisclosure.tsx` with local state and conditional mounting:

```tsx
export function AssetOpinionSourcesDisclosure({ opinion, locale, onEvidence }: Props) {
  const [open, setOpen] = useState(false);
  const regionId = `asset-opinion-sources-${opinion.symbol.toLowerCase()}`;
  return (
    <section className="border-b bg-muted/10 px-4 py-3 sm:px-6">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((value) => !value)}
      >
        <Database className="size-4" aria-hidden="true" />
        {locale === "vi" ? "Nguồn dữ liệu" : "Data sources"} ({opinion.evidence.length})
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </Button>
      {open ? (
        <div id={regionId} className="mt-3 max-h-72 overflow-y-auto rounded-xl border bg-background">
          {/* existing desktop evidence table and mobile evidence cards */}
        </div>
      ) : null}
    </section>
  );
}
```

Move the existing evidence value mapping, desktop source table and mobile source cards from `AssetOpinionDetail.tsx` into this component unchanged in meaning.

- [ ] **Step 4: Build the sticky decision header**

In `AssetOpinionDetail.tsx`, render a sticky header inside the modal scroll container. Keep symbol, asset name, stance, analysis status, Quant score, confidence, personalized action and available portfolio weight. Do not render a persistent `FreshnessBadge`.

Use this hierarchy:

```tsx
<header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-4 backdrop-blur sm:px-6">
  <div className="flex flex-wrap items-start justify-between gap-4">
    {/* identity + badges */}
    {/* Quant score */}
  </div>
  <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {locale === "vi" ? "Hành động đề xuất" : "Suggested action"}
    </p>
    <p className="mt-1 text-lg font-semibold">{actionLabel(...)} </p>
  </div>
</header>
<AssetOpinionSourcesDisclosure ... />
```

- [ ] **Step 5: Move existing sections into three tabs without changing their data**

Use the existing Tabs primitive:

```tsx
<Tabs defaultValue="thesis" className="min-w-0 px-4 py-5 sm:px-6">
  <div className="overflow-x-auto pb-1">
    <TabsList className="min-w-max">
      <TabsTrigger value="thesis">...</TabsTrigger>
      <TabsTrigger value="calculation">...</TabsTrigger>
      <TabsTrigger value="scenarios">...</TabsTrigger>
    </TabsList>
  </div>
  <TabsContent value="thesis">{/* conclusion, portfolio guidance, limitations */}</TabsContent>
  <TabsContent value="calculation">
    <AssetOpinionCalculation ... />
    <Charts ... />
  </TabsContent>
  <TabsContent value="scenarios">{/* scenarios and invalidation conditions */}</TabsContent>
</Tabs>
```

Do not duplicate `AssetOpinionCalculation`, `Charts`, scenarios or invalidation lists across tabs.

- [ ] **Step 6: Update the E2E interaction path for the modal and tabs**

In `e2e/smart-insights-asset-opinions.spec.ts`, replace the assumption that detail exists immediately:

```ts
await expect(page.getByTestId("asset-opinion-detail")).toHaveCount(0);
const btcTrigger = page.getByRole("button", { name: /Xem phân tích BTC Bitcoin/ });
await btcTrigger.click();
const detail = page.getByTestId("asset-opinion-detail");
await expect(detail).toBeVisible();
await expect(detail).toContainText("BTC · Bitcoin");

await detail.getByRole("tab", { name: /Cách tính/ }).click();
await expect(detail.getByText("Cách tính chi tiết")).toBeVisible();
await detail.getByRole("tab", { name: /Kịch bản/ }).click();
await expect(detail.getByText("Kịch bản cơ sở", { exact: true })).toBeVisible();

const sourceButton = detail.getByRole("button", { name: /Nguồn dữ liệu/ });
await expect(detail.getByText("farside", { exact: true })).toBeHidden();
await sourceButton.click();
await expect(detail.getByText("farside", { exact: true })).toBeVisible();

await page.keyboard.press("Escape");
await expect(detail).toHaveCount(0);
await expect(btcTrigger).toBeFocused();
```

- [ ] **Step 7: Run focused Vitest and Playwright desktop test**

Run:

```powershell
npm test -- src/components/smart-insights/AssetOpinions.test.tsx
npx playwright test e2e/smart-insights-asset-opinions.spec.ts --project=desktop
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```powershell
git add src/components/smart-insights/AssetOpinionSourcesDisclosure.tsx src/components/smart-insights/AssetOpinionDetail.tsx src/components/smart-insights/AssetOpinions.test.tsx e2e/smart-insights-asset-opinions.spec.ts
git commit -m "feat: organize asset opinion modal for investors"
```

---

### Task 3: Remove Consumer Data Health and Admin Pipeline Noise

**Files:**
- Modify: `src/components/SmartInsights.tsx`
- Modify: `src/components/smart-insights/source-guard.test.ts`
- Modify: `e2e/smart-insights-asset-opinions.spec.ts`

**Interfaces:**
- Consumes: briefing, regimes and preferences as the initial Smart Insights request group.
- Produces: consumer Smart Insights with no `HealthModel` state, `/api/smart-insights/data-health` request or `DataHealthPanel` render.

- [ ] **Step 1: Add a failing consumer/admin boundary guard**

Add to `source-guard.test.ts`:

```ts
it("keeps operational data health out of the consumer Smart Insights page", () => {
  const page = readFileSync(
    join(process.cwd(), "src", "components", "SmartInsights.tsx"),
    "utf8",
  );
  for (const forbidden of [
    "DataHealthPanel",
    "healthSchema",
    "HealthModel",
    "setHealth",
    "/api/smart-insights/data-health",
  ]) {
    expect(page).not.toContain(forbidden);
  }
});
```

Remove `DataHealthPanel` from the approved consumer cockpit boundary list and restrict the sample-fallback test to `EconomicCalendar.tsx`.

- [ ] **Step 2: Run the source guard and verify RED**

Run:

```powershell
npm test -- src/components/smart-insights/source-guard.test.ts
```

Expected: FAIL on all currently rendered/fetched health tokens.

- [ ] **Step 3: Remove the health fetch, state and panel from SmartInsights**

Delete the `DataHealthPanel`, `healthSchema` and `HealthModel` imports; delete `health` state; change initial request handling to three entries:

```tsx
Promise.allSettled([
  fetchBriefing(controller.signal),
  fetchParsed("/api/smart-insights/regimes", regimesSchema, controller.signal),
  fetchParsed("/api/smart-insights/preferences", preferencesSchema, controller.signal),
]).then((results) => {
  if (controller.signal.aborted) return;
  const [briefingResult, regimeResult, preferenceResult] = results;
  if (briefingResult.status === "fulfilled") setBriefing(briefingResult.value);
  if (regimeResult.status === "fulfilled") setRegimes(regimeResult.value);
  if (preferenceResult.status === "fulfilled") setPreferences(preferenceResult.value);
  const usable = regimeResult.status === "fulfilled" || briefingResult.status === "fulfilled";
  setState(usable ? "ready" : "error");
});
```

Remove `<DataHealthPanel ... />` from the JSX. Do not delete its API, schema or admin component.

- [ ] **Step 4: Add an E2E request assertion**

After page load in the existing E2E test, add:

```ts
expect(requests.some((url) => url.includes("/api/smart-insights/data-health"))).toBe(false);
await expect(page.getByText(/registered sources|accepted observations|dataset/i)).toHaveCount(0);
```

Keep investor-facing evidence freshness assertions in Task 2.

- [ ] **Step 5: Run focused tests and TypeScript**

Run:

```powershell
npm test -- src/components/smart-insights/source-guard.test.ts src/components/smart-insights/AssetOpinions.test.tsx
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```powershell
git add src/components/SmartInsights.tsx src/components/smart-insights/source-guard.test.ts e2e/smart-insights-asset-opinions.spec.ts
git commit -m "refactor: hide Smart Insights admin health data"
```

---

### Task 4: Restore Fear & Greed, CBBI and Related Crypto Chart Lines

**Files:**
- Modify: `src/components/smart-insights/CryptoFearGreedPanel.tsx`
- Modify: `src/components/smart-insights/CryptoCyclePanel.tsx`
- Modify: `src/components/smart-insights/CryptoDerivativesPressurePanel.tsx`
- Modify: `src/components/smart-insights/CryptoLargeAddressPanel.tsx`
- Modify: `src/components/smart-insights/source-guard.test.ts`
- Modify: `src/components/smart-insights/SmartInsightsNumberFormatting.test.tsx`

**Interfaces:**
- Consumes: existing numeric Recharts series and CSS tokens from `src/app/globals.css`.
- Produces: valid `var(--chart-1)` strokes, deterministic line rendering and visible single-point dots.

- [ ] **Step 1: Add a failing chart-token and single-point guard**

Extend `source-guard.test.ts`:

```ts
it("uses complete theme colors for active Crypto line charts", () => {
  const files = [
    "CryptoFearGreedPanel.tsx",
    "CryptoCyclePanel.tsx",
    "CryptoDerivativesPressurePanel.tsx",
    "CryptoLargeAddressPanel.tsx",
  ];
  for (const file of files) {
    const source = readFileSync(join(process.cwd(), "src", "components", "smart-insights", file), "utf8");
    expect(source, file).not.toContain("hsl(var(--primary))");
    expect(source, file).toContain("var(--chart-1)");
    expect(source, file).toContain("isAnimationActive={false}");
  }
  expect(readFileSync(join(process.cwd(), "src/components/smart-insights/CryptoFearGreedPanel.tsx"), "utf8"))
    .toContain("visible.series.length === 1");
  expect(readFileSync(join(process.cwd(), "src/components/smart-insights/CryptoCyclePanel.tsx"), "utf8"))
    .toContain("visible!.cbbi.series.length === 1");
});
```

- [ ] **Step 2: Run the guard and verify RED**

Run:

```powershell
npm test -- src/components/smart-insights/source-guard.test.ts
```

Expected: FAIL because four active panels still contain the invalid HSL wrapper and the target charts lack single-point dots.

- [ ] **Step 3: Repair Fear & Greed rendering**

Keep `data={visible.series}` unchanged and update the line:

```tsx
<Line
  type="monotone"
  dataKey="value"
  stroke="var(--chart-1)"
  strokeWidth={2.5}
  dot={
    visible.series.length === 1
      ? { r: 3, fill: "var(--chart-1)", stroke: "var(--background)", strokeWidth: 2 }
      : false
  }
  activeDot={{ r: 4, fill: "var(--chart-1)" }}
  isAnimationActive={false}
/>
```

- [ ] **Step 4: Repair CBBI rendering and allow one observation to be visible**

Change the chart condition from `series.length > 1` to `series.length > 0`. Keep the y-domain and numeric series unchanged. Use the same valid stroke and conditional dot pattern keyed to `visible!.cbbi.series.length === 1`; add `isAnimationActive={false}`.

- [ ] **Step 5: Repair the identical invalid token in derivatives and whale charts**

Replace only `stroke="hsl(var(--primary))"` with `stroke="var(--chart-1)"`; add `isAnimationActive={false}` where the affected line lacks it. Do not change `dataKey`, domains, units or series transformations.

- [ ] **Step 6: Add render assertions for data preservation and visible tokens**

In `SmartInsightsNumberFormatting.test.tsx`, retain the existing numeric values and add these source-level assertions:

```ts
expect(fearGreedSource).toContain('data={visible.series}');
expect(fearGreedSource).toContain('stroke="var(--chart-1)"');
expect(cycleSource).toContain('data={visible!.cbbi.series}');
expect(cycleSource).toContain('stroke="var(--chart-1)"');
```

The test must not stringify or pre-format the chart series.

- [ ] **Step 7: Run focused tests and lint**

Run:

```powershell
npm test -- src/components/smart-insights/source-guard.test.ts src/components/smart-insights/SmartInsightsNumberFormatting.test.tsx
npx eslint src/components/smart-insights/CryptoFearGreedPanel.tsx src/components/smart-insights/CryptoCyclePanel.tsx src/components/smart-insights/CryptoDerivativesPressurePanel.tsx src/components/smart-insights/CryptoLargeAddressPanel.tsx src/components/smart-insights/source-guard.test.ts src/components/smart-insights/SmartInsightsNumberFormatting.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```powershell
git add src/components/smart-insights/CryptoFearGreedPanel.tsx src/components/smart-insights/CryptoCyclePanel.tsx src/components/smart-insights/CryptoDerivativesPressurePanel.tsx src/components/smart-insights/CryptoLargeAddressPanel.tsx src/components/smart-insights/source-guard.test.ts src/components/smart-insights/SmartInsightsNumberFormatting.test.tsx
git commit -m "fix: restore Smart Insights Crypto chart lines"
```

---

### Task 5: Full Verification and Browser QA

**Files:**
- No planned source changes. If a regression is found, return to the task that owns the affected file, correct it there, and rerun that task's checks before repeating this verification task.

**Interfaces:**
- Consumes: completed modal, tabs, source disclosure, consumer/admin boundary and chart fixes.
- Produces: buildable Smart Insights with verified desktop/mobile behavior and no relevant runtime errors.

- [ ] **Step 1: Run the complete Vitest suite**

```powershell
npm test
```

Expected: every test file passes with zero failures.

- [ ] **Step 2: Run TypeScript, lint and whitespace gates**

```powershell
npx tsc --noEmit
npm run lint
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 3: Run the production build**

```powershell
npm run build
```

Expected: Next.js compiles, TypeScript completes and all static pages generate with exit `0` using the existing `.env.local`.

- [ ] **Step 4: Run Smart Insights E2E on desktop and mobile**

```powershell
npx playwright test e2e/smart-insights-asset-opinions.spec.ts --project=desktop --project=mobile
```

Expected: both projects pass. If the fixed-date test dataset is older than the dynamic browser range, correct only the fixture/request range and document it; do not weaken UI assertions.

- [ ] **Step 5: Perform Browser-plugin QA against the current main-checkout local server**

The flow under test is:

`/ -> asset row/card -> modal -> calculation tab -> scenarios tab -> sources -> evidence drawer -> close -> focus returns -> Crypto sentiment tab -> Fear & Greed line -> cycle tab -> CBBI line`.

Verify at desktop and mobile:

- page identity and non-blank meaningful content;
- no framework overlay;
- no relevant console errors/warnings;
- `Xem phân tích` is visible before interaction;
- row/card click opens the correct asset modal;
- internal modal scrolling has no page horizontal overflow;
- source rows are hidden before the source button and visible after it;
- Escape closes and returns focus;
- Data Health, dataset counts and pipeline status are absent;
- Fear & Greed and CBBI have visible SVG line paths or a single-point dot.

Capture screenshots outside the repository for desktop modal default, source disclosure, Fear & Greed line, CBBI line and one mobile modal state.

- [ ] **Step 6: Review React performance boundaries**

Confirm in source and browser request logs:

- one `AssetOpinionDetail` is mounted only while open;
- no modal is mapped per opinion;
- `/api/smart-insights/data-health` is absent;
- raw Recharts series remain arrays of numbers;
- no per-row `Intl.NumberFormat` is created.

- [ ] **Step 7: Record the verification result**

If every check passes, do not create an empty commit. If a correction was necessary, commit it under the task that owns the affected file, then record the final command results and browser evidence in the completion report.
