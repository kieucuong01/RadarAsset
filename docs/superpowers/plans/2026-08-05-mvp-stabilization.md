# MVP Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Làm cho ba trang MVP dùng được trên mobile, không còn horizontal overflow ngoài ý muốn, không còn dead link/nút giả và mọi dữ liệu mẫu hoặc mô phỏng đều được nhận diện rõ.

**Architecture:** Tập trung route, trạng thái nguồn dữ liệu và trạng thái tính năng vào các module thuần có thể kiểm thử bằng Vitest. Các component hiện tại tiêu thụ các hợp đồng đó; chỉ tách thêm dialog watchlist và client helper để tránh làm `SmartInsights.tsx` lớn hơn. Sửa overflow tại container gây lỗi, không che ở `html`/`body`.

**Tech Stack:** Next.js 16.2, React 19.2, TypeScript 5.8, Tailwind CSS 4, shadcn/Radix, Vitest 4, PostgreSQL/Prisma APIs hiện có.

## Global Constraints

- Chỉ giữ ba route sản phẩm: `/`, `/portfolio`, `/quant-lab`; không tạo `/asset/[symbol]`.
- Không xây backend AI audio, alert, notification, backtest hoặc prediction mới.
- `GET/POST /api/watchlist` là luồng ghi duy nhất được bổ sung vào Smart Insights.
- `Apply to My Portfolio` không được gọi thẳng API giao dịch vì thiếu bước nhập giá, số lượng và xác nhận.
- Không dùng `overflow-x-hidden` trên `html`, `body` hoặc container cấp trang để che lỗi.
- Vùng chạm tương tác chính trên mobile tối thiểu 44px; icon button phải có accessible name và focus ring nhìn thấy được.
- Fallback phải mang trạng thái `SAMPLE`; kết quả Quant Lab và Mock Portfolio mang trạng thái `SIMULATED`.
- Không thêm dependency mới.
- Dùng Node >=20.9; trên workspace này ưu tiên bundled Node 24 tại `C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin`.
- Mỗi task chỉ stage/commit các file được liệt kê trong task đó; giữ nguyên mọi thay đổi không liên quan.

---

## File Structure

### Files to create

- `src/lib/mvp-ui.ts`: hợp đồng `DataStatus`, nhãn nguồn dữ liệu và feature availability.
- `src/lib/mvp-ui.test.ts`: kiểm thử đầy đủ các trạng thái và feature flags.
- `src/components/DataStatusBadge.tsx`: badge trình bày trạng thái, không tự suy đoán nguồn.
- `src/lib/navigation.ts`: registry duy nhất cho ba route đang tồn tại.
- `src/lib/navigation.test.ts`: kiểm thử route hợp lệ, duy nhất và không chứa asset route.
- `src/components/mvp-stabilization.test.ts`: guard nguồn cho dead link, nút/toast giả và tuyên bố live giả.
- `src/lib/watchlist-client.ts`: helper POST watchlist có lỗi rõ ràng và dependency-injected fetch.
- `src/lib/watchlist-client.test.ts`: kiểm thử request, response và API error.
- `src/components/WatchlistAddDialog.tsx`: form thêm tài sản thật qua API hiện có.

### Files to modify

- `src/components/Header.tsx`: dùng route registry, thêm mobile `Sheet`, bỏ notification giả.
- `src/components/Footer.tsx`: chỉ giữ route thật; bỏ social/resources/company giả.
- `src/components/CommandPalette.tsx`: chỉ giữ route thật và toggle theme.
- `src/components/AppShell.tsx`: cho flex child co lại bằng `min-w-0`.
- `src/components/TickerTape.tsx`: bỏ jitter giả, theo dõi `SYSTEM/SAMPLE`, chặn marquee làm rộng trang.
- `src/components/MockPortfolio.tsx`: ghi rõ đây là danh mục mô phỏng lưu trong hệ thống.
- `src/lib/backend/types.ts`: thêm kiểu response watchlist dùng chung.
- `src/components/SmartInsights.tsx`: nhãn nguồn, lỗi fallback, watchlist thật, nút disabled và sửa grid overflow.
- `src/components/QuantLab.tsx`: nhãn mô phỏng, bỏ claim live/accuracy/training giả và sửa container rộng.

---

### Task 1: Shared MVP status contracts

**Files:**
- Create: `src/lib/mvp-ui.ts`
- Create: `src/lib/mvp-ui.test.ts`
- Create: `src/components/DataStatusBadge.tsx`

**Interfaces:**
- Produces: `DataStatus = "SYSTEM" | "SAMPLE" | "SIMULATED" | "UNAVAILABLE"`.
- Produces: `DATA_STATUS_META: Record<DataStatus, { label: string; description: string }>`.
- Produces: `MVP_FEATURES` with keys `listenBriefing`, `applyPortfolio`, `watchlistAdd`, `alertEdit`, `notifications`.
- Produces: `isFeatureAvailable(feature: MvpFeature): boolean`.
- Produces: `<DataStatusBadge status detail? className? />`.

- [ ] **Step 1: Write the failing contract tests**

Create `src/lib/mvp-ui.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { DATA_STATUS_META, MVP_FEATURES, isFeatureAvailable } from "./mvp-ui";

describe("MVP UI contracts", () => {
  it("provides a visible Vietnamese label for every data status", () => {
    expect(DATA_STATUS_META).toEqual({
      SYSTEM: expect.objectContaining({ label: "Dữ liệu hệ thống" }),
      SAMPLE: expect.objectContaining({ label: "Dữ liệu mẫu" }),
      SIMULATED: expect.objectContaining({ label: "Mô phỏng" }),
      UNAVAILABLE: expect.objectContaining({ label: "Chưa khả dụng trong MVP" }),
    });
  });

  it("only enables the watchlist action in this sprint", () => {
    expect(isFeatureAvailable("watchlistAdd")).toBe(true);
    expect(isFeatureAvailable("listenBriefing")).toBe(false);
    expect(isFeatureAvailable("applyPortfolio")).toBe(false);
    expect(isFeatureAvailable("alertEdit")).toBe(false);
    expect(isFeatureAvailable("notifications")).toBe(false);
    expect(Object.keys(MVP_FEATURES)).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
$env:Path = "C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;$env:Path"
npm test -- src/lib/mvp-ui.test.ts
```

Expected: FAIL because `src/lib/mvp-ui.ts` does not exist.

- [ ] **Step 3: Implement the pure contracts**

Create `src/lib/mvp-ui.ts` with this public shape:

```ts
export const DATA_STATUS_META = {
  SYSTEM: { label: "Dữ liệu hệ thống", description: "Được tải từ API hoặc database hiện có." },
  SAMPLE: { label: "Dữ liệu mẫu", description: "Nội dung seed hoặc fallback, không phải dữ liệu live." },
  SIMULATED: { label: "Mô phỏng", description: "Kết quả minh họa, không phải giao dịch hoặc dự báo thực." },
  UNAVAILABLE: { label: "Chưa khả dụng trong MVP", description: "Tính năng chưa có luồng vận hành thực." },
} as const;

export type DataStatus = keyof typeof DATA_STATUS_META;

export const MVP_FEATURES = {
  listenBriefing: { available: false },
  applyPortfolio: { available: false },
  watchlistAdd: { available: true },
  alertEdit: { available: false },
  notifications: { available: false },
} as const;

export type MvpFeature = keyof typeof MVP_FEATURES;

export function isFeatureAvailable(feature: MvpFeature) {
  return MVP_FEATURES[feature].available;
}
```

- [ ] **Step 4: Implement the presentation-only badge**

Create `src/components/DataStatusBadge.tsx` using the existing `Badge` and `cn` helpers:

```tsx
import { Badge } from "@/components/ui/badge";
import { DATA_STATUS_META, type DataStatus } from "@/lib/mvp-ui";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<DataStatus, string> = {
  SYSTEM: "border-bull/30 bg-bull/10 text-bull",
  SAMPLE: "border-chart-4/30 bg-chart-4/10 text-chart-4",
  SIMULATED: "border-primary/30 bg-primary/10 text-primary",
  UNAVAILABLE: "border-border bg-muted text-muted-foreground",
};

export function DataStatusBadge({
  status,
  detail,
  className,
}: {
  status: DataStatus;
  detail?: string;
  className?: string;
}) {
  const meta = DATA_STATUS_META[status];
  return (
    <Badge
      variant="outline"
      className={cn("whitespace-nowrap font-mono text-[10px] uppercase tracking-wider", STATUS_STYLES[status], className)}
      title={detail ?? meta.description}
    >
      {meta.label}
    </Badge>
  );
}
```

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```powershell
npm test -- src/lib/mvp-ui.test.ts
npx tsc --noEmit
```

Expected: test PASS and TypeScript exits 0.

- [ ] **Step 6: Commit the shared contracts**

```powershell
git add src/lib/mvp-ui.ts src/lib/mvp-ui.test.ts src/components/DataStatusBadge.tsx
git commit -m "feat: add MVP data status contracts"
```

---

### Task 2: Valid navigation and mobile menu

**Files:**
- Create: `src/lib/navigation.ts`
- Create: `src/lib/navigation.test.ts`
- Create: `src/components/mvp-stabilization.test.ts`
- Modify: `src/components/Header.tsx`
- Modify: `src/components/Footer.tsx`
- Modify: `src/components/CommandPalette.tsx`

**Interfaces:**
- Consumes: existing `Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle`, `SheetTrigger`.
- Produces: `APP_ROUTES` and `AppRouteId` for Header, Footer and Command Palette.
- Produces: mobile menu trigger with accessible name `Mở menu chính`.

- [ ] **Step 1: Write failing navigation and dead-link tests**

Create `src/lib/navigation.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { APP_ROUTES } from "./navigation";

describe("application routes", () => {
  it("contains exactly the three implemented routes", () => {
    expect(APP_ROUTES.map((route) => route.href)).toEqual(["/", "/portfolio", "/quant-lab"]);
    expect(new Set(APP_ROUTES.map((route) => route.href)).size).toBe(APP_ROUTES.length);
    expect(APP_ROUTES.some((route) => route.href.startsWith("/asset/"))).toBe(false);
  });
});
```

Create `src/components/mvp-stabilization.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");

describe("MVP stabilization source contracts", () => {
  it("does not expose placeholder or missing navigation", () => {
    const footer = source("Footer.tsx");
    const palette = source("CommandPalette.tsx");
    expect(footer).not.toContain('href="#"');
    expect(palette).not.toContain("/asset/");
    expect(palette).not.toContain("Backtest triggered");
    expect(palette).not.toContain("AI Briefing refreshing");
  });

  it("does not render a fake notification control", () => {
    expect(source("Header.tsx")).not.toContain('aria-label="Notifications"');
  });
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```powershell
npm test -- src/lib/navigation.test.ts src/components/mvp-stabilization.test.ts
```

Expected: FAIL because the registry is missing and current components still contain placeholder navigation.

- [ ] **Step 3: Create the route registry**

Create `src/lib/navigation.ts`:

```ts
export const APP_ROUTES = [
  { id: "insights", href: "/", label: "Smart Insights", mobileLabel: "Tổng quan" },
  { id: "portfolio", href: "/portfolio", label: "Mock Portfolio", mobileLabel: "Danh mục" },
  { id: "quantLab", href: "/quant-lab", label: "Quant Lab", mobileLabel: "Quant Lab" },
] as const;

export type AppRouteId = (typeof APP_ROUTES)[number]["id"];
```

- [ ] **Step 4: Replace Header navigation and add the controlled mobile Sheet**

In `src/components/Header.tsx`:

- Import `useState`, `Menu`, the Sheet primitives, `APP_ROUTES` and `AppRouteId`.
- Define `routeIcons: Record<AppRouteId, LucideIcon>` locally.
- Render both desktop and mobile links from `APP_ROUTES`.
- Control the Sheet with `mobileOpen`; close it from each mobile Link.
- Remove the Bell import, notification button and unread dot.
- Give menu/theme controls `size-11` or equivalent 44px hit targets on mobile.

Use this mobile structure:

```tsx
<Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
  <SheetTrigger asChild>
    <button
      aria-label="Mở menu chính"
      className="grid size-11 place-items-center rounded-full bg-muted/60 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:hidden"
    >
      <Menu className="size-5" />
    </button>
  </SheetTrigger>
  <SheetContent side="right" className="w-[min(20rem,calc(100vw-2rem))]">
    <SheetHeader>
      <SheetTitle>RadarAsset</SheetTitle>
    </SheetHeader>
    <nav aria-label="Điều hướng chính" className="mt-6 grid gap-2">
      {APP_ROUTES.map((route) => (
        <Link key={route.id} href={route.href} onClick={() => setMobileOpen(false)}>
          {route.mobileLabel}
        </Link>
      ))}
    </nav>
  </SheetContent>
</Sheet>
```

Preserve active route styling and include `aria-current={active ? "page" : undefined}` on desktop and mobile links.

- [ ] **Step 5: Remove fake footer and command actions**

In `src/components/Footer.tsx`:

- Render one `Product` list from `APP_ROUTES` using Next `Link`.
- Remove Twitter/GitHub icons and anchors.
- Remove Resources and Company columns entirely.
- Change the grid to `md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]` and add `min-w-0` to both columns.

In `src/components/CommandPalette.tsx`:

- Render Navigation items from `APP_ROUTES` and local icon mapping.
- Keep only the real theme toggle under Actions.
- Remove the Assets group, fake Backtest action, fake AI refresh action, `toast` import and `run()` helper.
- Change the input placeholder to `Search pages or commands…`.

- [ ] **Step 6: Run focused tests, lint affected files and typecheck**

Run:

```powershell
npm test -- src/lib/navigation.test.ts src/components/mvp-stabilization.test.ts
npx eslint src/lib/navigation.ts src/lib/navigation.test.ts src/components/Header.tsx src/components/Footer.tsx src/components/CommandPalette.tsx src/components/mvp-stabilization.test.ts
npx tsc --noEmit
```

Expected: tests PASS; ESLint has no errors; TypeScript exits 0.

- [ ] **Step 7: Commit navigation stabilization**

```powershell
git add src/lib/navigation.ts src/lib/navigation.test.ts src/components/mvp-stabilization.test.ts src/components/Header.tsx src/components/Footer.tsx src/components/CommandPalette.tsx
git commit -m "fix: add mobile navigation and remove dead links"
```

---

### Task 3: Truthful ticker and simulated portfolio label

**Files:**
- Modify: `src/components/mvp-stabilization.test.ts`
- Modify: `src/components/AppShell.tsx`
- Modify: `src/components/TickerTape.tsx`
- Modify: `src/components/MockPortfolio.tsx`

**Interfaces:**
- Consumes: `DataStatus`, `<DataStatusBadge />` from Task 1.
- Produces: ticker status that is `SAMPLE` until a non-empty API response succeeds, then `SYSTEM`.
- Produces: persistent `SIMULATED` label for the database-backed demo portfolio.

- [ ] **Step 1: Extend the source contract test and confirm RED**

Add to `src/components/mvp-stabilization.test.ts`:

```ts
it("does not fabricate ticker movement and labels simulated portfolio data", () => {
  const ticker = source("TickerTape.tsx");
  const portfolio = source("MockPortfolio.tsx");
  expect(ticker).not.toContain("function jitter");
  expect(ticker).not.toContain("setInterval");
  expect(ticker).toContain("DataStatusBadge");
  expect(portfolio).toContain('status="SIMULATED"');
});
```

Run:

```powershell
npm test -- src/components/mvp-stabilization.test.ts
```

Expected: FAIL because ticker jitter still exists and the portfolio lacks the badge.

- [ ] **Step 2: Remove fake ticker movement and expose fallback state**

In `src/components/TickerTape.tsx`:

- Delete `jitter()` and the interval effect.
- Add `const [status, setStatus] = useState<DataStatus>("SAMPLE")`.
- Add `const [statusDetail, setStatusDetail] = useState("Đang hiển thị dữ liệu mẫu.")`; on API failure set it to `Ticker API không khả dụng; đang hiển thị dữ liệu mẫu.` and on success set it to `Được tải từ /api/market/ticker.`.
- On a successful non-empty ticker API response, set rows and `setStatus("SYSTEM")`.
- On API error or empty response, retain `SEED` and `SAMPLE`.
- Render a fixed `<DataStatusBadge status={status} detail={statusDetail} />` next to a `min-w-0 flex-1 overflow-hidden` marquee viewport.
- Put the animated track inside the clipped viewport with `w-max`.
- Add a reduced-motion rule that disables the animation.

Target structure:

```tsx
<div className="flex min-w-0 items-center border-b border-border bg-card/40">
  <div className="shrink-0 px-2 sm:px-3">
    <DataStatusBadge status={status} detail={statusDetail} />
  </div>
  <div className="min-w-0 flex-1 overflow-hidden">
    <div className="ticker-track flex w-max items-center gap-8 whitespace-nowrap py-2.5">
      {/* duplicated rows */}
    </div>
  </div>
</div>
```

CSS must include:

```css
@media (prefers-reduced-motion: reduce) {
  .ticker-track {
    animation: none;
    transform: none;
  }
}
```

- [ ] **Step 3: Mark the demo portfolio explicitly**

In `PortfolioHeader` in `src/components/MockPortfolio.tsx`:

- Change the title to `Danh mục mô phỏng – Phân tích tài sản`.
- Add `<DataStatusBadge status="SIMULATED" detail="Danh mục demo được lưu trong PostgreSQL; không phải tài khoản môi giới thực." />` next to the data-source card.
- Keep the actual `portfolio.dataSource` and timestamp visible because they describe persistence, not market liveness.

In `src/components/AppShell.tsx`, change the content wrapper to:

```tsx
<div className="min-w-0 flex-1">{children}</div>
```

- [ ] **Step 4: Run the focused test and typecheck**

Run:

```powershell
npm test -- src/components/mvp-stabilization.test.ts
npx eslint src/components/TickerTape.tsx src/components/MockPortfolio.tsx src/components/AppShell.tsx
npx tsc --noEmit
```

Expected: source contract PASS, no ESLint errors and TypeScript exits 0.

- [ ] **Step 5: Commit truthful ticker and portfolio copy**

```powershell
git add src/components/mvp-stabilization.test.ts src/components/TickerTape.tsx src/components/MockPortfolio.tsx src/components/AppShell.tsx
git commit -m "fix: label demo portfolio and ticker fallback"
```

---

### Task 4: Smart Insights provenance, real watchlist action and overflow

**Files:**
- Modify: `src/lib/backend/types.ts`
- Create: `src/lib/watchlist-client.ts`
- Create: `src/lib/watchlist-client.test.ts`
- Create: `src/components/WatchlistAddDialog.tsx`
- Modify: `src/components/SmartInsights.tsx`
- Modify: `src/components/mvp-stabilization.test.ts`

**Interfaces:**
- Produces: `WatchlistItemResponse` from `src/lib/backend/types.ts`.
- Produces: `saveWatchlistItem(input, request?) => Promise<WatchlistItemResponse[]>`.
- Produces: `<WatchlistAddDialog open onOpenChange onSaved />`.
- Consumes: `DataStatusBadge` and feature flags from Task 1.

- [ ] **Step 1: Write failing watchlist helper tests**

Create `src/lib/watchlist-client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { saveWatchlistItem } from "./watchlist-client";

describe("watchlist client", () => {
  it("posts a normalized asset and returns the refreshed list", async () => {
    const request = vi.fn(async () =>
      new Response(
        JSON.stringify([
          { id: "w1", sym: "BTC", name: "Bitcoin", price: 67420, chg: 2.5, alert: 70000, sentiment: "bull" },
        ]),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await saveWatchlistItem({ symbol: " btc ", alert: 70000 }, request);

    expect(request).toHaveBeenCalledWith(
      "/api/watchlist",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ symbol: "BTC", alert: 70000 }),
      }),
    );
    expect(result[0]?.sym).toBe("BTC");
  });

  it("surfaces the API error instead of reporting fake success", async () => {
    const request = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Asset ABC not found." }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(saveWatchlistItem({ symbol: "ABC", alert: null }, request)).rejects.toThrow(
      "Asset ABC not found.",
    );
  });
});
```

- [ ] **Step 2: Extend Smart Insights source guards and confirm RED**

Add this test to `src/components/mvp-stabilization.test.ts`:

```ts
it("removes Smart Insights fake actions and unsupported live claims", () => {
  const smart = source("SmartInsights.tsx");
  expect(smart).not.toContain('href="#"');
  expect(smart).not.toContain("AI thesis applied to your portfolio");
  expect(smart).not.toContain("Synthesized from 124 sources");
  expect(smart).not.toContain("Updated 5m ago");
  expect(smart).not.toMatch(/\bLive\b/);
  expect(smart).toContain("WatchlistAddDialog");
});
```

Run:

```powershell
npm test -- src/lib/watchlist-client.test.ts src/components/mvp-stabilization.test.ts
```

Expected: FAIL because the helper/dialog do not exist and fake UI remains.

- [ ] **Step 3: Add the typed watchlist client**

Append to `src/lib/backend/types.ts`:

```ts
export type WatchlistItemResponse = {
  id: string;
  sym: string;
  name: string;
  price: number;
  chg: number;
  alert: number;
  sentiment: "bull" | "bear" | "neutral";
};
```

Create `src/lib/watchlist-client.ts`:

```ts
import type { WatchlistItemResponse } from "@/lib/backend/types";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function saveWatchlistItem(
  input: { symbol: string; alert?: number | null },
  request: FetchLike = fetch,
): Promise<WatchlistItemResponse[]> {
  const payload = { symbol: input.symbol.trim().toUpperCase(), alert: input.alert ?? null };
  const response = await request("/api/watchlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => null)) as
    | WatchlistItemResponse[]
    | { error?: string }
    | null;
  if (!response.ok) {
    throw new Error(!Array.isArray(body) && body?.error ? body.error : "Không thể thêm tài sản vào watchlist.");
  }
  return body as WatchlistItemResponse[];
}
```

- [ ] **Step 4: Build the real add-asset dialog**

Create `src/components/WatchlistAddDialog.tsx` with controlled `open`, symbol and optional alert fields. On submit:

1. Reject an empty symbol in the form.
2. Set `pending=true` and clear the previous error.
3. Call `saveWatchlistItem({ symbol, alert: alertText ? Number(alertText) : null })`.
4. Call `onSaved(rows)`, show a real success toast, reset fields and close only after the API resolves.
5. On rejection, render the error inside the dialog and keep it open.
6. Disable submit while pending and label the button `Đang lưu…`.

Use this public signature:

```tsx
export function WatchlistAddDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (items: WatchlistItemResponse[]) => void;
}) {
  // controlled Dialog + real POST helper
}
```

Use existing `Dialog`, `Button`, `Input`, `Label` and `toast`; do not add a form library.

- [ ] **Step 5: Make Smart Insights provenance explicit**

In `src/components/SmartInsights.tsx`:

- Replace the local `WatchItem` type with `WatchlistItemResponse`.
- Add stable fallback IDs such as `sample-btc` to every row in `WATCHLIST` so the fallback satisfies `WatchlistItemResponse` without weakening the API type.
- Track a `DataStatus` beside each fallback-backed dataset: market ticker, watchlist, economic calendar and news.
- Initialize each to `SAMPLE`; set it to `SYSTEM` after any successful API response, including an empty array.
- Store a short load-error string on catch so the badge `detail` can say the sample is displayed because the API failed.
- Investor Intelligence has no local fallback: extend `InvestorIntelligencePanel` with `status: DataStatus` and `error: string | null`; show `UNAVAILABLE` plus the visible error message if its API fails, and show `SYSTEM` when data is returned.
- Label Daily Briefing, AI Digest, Fear & Greed and On-Chain Pulse as `SAMPLE`.
- Replace `Synthesized from 124 sources · ... · refreshed 5m ago` with `Nội dung minh họa; không tổng hợp theo thời gian thực.`
- Replace `Updated 5m ago` and Trending `Live` with the appropriate status badge.
- Add source badges to Watchlist, Economic Calendar and Expert Signals headers.
- Remove the `Read full expert signal` anchor because `News` has no destination URL; render non-interactive text `Tóm tắt trong MVP`.

For API state, use this exact transition pattern rather than preserving fallback on an empty system response:

```tsx
const [newsStatus, setNewsStatus] = useState<DataStatus>("SAMPLE");
const [newsError, setNewsError] = useState<string | null>(null);

// success
setNews(rows.map(toNews));
setNewsStatus("SYSTEM");
setNewsError(null);

// catch
setNewsStatus("SAMPLE");
setNewsError("Insights API không khả dụng; đang hiển thị dữ liệu mẫu.");
```

- [ ] **Step 6: Replace fake actions with one real action and explicit disabled states**

In `SmartInsights.tsx`:

- Drive `listenBriefing`, `applyPortfolio` and `alertEdit` disabled values from `isFeatureAvailable(...)`; add `aria-disabled`, disabled styling and adjacent `Chưa khả dụng trong MVP` text/badge; remove their click handlers.
- Replace Watchlist `Add asset` toast with state that opens `<WatchlistAddDialog />`.
- When `onSaved` returns, replace `items`, set Watchlist status to `SYSTEM` and clear the load error.
- Keep the per-row alert edit control disabled with `title="Chưa khả dụng trong MVP"`; remove its toast handler.
- Keep the client-side `Sort by 24h` action because it genuinely changes visible state.
- Remove unused `Play`, `ArrowRight` or `toast` imports only when they are no longer referenced.

- [ ] **Step 7: Fix Smart Insights overflow at the responsible grids**

Make these exact class changes:

- Main: add `min-w-0`.
- Daily Briefing inner grid: `md:grid-cols-[minmax(0,1fr)_auto]`; add `min-w-0` to its text column.
- AI Digest grid: `lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]`; add `min-w-0` to both children.
- Market Pulse: `min-w-0 lg:grid-cols-[320px_minmax(0,1fr)]`; add `min-w-0` to both cards.
- Other split grids touched by this task: replace flexible `1fr` tracks with `minmax(0,1fr)` and add `min-w-0` to chart/list children.
- Preserve intentional local `overflow-x-auto` on tables and the Trending Assets strip.

- [ ] **Step 8: Run focused and full component checks**

Run:

```powershell
npm test -- src/lib/watchlist-client.test.ts src/components/mvp-stabilization.test.ts
npx eslint src/lib/backend/types.ts src/lib/watchlist-client.ts src/lib/watchlist-client.test.ts src/components/WatchlistAddDialog.tsx src/components/SmartInsights.tsx src/components/mvp-stabilization.test.ts
npx tsc --noEmit
```

Expected: tests PASS, no ESLint errors and TypeScript exits 0.

- [ ] **Step 9: Commit Smart Insights stabilization**

```powershell
git add src/lib/backend/types.ts src/lib/watchlist-client.ts src/lib/watchlist-client.test.ts src/components/WatchlistAddDialog.tsx src/components/SmartInsights.tsx src/components/mvp-stabilization.test.ts
git commit -m "fix: make Smart Insights actions and data truthful"
```

---

### Task 5: Quant Lab simulation truth and responsive containment

**Files:**
- Modify: `src/components/QuantLab.tsx`
- Modify: `src/components/mvp-stabilization.test.ts`

**Interfaces:**
- Consumes: `<DataStatusBadge status="SIMULATED" />`.
- Preserves: POST `/api/quant/runs` as a real record-creation action.
- Changes: all locally generated allocation, prediction, backtest, trade and Monte Carlo output is explicitly simulation-only.

- [ ] **Step 1: Add the failing Quant Lab source contract**

Add to `src/components/mvp-stabilization.test.ts`:

```ts
it("does not present Quant Lab simulations as a live trained engine", () => {
  const quant = source("QuantLab.tsx");
  expect(quant).not.toContain("ENGINE LIVE");
  expect(quant).not.toContain("1.2M backtests");
  expect(quant).not.toContain("directional accuracy");
  expect(quant).not.toContain("trained on OHLCV");
  expect(quant).not.toContain("Converged · 142 iter");
  expect(quant).toContain('status="SIMULATED"');
});
```

Run:

```powershell
npm test -- src/components/mvp-stabilization.test.ts
```

Expected: FAIL on the current live/training/accuracy claims.

- [ ] **Step 2: Add persistent and local simulation disclosure**

In `src/components/QuantLab.tsx`:

- Replace `Quantitative Workbench` with `Quantitative Simulation Workbench`.
- Replace the hero description with `Các kết quả được tạo cục bộ để minh họa; không phải dự báo, backtest hoặc khuyến nghị giao dịch thực.`
- Replace the `ENGINE LIVE` and version/backtest pills with `<DataStatusBadge status="SIMULATED" detail="Allocation, prediction, trades and Monte Carlo are generated locally." />`.
- Add a compact `SIMULATED` badge to the optimizer output header, prediction result header and backtest result header so the disclosure remains adjacent to important outputs.

- [ ] **Step 3: Remove unsupported performance and training claims**

Make these copy/model changes:

- Replace `Converged · 142 iter` with `Kết quả minh họa`.
- Rename model field `accuracy` to `profileLabel` and set every preset to `Kịch bản tổng hợp`; remove numeric accuracy values.
- Replace model descriptions that claim training on OHLCV/on-chain data with descriptions beginning `Synthetic preset…` and describing only the visible scenario behavior.
- Replace the prediction chart subtitle containing `directional accuracy` with `{ranModel.name} · 14-day synthetic scenario`.
- Replace the KPI named `Confidence` with `Scenario` and value `Synthetic`.
- Keep deterministic generators, but label their output as simulation; do not rename them to production terms.

The model type becomes:

```ts
type ModelOption = {
  id: string;
  name: string;
  profileLabel: "Kịch bản tổng hợp";
  desc: string;
  color: string;
  band: number;
  bias: number;
};
```

- [ ] **Step 4: Make quant-run toasts match actual persistence**

Change `queueQuantRun` messages only; preserve the real POST:

```ts
toast.success(`Đã lưu yêu cầu mô phỏng ${strategyName} (${run.status}).`);
```

On failure:

```ts
toast.warning("Kết quả vẫn là mô phỏng cục bộ; không lưu được bản ghi Quant Run.");
```

Do not claim that a worker ran or completed a backtest.

- [ ] **Step 5: Contain Quant Lab grids without hiding page overflow**

- Add `min-w-0` to the page main and all immediate grid children.
- Change every flexible split track touched in `OptimizerTab`, `PredictTab`, `BacktestTab`, `EquityCurve` and `MonteCarlo` from `..._1fr` to `..._minmax(0,1fr)`.
- Add `min-w-0` to Recharts parent sections.
- Keep the top tab row locally scrollable; do not apply page-level overflow hiding.

- [ ] **Step 6: Run focused checks**

Run:

```powershell
npm test -- src/components/mvp-stabilization.test.ts
npx eslint src/components/QuantLab.tsx src/components/mvp-stabilization.test.ts
npx tsc --noEmit
```

Expected: source guard PASS, no ESLint errors and TypeScript exits 0.

- [ ] **Step 7: Commit Quant Lab disclosure and containment**

```powershell
git add src/components/QuantLab.tsx src/components/mvp-stabilization.test.ts
git commit -m "fix: label Quant Lab outputs as simulated"
```

---

### Task 6: Full verification and browser acceptance

**Files:**
- Verify all files changed in Tasks 1–5.
- Do not create release/deploy files.

**Interfaces:**
- Consumes: completed application from Tasks 1–5.
- Produces: test/build/browser evidence and a clean worktree.

- [ ] **Step 1: Run all automated gates with bundled Node 24**

Run:

```powershell
$env:Path = "C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;$env:Path"
node --version
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Expected:

- Node prints v24.x.
- All Vitest files pass.
- TypeScript exits 0.
- ESLint has 0 errors; report any remaining baseline warnings by count.
- Next production build exits 0 and lists `/`, `/portfolio`, `/quant-lab`.

- [ ] **Step 2: Run the source audit**

Run:

```powershell
rg -n 'href="#"|/asset/|ENGINE LIVE|1\.2M backtests|Backtest triggered|AI Briefing refreshing|AI thesis applied|Synthesized from 124 sources|Updated 5m ago' src/components
```

Expected: no matches. If a phrase appears in `mvp-stabilization.test.ts` as a negative assertion, rerun excluding that file:

```powershell
rg -n --glob '!mvp-stabilization.test.ts' 'href="#"|/asset/|ENGINE LIVE|1\.2M backtests|Backtest triggered|AI Briefing refreshing|AI thesis applied|Synthesized from 124 sources|Updated 5m ago' src/components
```

Expected: no matches.

- [ ] **Step 3: Start the local app for browser QA**

In a dedicated terminal from the repository root:

```powershell
$env:Path = "C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;$env:Path"
npm run dev
```

Wait for Next.js to report the local URL. Use the in-app browser against that URL; do not test a stale public deployment.

- [ ] **Step 4: Verify responsive widths on all routes**

For each route `/`, `/portfolio`, `/quant-lab`, test these viewports:

- 375 × 812
- 390 × 844
- 768 × 1024
- 1440 × 900

Evaluate:

```js
({
  route: location.pathname,
  clientWidth: document.documentElement.clientWidth,
  scrollWidth: document.documentElement.scrollWidth,
  overflowFree: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
})
```

Expected: `overflowFree: true` at every route/viewport. Local table/tab strips may scroll inside their own container; the document must not.

- [ ] **Step 5: Verify mobile menu and accessibility behavior**

At 390 × 844:

1. Focus and activate `Mở menu chính` using the keyboard.
2. Confirm the Sheet traps focus and Escape closes it.
3. Reopen and visit each of the three route links.
4. Confirm the selected route exposes `aria-current="page"` and the Sheet closes after selection.
5. Confirm the menu and theme targets are at least 44 × 44 CSS pixels.

- [ ] **Step 6: Verify truthful actions and states**

On `/`:

- Confirm Daily Briefing, AI Digest, Fear & Greed/On-Chain and fallback-backed sections show visible status badges.
- Confirm Listen, Apply to Portfolio and alert edit cannot be activated and explain `Chưa khả dụng trong MVP`.
- Add an existing symbol through Watchlist. Confirm loading, real API success and refreshed rows.
- Submit an unknown symbol. Confirm the dialog stays open and shows the API error; no success toast appears.
- Confirm Expert Signals contains no clickable fake full-story link.

On `/portfolio`:

- Confirm `Mô phỏng` is visible while the real database source/timestamp remains visible.

On `/quant-lab`:

- Confirm `Mô phỏng` remains visible on all three tabs.
- Confirm no live engine, trained-model accuracy or completed-backtest claim is shown.
- Trigger a Quant Run and verify the toast only claims that a simulation record was saved.

- [ ] **Step 7: Verify light/dark mode and console health**

On all three routes:

- Toggle light/dark mode and confirm badges, disabled copy and focus rings remain readable.
- Inspect console after navigation and interactions.

Expected: no uncaught errors, hydration errors or failed navigation. API failures intentionally induced for the unknown watchlist symbol may appear as a handled network response but must not produce an uncaught exception.

- [ ] **Step 8: Check final repository state and report evidence**

Run:

```powershell
git status --short
git log --oneline -6
```

Expected: no uncommitted implementation files. Report commit hashes, test counts, lint warning count, build result, the 12 route/viewport overflow measurements and any intentionally unimplemented backend features. Do not claim push or deployment.
