# Smart Insights Curated Ticker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slow the Smart Insights ticker and restrict both ticker surfaces to the approved fixed universe of 10 Vietnam blue chips, 10 crypto blue chips, and XAU.

**Architecture:** Move the approved universe, URL construction, ordering, and missing-symbol state into the existing ticker presentation module. `TickerTape` and `LegacyMarketPulse` consume the same helper and request only the approved symbols. Missing live rows remain missing; no sample price is created.

**Tech Stack:** TypeScript 5.8, React 19, Next.js 16 App Router, Tailwind CSS 4, Vitest 4.

## Global Constraints

- Vietnam order is exactly `VIC`, `VCB`, `BID`, `CTG`, `TCB`, `VPB`, `FPT`, `HPG`, `VNM`, `GAS`.
- Crypto order is exactly `BTC`, `ETH`, `BNB`, `XRP`, `SOL`, `ADA`, `TRX`, `LINK`, `LTC`, `AVAX`.
- Gold is exactly `XAU`; exclude `GOLD`.
- Describe the list as a fixed blue-chip universe, never a live market-cap ranking.
- Request only approved symbols from `/api/market/ticker`.
- Do not fabricate prices for missing symbols.
- Keep the existing `min-w-0 flex-1 overflow-hidden` viewport, hover pause, and reduced-motion behavior.
- Set marquee duration to exactly 160 seconds and animate only `transform`.
- Preserve unrelated `next-env.d.ts` work.

---

## File structure

- `src/lib/ticker-presentation.ts`: approved universe, query construction, ordering, and truthful snapshot state.
- `src/lib/ticker-presentation.test.ts`: behavioral contract for selection, order, missing rows, and endpoint query.
- `src/components/TickerTape.tsx`: global marquee rendering and animation.
- `src/components/TickerTape.test.ts`: source-level animation and viewport regression.
- `src/components/smart-insights/LegacyMarketPulse.tsx`: curated Trending Assets consumption.
- `src/components/smart-insights/source-guard.test.ts`: preserved Smart Insights source and no-sample-price contract.

### Task 1: Curated ticker presentation contract

**Files:**
- Modify: `src/lib/ticker-presentation.ts`
- Modify: `src/lib/ticker-presentation.test.ts`

**Interfaces:**
- Consumes: `MarketTickerResponse` from `src/lib/backend/types.ts`.
- Produces: `CURATED_TICKER_GROUPS`, `CURATED_TICKER_SYMBOLS`, `curatedTickerUrl()`, and `resolveCuratedTickerSnapshot(rows)`.
- `resolveCuratedTickerSnapshot` returns `TickerSnapshot<MarketTickerResponse> & { missingSymbols: string[] }`.

- [ ] **Step 1: Write failing selection and endpoint tests**

```ts
import {
  CURATED_TICKER_SYMBOLS,
  curatedTickerUrl,
  resolveCuratedTickerSnapshot,
} from "./ticker-presentation";

const row = (symbol: string) => ({
  symbol,
  name: symbol,
  assetClass: symbol === "XAU" ? ("commodity" as const) : ("equity" as const),
  price: 100,
  changePercent: 1,
  volume: 10,
  ts: "2026-08-14T00:00:00.000Z",
});

it("defines the approved fixed universe in display order", () => {
  expect(CURATED_TICKER_SYMBOLS).toEqual([
    "VIC", "VCB", "BID", "CTG", "TCB", "VPB", "FPT", "HPG", "VNM", "GAS",
    "BTC", "ETH", "BNB", "XRP", "SOL", "ADA", "TRX", "LINK", "LTC", "AVAX",
    "XAU",
  ]);
});

it("requests and renders only approved symbols in approved order", () => {
  const snapshot = resolveCuratedTickerSnapshot([
    row("ETH"), row("GOLD"), row("VIC"), row("BTC"), row("TSLA"), row("XAU"),
  ]);
  expect(snapshot.rows.map((item) => item.symbol)).toEqual(["VIC", "BTC", "ETH", "XAU"]);
  expect(snapshot.missingSymbols).toHaveLength(17);
  expect(curatedTickerUrl()).toBe(
    `/api/market/ticker?symbols=${encodeURIComponent(CURATED_TICKER_SYMBOLS.join(","))}`,
  );
});

it("does not fabricate missing approved rows", () => {
  const snapshot = resolveCuratedTickerSnapshot([row("BTC")]);
  expect(snapshot.rows).toEqual([row("BTC")]);
  expect(snapshot.status).toBe("SYSTEM");
  expect(snapshot.detail).toContain("Thiếu 20 mã");
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- src/lib/ticker-presentation.test.ts`

Expected: FAIL because the curated constants and functions are not exported.

- [ ] **Step 3: Implement the minimal presentation helper**

```ts
import type { MarketTickerResponse } from "@/lib/backend/types";

export const CURATED_TICKER_GROUPS = {
  vietnam: ["VIC", "VCB", "BID", "CTG", "TCB", "VPB", "FPT", "HPG", "VNM", "GAS"],
  crypto: ["BTC", "ETH", "BNB", "XRP", "SOL", "ADA", "TRX", "LINK", "LTC", "AVAX"],
  gold: ["XAU"],
} as const;

export const CURATED_TICKER_SYMBOLS = [
  ...CURATED_TICKER_GROUPS.vietnam,
  ...CURATED_TICKER_GROUPS.crypto,
  ...CURATED_TICKER_GROUPS.gold,
] as const;

export function curatedTickerUrl(): string {
  return `/api/market/ticker?symbols=${encodeURIComponent(CURATED_TICKER_SYMBOLS.join(","))}`;
}

export function resolveCuratedTickerSnapshot(rows: MarketTickerResponse[]) {
  const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
  const ordered = CURATED_TICKER_SYMBOLS.flatMap((symbol) => {
    const value = bySymbol.get(symbol);
    return value ? [value] : [];
  });
  const missingSymbols = CURATED_TICKER_SYMBOLS.filter((symbol) => !bySymbol.has(symbol));
  const base = resolveTickerSnapshot(ordered);
  return {
    ...base,
    missingSymbols,
    detail:
      ordered.length && missingSymbols.length
        ? `Được tải từ /api/market/ticker. Thiếu ${missingSymbols.length} mã: ${missingSymbols.join(", ")}.`
        : base.detail,
  };
}
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run: `npm test -- src/lib/ticker-presentation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the presentation contract**

```powershell
git add -- src/lib/ticker-presentation.ts src/lib/ticker-presentation.test.ts
git commit -m "feat: define curated market ticker universe"
```

### Task 2: Slow global ticker marquee

**Files:**
- Modify: `src/components/TickerTape.tsx`
- Create: `src/components/TickerTape.test.ts`

**Interfaces:**
- Consumes: `curatedTickerUrl()` and `resolveCuratedTickerSnapshot(rows)` from Task 1.
- Produces: a 160-second, curated, truthful ticker strip.

- [ ] **Step 1: Write the failing component-source regression**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("TickerTape", () => {
  const source = readFileSync(join(process.cwd(), "src", "components", "TickerTape.tsx"), "utf8");

  it("uses the curated endpoint and slow transform-only marquee", () => {
    expect(source).toContain("curatedTickerUrl()");
    expect(source).toContain("resolveCuratedTickerSnapshot");
    expect(source).toContain("animation: ticker-scroll 160s linear infinite");
    expect(source).toContain("min-w-0 flex-1 overflow-hidden");
    expect(source).toContain("animation-play-state: paused");
    expect(source).toContain("prefers-reduced-motion: reduce");
    expect(source).not.toContain("ticker-scroll 60s");
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- src/components/TickerTape.test.ts`

Expected: FAIL because `TickerTape` still fetches the unfiltered endpoint and uses 60 seconds.

- [ ] **Step 3: Wire the helper and change only the marquee speed**

Replace the unfiltered fetch with `fetch(curatedTickerUrl())`, parse `MarketTickerResponse[]`, and call `resolveCuratedTickerSnapshot(rows)`. Render `row.symbol`, `row.price`, and `row.changePercent` directly. Change only the CSS duration to:

```ts
fetch(curatedTickerUrl())
  .then((response) =>
    response.ok ? response.json() : Promise.reject(new Error("Ticker API không khả dụng.")),
  )
  .then((rows: MarketTickerResponse[]) => {
    if (alive) setSnapshot(resolveCuratedTickerSnapshot(rows));
  });
```

```css
.ticker-track {
  animation: ticker-scroll 160s linear infinite;
}
```

Retain the duplicated strip, hover pause, reduced-motion block, and viewport classes verbatim.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- src/components/TickerTape.test.ts src/lib/ticker-presentation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the marquee**

```powershell
git add -- src/components/TickerTape.tsx src/components/TickerTape.test.ts
git commit -m "feat: slow and curate ticker tape"
```

### Task 3: Curate Smart Insights Trending Assets

**Files:**
- Modify: `src/components/smart-insights/LegacyMarketPulse.tsx`
- Modify: `src/components/smart-insights/source-guard.test.ts`

**Interfaces:**
- Consumes: Task 1 helper and its truthful snapshot detail.
- Produces: Trending Assets with the same approved rows and no `SAMPLE_TICKERS` prices.

- [ ] **Step 1: Write the failing source guard**

Add:

```ts
it("uses the curated ticker universe without sample prices", () => {
  const source = readFileSync(
    join(process.cwd(), "src", "components", "smart-insights", "LegacyMarketPulse.tsx"),
    "utf8",
  );
  expect(source).toContain("curatedTickerUrl()");
  expect(source).toContain("resolveCuratedTickerSnapshot");
  expect(source).not.toContain("SAMPLE_TICKERS");
  expect(source).not.toContain("rows.slice(0, 8)");
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- src/components/smart-insights/source-guard.test.ts`

Expected: FAIL on the old sample constant and eight-row slice.

- [ ] **Step 3: Implement curated Trending Assets**

Initialize the ticker snapshot as unavailable, request `curatedTickerUrl()`, resolve it with `resolveCuratedTickerSnapshot`, and render its ordered rows. If the request fails, render the existing unavailable copy and badge instead of `SAMPLE_TICKERS`. Pass the snapshot detail into `DataStatusBadge`.

```ts
const [tickerSnapshot, setTickerSnapshot] = useState(() =>
  resolveCuratedTickerSnapshot([]),
);

useEffect(() => {
  const controller = new AbortController();
  fetch(curatedTickerUrl(), {
    signal: controller.signal,
    headers: { Accept: "application/json" },
  })
    .then((response) => {
      if (!response.ok) throw new Error("Ticker API unavailable");
      return response.json() as Promise<MarketTickerResponse[]>;
    })
    .then((rows) => {
      if (!controller.signal.aborted)
        setTickerSnapshot(resolveCuratedTickerSnapshot(rows));
    })
    .catch(() => {
      if (!controller.signal.aborted)
        setTickerSnapshot(resolveCuratedTickerSnapshot([]));
    });
  return () => controller.abort();
}, []);
```

- [ ] **Step 4: Run focused and full web tests**

Run: `npm test -- src/components/smart-insights/source-guard.test.ts src/lib/ticker-presentation.test.ts src/components/TickerTape.test.ts`

Run: `npm test`

Expected: focused tests and the full Vitest suite PASS.

- [ ] **Step 5: Commit Trending Assets**

```powershell
git add -- src/components/smart-insights/LegacyMarketPulse.tsx src/components/smart-insights/source-guard.test.ts
git commit -m "feat: curate Smart Insights trending assets"
```

### Task 4: Verify ticker runtime

**Files:**
- Modify only if a verified defect is found in Task 1-3 files.

**Interfaces:**
- Consumes: complete curated ticker implementation.
- Produces: test, build, HTTP, and rendered-browser evidence.

- [ ] **Step 1: Run static gates**

```powershell
npm test
npm run lint
npm run build
```

Expected: tests and build pass; lint has no new errors. Preserve and report any pre-existing warnings separately.

- [ ] **Step 2: Start or reuse the canonical local stack**

Run `npm run dev` from the main checkout. Verify:

```powershell
Invoke-WebRequest http://127.0.0.1:3100 -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:8100/healthz -UseBasicParsing
```

Expected: both return HTTP 200.

- [ ] **Step 3: Verify the API contract**

Request the URL produced by `curatedTickerUrl()` and assert every returned symbol belongs to `CURATED_TICKER_SYMBOLS`; log only symbols and counts.

- [ ] **Step 4: Verify rendered desktop and mobile behavior**

Use the available Browser plugin first. Confirm page identity, nonblank content, no framework overlay, no relevant console errors, ticker width does not expand the viewport, only approved symbols appear, hover pauses the strip, and reduced-motion disables it. Repeat at a mobile-sized viewport and capture screenshots outside the repository.

- [ ] **Step 5: Commit only verified corrections**

If QA required no correction, create no empty commit. If it found a scoped defect, add its failing regression first, apply the minimal fix, rerun Task 4, then commit only those files.
