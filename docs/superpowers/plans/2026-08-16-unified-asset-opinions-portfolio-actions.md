# Unified Asset Opinions and Portfolio Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Smart Insights the single place to follow assets, review grounded opinions, and launch Buy, Sell, Backtest, or Remove actions while simplifying Mock Portfolio and adding consistent local asset icons.

**Architecture:** Keep the existing watchlist, portfolio, briefing, and Quant Lab contracts authoritative. Build a pure presentation-model merger for bounded client rendering, let `SmartInsights` orchestrate the three existing reads, and keep dialogs/actions in focused components. Reuse one controlled transaction dialog instead of mounting one dialog per row.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, shadcn/Radix UI, Tailwind CSS, Recharts, Prisma/PostgreSQL, Vitest, Playwright.

## Global Constraints

- The watchlist remains the only persistence model for followed assets; do not add a second favorites table or client store.
- BTC, XAU, and VNINDEX are permanent representatives and cannot be removed.
- A current holding cannot be removed from the combined opinion list.
- Never synthesize an opinion while data is loading or unavailable; show `Preparing analysis` instead.
- Buy and Sell must reuse `/api/portfolio/transactions`; Backtest must reuse `/quant-lab?symbols=<SYMBOL>`.
- Do not add a third-party logo host, logo package, runtime scraping, or a new dependency.
- Smart Insights must perform no per-row network requests.
- Preserve keyboard access, focus restoration, destructive confirmation, desktop/mobile layouts, and the existing evidence modal.
- Keep visible financial values on the shared formatting utilities.

---

### Task 1: Shared local asset identity icons

**Files:**
- Create: `src/components/AssetIcon.tsx`
- Create: `src/components/AssetIcon.test.tsx`
- Modify: `src/components/FavoriteAssetDialog.tsx`
- Modify: `src/components/mock-portfolio/PortfolioHoldingsTable.tsx`

**Interfaces:**
- Produces: `AssetIcon({ symbol, name?, size?, decorative? })` where `size` is `"sm" | "md" | "lg"` and `decorative` defaults to `true`.
- Produces: `assetIconIdentity(symbol: string): { mark: string; className: string; known: boolean }` for deterministic tests and reuse.
- Consumes: `cn` from `@/lib/utils`; no image host and no new package.

- [ ] **Step 1: Write the failing icon contract tests**

```tsx
expect(assetIconIdentity("btc")).toMatchObject({ mark: "₿", known: true });
expect(assetIconIdentity("ETH")).toMatchObject({ mark: "Ξ", known: true });
expect(assetIconIdentity("XAU")).toMatchObject({ mark: "Au", known: true });
expect(assetIconIdentity("VNINDEX")).toMatchObject({ mark: "VN", known: true });
expect(assetIconIdentity("FPT").known).toBe(true);
expect(assetIconIdentity("ABC")).toEqual(assetIconIdentity("abc"));

const html = renderToStaticMarkup(
  <AssetIcon symbol="ABC" name="ABC Corp" decorative={false} />,
);
expect(html).toContain('aria-label="ABC Corp (ABC)"');
```

- [ ] **Step 2: Run the icon test and verify RED**

Run: `npx vitest run src/components/AssetIcon.test.tsx`

Expected: FAIL because `AssetIcon` and `assetIconIdentity` do not exist.

- [ ] **Step 3: Implement the local mapping and deterministic fallback**

```tsx
const KNOWN = {
  BTC: { mark: "₿", className: "bg-[#f7931a] text-white" },
  ETH: { mark: "Ξ", className: "bg-[#627eea] text-white" },
  XAU: { mark: "Au", className: "bg-amber-500 text-amber-950" },
  VNINDEX: { mark: "VN", className: "bg-red-600 text-white" },
  FPT: { mark: "FPT", className: "bg-blue-600 text-white" },
  VCB: { mark: "VCB", className: "bg-emerald-700 text-white" },
  BID: { mark: "BID", className: "bg-blue-800 text-white" },
  VIC: { mark: "VIC", className: "bg-red-700 text-white" },
} as const;

export function assetIconIdentity(input: string) {
  const symbol = input.trim().toUpperCase();
  const known = KNOWN[symbol as keyof typeof KNOWN];
  if (known) return { ...known, known: true };
  const hue = [...symbol].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 12;
  return {
    mark: symbol.slice(0, 3) || "?",
    className: FALLBACK_COLORS[hue],
    known: false,
  };
}
```

Add mappings for BTC, ETH, SOL, BNB, XRP, LTC, ADA, LINK, XAU, VNINDEX, VIC, VCB, BID, FPT, HPG, VNM, GAS, MSN, MWG, SSI, TCB, MBB, CTG, VHM, and SAB. Render a fixed circular container with `tabular-nums`, bounded text size, and accessible decorative/label attributes.

- [ ] **Step 4: Adopt the icon in the add-asset dialog and Smart Holdings**

Place `<AssetIcon symbol={item.symbol} name={item.name} />` before dialog results and `<AssetIcon symbol={holding.ticker} name={holding.name} />` before each holding name. Remove the existing two-letter gradient circle.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run src/components/AssetIcon.test.tsx src/components/PortfolioNumberFormatting.test.tsx`

Expected: PASS; existing number formatting remains unchanged.

- [ ] **Step 6: Commit the icon slice**

```bash
git add src/components/AssetIcon.tsx src/components/AssetIcon.test.tsx src/components/FavoriteAssetDialog.tsx src/components/mock-portfolio/PortfolioHoldingsTable.tsx
git commit -m "feat: add shared local asset icons"
```

---

### Task 2: Pure merged Asset Opinion workspace model

**Files:**
- Create: `src/lib/asset-opinion-workspace.ts`
- Create: `src/lib/asset-opinion-workspace.test.ts`
- Modify: `src/lib/favorite-assets/state.ts`
- Modify: `src/lib/favorite-assets/state.test.ts`

**Interfaces:**
- Produces: `AssetOpinionWorkspaceItem` with `symbol`, `name`, `opinion`, `watchlistItem`, `holding`, `price`, `currency`, `datasetState`, `isDefaultRepresentative`, `canRemove`, `canSell`, and `backtestHref`.
- Produces: `buildAssetOpinionWorkspace(input): AssetOpinionWorkspaceItem[]`.
- Consumes: `AssetOpinionModel`, `WatchlistItemResponse`, `PortfolioHoldingResponse`, and `favoriteActionState`.

- [ ] **Step 1: Write failing merge, ordering, and permission tests**

```ts
const result = buildAssetOpinionWorkspace({
  opinions: [opinion("BTC"), opinion("FPT"), opinion("ETH")],
  watchlist: [favorite("ETH"), favorite("FPT")],
  holdings: [holding("FPT")],
  watchlistAvailable: true,
  portfolioAvailable: true,
});

expect(result.map((item) => item.symbol)).toEqual(["FPT", "ETH", "BTC", "XAU", "VNINDEX"]);
expect(result.find((item) => item.symbol === "FPT")).toMatchObject({
  canRemove: false,
  canSell: true,
});
expect(result.find((item) => item.symbol === "ETH")).toMatchObject({
  canRemove: true,
  backtestHref: "/quant-lab?symbols=ETH",
});
expect(result.find((item) => item.symbol === "BTC")?.canRemove).toBe(false);
```

Also assert canonical uppercase deduplication, missing-opinion rows, disabled backtest for loading data, and opinion preservation when either source is unavailable.

- [ ] **Step 2: Run the model tests and verify RED**

Run: `npx vitest run src/lib/asset-opinion-workspace.test.ts src/lib/favorite-assets/state.test.ts`

Expected: FAIL because the workspace merger does not exist.

- [ ] **Step 3: Implement the bounded union**

```ts
const DEFAULTS = [
  { symbol: "BTC", name: "Bitcoin", currency: "USDT" },
  { symbol: "XAU", name: "Gold Spot", currency: "USD" },
  { symbol: "VNINDEX", name: "VN-Index", currency: "VND" },
] as const;

export function buildAssetOpinionWorkspace(input: AssetOpinionWorkspaceInput) {
  const ordered = uniqueSymbols([
    ...input.holdings.map((item) => item.ticker),
    ...input.watchlist.map((item) => item.sym),
    ...DEFAULTS.map((item) => item.symbol),
    ...(input.watchlistAvailable && input.portfolioAvailable
      ? []
      : input.opinions.map((item) => item.symbol)),
  ]);
  return ordered.slice(0, 25).map((symbol) => buildWorkspaceItem(symbol, input));
}
```

Use maps for O(n) merging. Holding metadata wins over watchlist metadata, which wins over opinion/default metadata. `canRemove` requires a watchlist id, no holding, and a non-default symbol. `canSell` requires a positive holding quantity and available portfolio state.

- [ ] **Step 4: Keep the Quant Lab handoff helper authoritative**

Retain `favoriteActionState` as the only creator of `/quant-lab?symbols=...`. Add an exported `favoriteDatasetLabel` only if the workspace display needs the same dataset-state text; do not duplicate backtest eligibility logic.

- [ ] **Step 5: Run the focused model tests and verify GREEN**

Run: `npx vitest run src/lib/asset-opinion-workspace.test.ts src/lib/favorite-assets/state.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the model slice**

```bash
git add src/lib/asset-opinion-workspace.ts src/lib/asset-opinion-workspace.test.ts src/lib/favorite-assets/state.ts src/lib/favorite-assets/state.test.ts
git commit -m "feat: merge followed assets into opinion workspace"
```

---

### Task 3: One reusable controlled transaction dialog

**Files:**
- Modify: `src/components/PortfolioTransactionDialog.tsx`
- Modify: `src/components/PortfolioTransactionDialog.test.tsx`

**Interfaces:**
- Extends: `PortfolioTransactionDialog` with optional `open?: boolean`, `onOpenChange?: (open: boolean) => void`, and `trigger?: ReactNode | null`.
- Extends: `preset.price` to `number | null | undefined`; missing/non-positive quote leaves price blank.
- Preserves: every existing uncontrolled call and `triggerLabel` behavior.

- [ ] **Step 1: Write failing controlled-mode tests**

```tsx
const html = renderToStaticMarkup(
  <PortfolioTransactionDialog
    open
    onOpenChange={() => undefined}
    trigger={null}
    holdings={[]}
    disabled={false}
    timeframe="1M"
    onRecorded={() => undefined}
    preset={{ side: "buy", symbol: "XAU", price: null }}
  />,
);
expect(html).not.toContain("transactionsDialog.add");
expect(html).toContain("transactionsDialog.title");
```

Add a source/behavior assertion that controlled `onOpenChange` is called and that a null quote does not become the literal string `null` or `0` in the price field.

- [ ] **Step 2: Run the dialog test and verify RED**

Run: `npx vitest run src/components/PortfolioTransactionDialog.test.tsx`

Expected: FAIL because controlled props and nullable preset prices are unsupported.

- [ ] **Step 3: Implement controlled/uncontrolled state without duplicating the form**

```tsx
const [internalOpen, setInternalOpen] = useState(false);
const resolvedOpen = controlledOpen ?? internalOpen;
const setResolvedOpen = (next: boolean) => {
  if (controlledOpen === undefined) setInternalOpen(next);
  onOpenChange?.(next);
};

const triggerNode =
  trigger === undefined ? <Button onClick={() => setResolvedOpen(true)}>...</Button> : trigger;
```

Use `resolvedOpen` in lazy asset loading and preset effects. When preset price is not finite or is `<= 0`, set the form price to `""`.

- [ ] **Step 4: Run transaction and portfolio tests and verify GREEN**

Run: `npx vitest run src/components/PortfolioTransactionDialog.test.tsx src/lib/portfolio-transaction-preview.test.ts src/components/PortfolioNumberFormatting.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the dialog slice**

```bash
git add src/components/PortfolioTransactionDialog.tsx src/components/PortfolioTransactionDialog.test.tsx
git commit -m "refactor: support one controlled transaction dialog"
```

---

### Task 4: Load watchlist and portfolio once in Smart Insights

**Files:**
- Modify: `src/components/SmartInsights.tsx`
- Modify: `src/lib/watchlist-client.ts`
- Modify: `src/lib/watchlist-client.test.ts`
- Create: `src/components/SmartInsightsDataFlow.test.ts`

**Interfaces:**
- Consumes: `loadFavoriteAssets()`, `getCachedPortfolio("1M")`, and `clearCachedPortfolio()`.
- Produces callbacks to `AssetOpinions`: `onWatchlistSaved(items)`, `onRemoveTrackedAsset(id)`, and `onPortfolioRecorded(portfolio)`.
- Preserves: briefing refresh polling and all current Market Pulse requests.

- [ ] **Step 1: Write failing orchestration guards**

```ts
expect(source).toContain("loadFavoriteAssets");
expect(source).toContain('getCachedPortfolio("1M")');
expect(source).not.toMatch(/opinions\.map[\s\S]{0,200}fetch\(/);
expect(source).not.toContain("FavoriteAssetsPanel");
```

Extend `watchlist-client.test.ts` so `removeFavoriteAsset` returns `{ refreshQueued: true }` when the response header is `X-Smart-Insights-Refresh: queued` and false when it is `failed`.

- [ ] **Step 2: Run the data-flow tests and verify RED**

Run: `npx vitest run src/components/SmartInsightsDataFlow.test.ts src/lib/watchlist-client.test.ts`

Expected: FAIL because Smart Insights does not load watchlist/portfolio and the delete client drops refresh metadata.

- [ ] **Step 3: Add isolated client states and bounded reads**

Add `watchlist`, `watchlistAvailable`, `watchlistError`, `portfolio`, and `portfolioAvailable` state. Extend the existing initial `Promise.allSettled` request group with exactly one watchlist read and one cached portfolio read. A failure in either must not set the whole Smart Insights page to error.

```tsx
const [watchlist, setWatchlist] = useState<WatchlistItemResponse[]>([]);
const [watchlistAvailable, setWatchlistAvailable] = useState(false);
const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
const [portfolioAvailable, setPortfolioAvailable] = useState(false);
```

- [ ] **Step 4: Wire mutation callbacks**

`onWatchlistSaved` replaces the returned watchlist and moves `briefingState` to `generating`. `onRemoveTrackedAsset` calls `removeFavoriteAsset(id)`, filters the successfully removed item from local state without another GET, and starts briefing polling when the response reports a queued refresh. `onPortfolioRecorded` clears the portfolio request cache and replaces local portfolio state with the transaction response.

- [ ] **Step 5: Run focused orchestration tests and verify GREEN**

Run: `npx vitest run src/components/SmartInsightsDataFlow.test.ts src/lib/watchlist-client.test.ts src/lib/portfolio-client.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the orchestration slice**

```bash
git add src/components/SmartInsights.tsx src/components/SmartInsightsDataFlow.test.ts src/lib/watchlist-client.ts src/lib/watchlist-client.test.ts
git commit -m "feat: load tracked assets in Smart Insights"
```

---

### Task 5: Unified Asset Opinion list, add/remove, and quick actions

**Files:**
- Create: `src/components/smart-insights/AssetOpinionActions.tsx`
- Modify: `src/components/smart-insights/AssetOpinions.tsx`
- Modify: `src/components/smart-insights/AssetOpinionList.tsx`
- Modify: `src/components/smart-insights/AssetOpinions.test.tsx`
- Modify: `src/components/FavoriteAssetDialog.tsx`
- Modify: `src/lib/i18n/dictionaries/vi/portfolio.ts`
- Modify: `src/lib/i18n/dictionaries/en/portfolio.ts`
- Delete: `src/components/FavoriteAssetsPanel.tsx`
- Delete: `src/components/WatchlistAddDialog.tsx`

**Interfaces:**
- Consumes: `AssetOpinionWorkspaceItem[]`, `AssetIcon`, `FavoriteAssetDialog`, `PortfolioTransactionDialog`, and the orchestrator's `onRemoveTrackedAsset(id)` callback.
- Produces: `AssetOpinionActions` callbacks `onTrade(side, item)`, `onRemove(item)`, plus the existing analysis selection callback.
- Extends: `AssetOpinions` props with `watchlist`, `watchlistAvailable`, `watchlistError`, `portfolio`, `portfolioAvailable`, `onWatchlistSaved`, `onRemoveTrackedAsset`, and `onPortfolioRecorded`.
- Preserves: one `AssetOpinionDetail` modal and evidence focus-return behavior.

- [ ] **Step 1: Write failing list/header/action render tests**

```tsx
expect(html).toContain("Thêm mã");
expect(html).toContain("Mua BTC");
expect(html).toContain("Bán BTC");
expect(html).toContain("Backtest BTC");
expect(html).toContain("Đang chuẩn bị phân tích");
expect(html).toContain('data-asset-icon="BTC"');
expect(html).not.toContain("Mã yêu thích");
```

Test that Remove exists for a watchlist-only ETH row but not for BTC, XAU, VNINDEX, or a held FPT row. Test that Sell is disabled without a positive holding and Backtest is disabled without a ready timeframe.
Test that a watchlist read failure keeps opinion rows visible, disables Add/Remove, and renders a concise tracking error; test that a portfolio read failure disables Buy/Sell without hiding analysis or Backtest.

- [ ] **Step 2: Run the Asset Opinion tests and verify RED**

Run: `npx vitest run src/components/smart-insights/AssetOpinions.test.tsx src/lib/asset-opinion-workspace.test.ts`

Expected: FAIL because the header and row actions are absent.

- [ ] **Step 3: Implement focused action controls**

Desktop renders Buy, Sell, and Backtest directly; its overflow dropdown contains Remove. Mobile renders Buy and Sell directly; its overflow contains Backtest and conditional Remove. All action wrappers call `event.stopPropagation()` on click and keyboard events.

```tsx
<Button aria-label={`${buyLabel} ${item.symbol}`} onClick={() => onTrade("buy", item)}>
  {buyLabel}
</Button>
```

Use a `title` explanation on disabled controls: no portfolio/position for Sell, and data preparation required for Backtest.

- [ ] **Step 4: Integrate the merged rows and dialogs**

Build rows with `buildAssetOpinionWorkspace`. Add one `FavoriteAssetDialog`, one controlled `PortfolioTransactionDialog`, one removal `AlertDialog`, and the existing one Asset Opinion detail modal. For a row without `opinion`, disable analysis selection and render `Preparing analysis`; never render stance, confidence, or thesis placeholders. When `watchlistError` is present, keep analysis visible, show the error below the section header, and disable Add/Remove. When `portfolioAvailable` is false, disable Buy/Sell while leaving Backtest and analysis unchanged.

- [ ] **Step 5: Update consumer wording and remove the duplicate panel**

Change visible dialog copy from favorite-specific wording to `Thêm mã theo dõi`, `Tìm mã chứng khoán Việt, crypto hoặc XAU`, and `Thêm vào Quan điểm AI`. Delete the now-unused Favorites panel and wrapper component. Keep `/api/watchlist` and its backend names unchanged.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `npx vitest run src/components/smart-insights/AssetOpinions.test.tsx src/components/PortfolioTransactionDialog.test.tsx src/lib/asset-opinion-workspace.test.ts src/lib/watchlist-client.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the unified Smart Insights UI**

```bash
git add src/components/smart-insights src/components/FavoriteAssetDialog.tsx src/components/FavoriteAssetsPanel.tsx src/components/WatchlistAddDialog.tsx src/lib/i18n/dictionaries/vi/portfolio.ts src/lib/i18n/dictionaries/en/portfolio.ts
git commit -m "feat: unify tracked assets with AI opinions"
```

---

### Task 6: Reorder Mock Portfolio and surface asset allocation icons

**Files:**
- Modify: `src/components/MockPortfolio.tsx`
- Modify: `src/components/mock-portfolio/PortfolioOverviewPanel.tsx`
- Modify: `src/components/mock-portfolio/PortfolioTransactionLog.tsx`
- Modify: `src/components/mock-portfolio/component-boundaries.test.ts`
- Modify: `src/components/PortfolioNumberFormatting.test.tsx`
- Create: `src/components/MockPortfolioLayout.test.ts`

**Interfaces:**
- Extends: `PortfolioOverviewPanel` with `onRecorded: (portfolio: PortfolioResponse) => void`.
- Consumes: existing `portfolio.holdings`, timeframe, base currency, `AssetIcon`, and `PortfolioTransactionDialog`.
- Produces: top-level Add Transaction trigger inside the total summary and asset-level allocation details.

- [ ] **Step 1: Write failing layout-order and trigger tests**

```ts
const source = readFileSync("src/components/MockPortfolio.tsx", "utf8");
expect(source).not.toContain("FavoriteAssetsPanel");
expect(source.indexOf("PortfolioHoldingsTable")).toBeLessThan(
  source.indexOf("PortfolioRiskMetrics"),
);
expect(source.indexOf("PortfolioRiskMetrics")).toBeLessThan(
  source.indexOf("StrategyAssignmentPanel"),
);

const overview = renderToStaticMarkup(<PortfolioOverviewPanel {...props} />);
expect(overview).toContain("transactionsDialog.add");
expect(overview).toContain('data-testid="allocation-assets"');
expect(overview).toContain('data-asset-icon="BTC"');
```

- [ ] **Step 2: Run layout tests and verify RED**

Run: `npx vitest run src/components/MockPortfolioLayout.test.ts src/components/PortfolioNumberFormatting.test.tsx`

Expected: FAIL because the transaction trigger is still in transaction history and allocation has no asset detail.

- [ ] **Step 3: Put Add Transaction beside the total portfolio value**

Render `PortfolioTransactionDialog` in the total-balance card. Use desktop alignment beside the total and a full-width mobile placement directly below it. Continue passing `holdings`, `timeframe`, `portfolioCurrency`, and `onRecorded` from `MockPortfolio`.

- [ ] **Step 4: Put Risk Metrics immediately below Smart Holdings**

Remove `FavoriteAssetsPanel` from `MockPortfolio`; keep the explicit sequence Overview → Holdings → Risk → Strategies → Forward Tests → Transaction Log. Remove the duplicate `PortfolioTransactionDialog` from `PortfolioTransactionLog` and drop its now-unused `holdings`, `disabled`, `timeframe`, and `onRecorded` props; the single top summary trigger is authoritative.

- [ ] **Step 5: Add bounded asset allocation detail**

Under the existing category pie/legend, render up to the first eight holdings ordered by allocation. Each row uses `AssetIcon`, symbol, name, and `formatPercent(holding.alloc)`. Do not change the category pie values or create a pseudo-symbol for Cash/Stocks/Crypto.

- [ ] **Step 6: Update tests after deleting the standalone Favorites panel**

Move the favorite-price formatting assertions to Smart Insights row tests using `AssetOpinionWorkspaceItem` quote/currency values. Retain all total, holding, risk, transaction, and strategy formatting assertions.

- [ ] **Step 7: Run focused portfolio tests and verify GREEN**

Run: `npx vitest run src/components/MockPortfolioLayout.test.ts src/components/PortfolioNumberFormatting.test.tsx src/components/mock-portfolio/component-boundaries.test.ts src/components/PortfolioTransactionDialog.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit the Mock Portfolio layout**

```bash
git add src/components/MockPortfolio.tsx src/components/mock-portfolio src/components/MockPortfolioLayout.test.ts src/components/PortfolioNumberFormatting.test.tsx
git commit -m "feat: prioritize portfolio transactions and risk"
```

---

### Task 7: Authenticated responsive workflow and release verification

**Files:**
- Modify: `e2e/smart-insights-asset-opinions.spec.ts`
- Create: `e2e/mock-portfolio-layout.spec.ts`

**Interfaces:**
- Consumes: real authenticated watchlist, portfolio, briefing, and Quant Lab routes in the test database.
- Produces: desktop/mobile proof for combined asset actions, dialog behavior, section ordering, icons, and request bounds.

- [ ] **Step 1: Extend the Smart Insights E2E fixture**

Seed tenant-scoped watchlist items for ETH, SOL, ADA, FPT, and one removable asset. Seed one positive BTC position/transaction and an eligible active 1D dataset for the Backtest fixture. Continue seeding the grounded briefing; do not stub the page APIs.

```ts
const provider = await prisma.dataProvider.upsert({
  where: { code: "smart-insights-e2e" },
  create: { code: "smart-insights-e2e", name: "Smart Insights E2E" },
  update: {},
});
const fpt = await prisma.asset.findUniqueOrThrow({ where: { symbol: "FPT" } });
const dataset = await prisma.dataset.upsert({
  where: {
    assetId_timeframe_adjustmentPolicy: {
      assetId: fpt.id,
      timeframe: "1d",
      adjustmentPolicy: "raw",
    },
  },
  create: { assetId: fpt.id, timeframe: "1d", adjustmentPolicy: "raw" },
  update: {},
});
await prisma.datasetVersion.updateMany({ where: { datasetId: dataset.id }, data: { isActive: false } });
const latestVersion = await prisma.datasetVersion.aggregate({
  where: { datasetId: dataset.id },
  _max: { version: true },
});
await prisma.datasetVersion.create({
  data: {
    datasetId: dataset.id,
    providerId: provider.id,
    version: (latestVersion._max.version ?? 0) + 1,
    checksum: randomUUID().replaceAll("-", ""),
    coverageStart: new Date("2025-01-01T00:00:00Z"),
    coverageEnd: asOf,
    rowCount: 300,
    qualityStatus: "passed",
    isActive: true,
  },
});
await prisma.watchlistItem.upsert({
  where: { organizationId_userId_assetId: { organizationId, userId: user.id, assetId: fpt.id } },
  create: { organizationId, userId: user.id, assetId: fpt.id },
  update: {},
});
```

Use the same compound-key upsert for the other followed assets. Insert the BTC buy transaction into the workspace portfolio returned by onboarding, using a positive quantity, positive price, zero fee, and `executedAt: asOf`.

- [ ] **Step 2: Add failing workflow assertions**

```ts
await expect(page.getByRole("button", { name: "Thêm mã" })).toBeVisible();
await page.getByRole("button", { name: "Mua BTC" }).click();
await expect(page.getByRole("dialog")).toContainText("BTC");
await page.keyboard.press("Escape");
await expect(page.getByRole("button", { name: "Bán ETH" })).toBeDisabled();
await expect(page.getByRole("link", { name: "Backtest FPT" })).toHaveAttribute(
  "href",
  "/quant-lab?symbols=FPT",
);
```

Add the asset-dialog selection flow, removal confirmation, non-removable BTC/default assertions, no row-action propagation into the analysis dialog, focus return, one watchlist GET, one portfolio GET, and no horizontal overflow.

- [ ] **Step 3: Add Mock Portfolio desktop/mobile assertions**

Verify Add Transaction is visible inside the summary before scrolling, Smart Holdings precedes Risk Metrics, the Favorites heading is absent, holdings/allocation show asset icons, and the page has no horizontal overflow.

- [ ] **Step 4: Run focused E2E and fix only observed regressions**

Run: `npx playwright test e2e/smart-insights-asset-opinions.spec.ts e2e/mock-portfolio-layout.spec.ts`

Expected: both desktop and mobile projects PASS with no console/page errors.

- [ ] **Step 5: Run the complete verification matrix**

```bash
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

Expected: all commands exit 0. Record test counts and any pre-existing warnings separately.

- [ ] **Step 6: Verify the local runtime**

Restart the local app through `npm run dev`, verify the actual listener, then require HTTP 200 from `http://localhost:3100`. Do not stop unrelated listeners or worktrees.

- [ ] **Step 7: Commit verification corrections**

```bash
git add e2e/smart-insights-asset-opinions.spec.ts e2e/mock-portfolio-layout.spec.ts
git commit -m "test: cover unified asset opinion workflows"
```

Do not create an empty commit if verification required no source/test corrections.
