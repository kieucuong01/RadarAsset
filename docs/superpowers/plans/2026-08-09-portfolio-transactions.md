# Portfolio Transactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Buy and Sell transactions the auditable source of current holdings, weighted-average cost, realized/unrealized PnL, allocation, benchmark performance, and risk metrics.

**Architecture:** Add a pure chronological ledger replay layer under `src/lib/backend/portfolio.ts`, then make the database service rebuild `portfolio_positions` atomically from that ledger after each trade. Build the chart from historical quantities and external-flow-adjusted returns, and keep UI preview math in a small tested helper so the transaction dialog and backend use the same accounting rules.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 7/PostgreSQL, Zod, Vitest, Recharts, existing shadcn/Radix components, Node 24 runtime.

## Global Constraints

- Keep the existing demo user, PostgreSQL portfolio, assets, market bars, and transaction tables.
- Use weighted-average cost accounting; Buy fees enter cost basis and Sell fees reduce realized PnL.
- Do not add cash-balance accounting, deposits, withdrawals, broker connectivity, authentication, or order execution.
- Treat the full transaction ledger as accounting truth and `portfolio_positions` as an atomic rebuildable projection.
- Support valid backdated trades and deterministically order by `executedAt`, `createdAt`, then identifier.
- Add no runtime dependency and no Prisma schema migration.
- Preserve the simulated-data badge and truthful local-data wording.
- Do not stage or modify the pre-existing `next-env.d.ts` worktree change.
- Run project commands with bundled Node 24 from `C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin`.

---

### Task 1: Replay the portfolio ledger and expose complete PnL

**Files:**
- Modify: `src/lib/backend/types.ts`
- Modify: `src/lib/backend/portfolio.ts`
- Modify: `src/lib/backend/portfolio.test.ts`

**Interfaces:**
- Consumes: existing `PortfolioPositionInput`, `PortfolioTransactionInput`, and asset metadata.
- Produces: `PortfolioLedgerAsset`, `PortfolioTransactionResponse`, `PortfolioLedgerReplayResult`, `replayPortfolioLedger()`, and the expanded `PortfolioResponse` totals.

- [ ] **Step 1: Add failing ledger accounting tests**

Add tests that construct chronological events and assert:

```ts
const result = replayPortfolioLedger({ assets, transactions });

expect(result.positions[0]).toMatchObject({
  assetId: "asset-btc",
  quantity: 1.5,
  averageCost: 56673.333333333336,
});
expect(result.transactions.at(-1)).toMatchObject({
  type: "sell",
  releasedCostBasis: 28336.666666666668,
  netAmount: 30990,
  realizedPnL: 2653.333333333332,
  remainingQuantity: 1,
});
expect(result.realizedPnL).toBeCloseTo(2653.3333, 4);
expect(result.cumulativeBuyCapital).toBe(85010);
```

Add separate tests for first Buy with a fee, full Sell position removal, Sell without a position, oversell, same-timestamp deterministic ordering, and a backdated Buy inserted before an existing Sell.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```powershell
npm run test -- src/lib/backend/portfolio.test.ts
```

Expected: FAIL because the ledger types and `replayPortfolioLedger` do not exist.

- [ ] **Step 3: Define ledger and response types**

Add these shapes to `types.ts`:

```ts
export type PortfolioLedgerAsset = {
  assetId: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  latestPrice: number;
};

export type PortfolioLedgerTransaction = PortfolioTransactionInput & {
  id: string;
  createdAt: string;
};

export type PortfolioTransactionResponse = PortfolioLedgerTransaction & {
  grossAmount: number;
  netAmount: number;
  releasedCostBasis: number;
  realizedPnL: number;
  remainingQuantity: number;
};

export type PortfolioLedgerReplayResult = {
  positions: PortfolioPositionInput[];
  transactions: PortfolioTransactionResponse[];
  realizedPnL: number;
  cumulativeBuyCapital: number;
};
```

Expand `PortfolioResponse` with `unrealizedPnL`, `realizedPnL`, and `cumulativeBuyCapital`; change `transactions` to `PortfolioTransactionResponse[]`. Keep `totalPnL` as combined realized plus unrealized PnL.

- [ ] **Step 4: Implement chronological ledger replay**

Implement:

```ts
export class PortfolioDomainError extends Error {
  constructor(
    message: string,
    readonly code: "POSITION_NOT_FOUND" | "INSUFFICIENT_QUANTITY",
  ) {
    super(message);
    this.name = "PortfolioDomainError";
  }
}

export function replayPortfolioLedger(input: {
  assets: PortfolioLedgerAsset[];
  transactions: PortfolioLedgerTransaction[];
}): PortfolioLedgerReplayResult;
```

Sort a copied transaction array; never mutate caller data. For Buy, set `grossAmount = quantity * price`, `netAmount = -(grossAmount + fee)`, and zero realized PnL. For Sell, calculate released cost basis before applying the transaction, set `netAmount = grossAmount - fee`, and realized PnL to net proceeds minus released basis. Use a position map keyed by asset ID and remove zero-quantity results.

- [ ] **Step 5: Make portfolio totals consume replay results**

Change `buildPortfolioResponse` to accept enriched transaction rows, `realizedPnL`, and `cumulativeBuyCapital`. Calculate:

```ts
const unrealizedPnL = totalValue - totalCost;
const totalPnL = unrealizedPnL + input.realizedPnL;
const totalPnLPct =
  input.cumulativeBuyCapital === 0 ? 0 : (totalPnL / input.cumulativeBuyCapital) * 100;
```

Keep holding-level PnL unrealized and allocation based on current market value.

- [ ] **Step 6: Run the focused tests and confirm GREEN**

Run `npm run test -- src/lib/backend/portfolio.test.ts`.

Expected: all portfolio domain tests pass, including the pre-existing risk tests.

- [ ] **Step 7: Commit Task 1**

```powershell
git add src/lib/backend/types.ts src/lib/backend/portfolio.ts src/lib/backend/portfolio.test.ts
git commit -m "feat: derive portfolio accounting from transaction ledger"
```

---

### Task 2: Build trade-aware portfolio and benchmark performance

**Files:**
- Modify: `src/lib/backend/types.ts`
- Modify: `src/lib/backend/portfolio.ts`
- Modify: `src/lib/backend/portfolio.test.ts`
- Modify: `src/lib/backend/db.ts`

**Interfaces:**
- Consumes: `PortfolioLedgerAsset[]`, `PortfolioLedgerTransaction[]`, normalized daily market bars, benchmark asset ID, and timeframe limit.
- Produces: `PortfolioHistoricalBar` and `buildTradeAwarePerformance()` returning `PortfolioPerformancePoint[]` normalized to 100.

- [ ] **Step 1: Add failing flow-adjusted performance tests**

Create a deterministic three-day case with a first-day Buy and second-day Buy. Assert the second Buy does not create a false portfolio jump, fees reduce return, quantities before a trade are not backcast, and SPY is normalized to 100.

```ts
const points = buildTradeAwarePerformance({
  assets,
  transactions,
  bars,
  benchmarkAssetId: "asset-spy",
  limit: 30,
});

expect(points[0]).toEqual({ label: "Jan 1", Portfolio: 100, Benchmark: 100 });
expect(points).toHaveLength(3);
expect(points[1].Portfolio).toBeCloseTo(110, 2);
expect(points[1].Benchmark).toBeCloseTo(101, 2);
```

Add a backdated Sell case and an insufficient-history case.

- [ ] **Step 2: Run focused tests and confirm RED**

Run `npm run test -- src/lib/backend/portfolio.test.ts`.

Expected: FAIL because `buildTradeAwarePerformance` is missing.

- [ ] **Step 3: Implement the normalized historical-bar interface**

Add:

```ts
export type PortfolioHistoricalBar = {
  assetId: string;
  ts: string;
  close: number;
};
```

Implement:

```ts
export function buildTradeAwarePerformance(input: {
  assets: PortfolioLedgerAsset[];
  transactions: PortfolioLedgerTransaction[];
  bars: PortfolioHistoricalBar[];
  benchmarkAssetId: string | null;
  limit: number;
}): PortfolioPerformancePoint[];
```

Process sorted dates, carry forward the latest known close, apply events through each UTC day, calculate end-of-day market value and signed external flow, and chain `(endingValue - flow) / priorValue - 1`. The first valid portfolio day starts at 100. Normalize benchmark closes to 100 over the same output dates.

- [ ] **Step 4: Replace current-quantity backcasting in `db.ts`**

Delete the old private `buildPerformance(positions, bars, ...)`. Normalize Prisma bars to `PortfolioHistoricalBar[]` and call `buildTradeAwarePerformance` with the full ledger, asset metadata, benchmark ID, and `TIMEFRAME_LIMITS[timeframe]`.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run `npm run test -- src/lib/backend/portfolio.test.ts`.

Expected: ledger, performance, allocation, and risk tests pass.

- [ ] **Step 6: Commit Task 2**

```powershell
git add src/lib/backend/types.ts src/lib/backend/portfolio.ts src/lib/backend/portfolio.test.ts src/lib/backend/db.ts
git commit -m "feat: calculate trade-aware portfolio performance"
```

---

### Task 3: Rebuild position projections atomically and return correct API errors

**Files:**
- Modify: `src/lib/backend/db.ts`
- Modify: `src/app/api/portfolio/transactions/route.ts`
- Modify: `src/lib/backend/portfolio.test.ts`

**Interfaces:**
- Consumes: `replayPortfolioLedger()`, Prisma portfolio transactions, assets, and market bars.
- Produces: ledger-derived `loadPortfolioResponse()` and atomic `createPortfolioTransaction()` behavior.

- [ ] **Step 1: Add domain assertions needed by the service**

Extend the portfolio tests to assert that oversell messages include requested and available quantities and that replay returns position projections suitable for Prisma writes:

```ts
expect(() => replayPortfolioLedger(input)).toThrow(
  "Cannot sell 2 BTC; only 1 is available at this transaction time.",
);
```

- [ ] **Step 2: Make GET accounting ledger-derived**

In `loadPortfolioResponse`, load the full transaction ledger with asset metadata, not only 25 rows. Load bars for every ledger asset plus SPY, build ledger assets with latest marks, call `replayPortfolioLedger`, and use its positions/totals/enriched recent transactions in `buildPortfolioResponse`.

Return only the newest 100 enriched transactions for display after all accounting and performance work has used the complete ledger.

- [ ] **Step 3: Make transaction creation atomic**

Inside `prisma.$transaction`:

1. Create the candidate transaction.
2. Load every transaction for the portfolio with asset data in chronological order.
3. Build ledger asset metadata using the latest known bar or latest transaction price.
4. Replay the full ledger; allow `PortfolioDomainError` to abort the database transaction.
5. Delete the old `portfolio_positions` projection for only this portfolio.
6. Recreate the replayed positions with quantity and average cost.

After commit, return `loadPortfolioResponse()`.

- [ ] **Step 4: Return 400, 409, and 503 deliberately**

Refine the Zod schema so `executedAt`, when supplied, must not be later than `Date.now()`. In the route catch block:

```ts
if (error instanceof z.ZodError) return apiError(error, 400);
if (error instanceof PortfolioDomainError) return apiError(error, 409);
return apiError(error, 503);
```

- [ ] **Step 5: Run backend tests and typecheck**

Run:

```powershell
npm run test -- src/lib/backend/portfolio.test.ts
npx tsc --noEmit
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit Task 3**

```powershell
git add src/lib/backend/db.ts src/app/api/portfolio/transactions/route.ts src/lib/backend/portfolio.test.ts
git commit -m "feat: rebuild portfolio positions after each trade"
```

---

### Task 4: Add tested transaction previews and complete the portfolio UI

**Files:**
- Create: `src/lib/portfolio-transaction-preview.ts`
- Create: `src/lib/portfolio-transaction-preview.test.ts`
- Create: `src/components/PortfolioTransactionDialog.tsx`
- Modify: `src/components/MockPortfolio.tsx`

**Interfaces:**
- Consumes: `PortfolioHoldingResponse`, asset API rows, and numeric form fields.
- Produces: `buildTransactionPreview()` and an accessible transaction dialog that returns a refreshed `PortfolioResponse` through `onRecorded`.

- [ ] **Step 1: Add failing preview tests**

Test exact Buy and Sell projections:

```ts
expect(
  buildTransactionPreview({
    side: "buy",
    quantity: 0.5,
    price: 70000,
    fee: 10,
    holding: { qty: 1, cost: 50000 },
  }),
).toMatchObject({
  total: 35010,
  projectedQuantity: 1.5,
  projectedAverageCost: 56673.333333333336,
});
```

For Sell, assert net proceeds, estimated realized PnL, remaining quantity, and invalid oversell output.

- [ ] **Step 2: Run preview tests and confirm RED**

Run `npm run test -- src/lib/portfolio-transaction-preview.test.ts`.

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the pure preview helper**

Implement a discriminated return type:

```ts
type TransactionPreview =
  | { valid: false; error: string }
  | {
      valid: true;
      total: number;
      projectedQuantity: number;
      projectedAverageCost: number;
      realizedPnL: number;
    };
```

Use the exact accounting formulas from the design. Reject non-finite, zero, negative, and oversell quantities locally.

- [ ] **Step 4: Extract the transaction dialog**

Move form state and POST behavior from `MockPortfolio.tsx` into `PortfolioTransactionDialog.tsx`. Fetch `/api/assets` when the dialog first opens. Use the supported-asset list for Buy and current holdings for Sell. Use a native styled `<select>` to avoid adding or changing a UI dependency.

Show inline preview rows for total cost/net proceeds, projected quantity, projected average cost or realized PnL, and remaining quantity. Keep the dialog open on error, prevent double submission, and reset quantity/price/fee only after success.

- [ ] **Step 5: Complete portfolio summary, holdings, and history**

In `MockPortfolio.tsx`:

- Display combined total PnL with separate realized and unrealized values.
- Add Quantity and Average Cost columns to Holdings.
- Keep Allocation and Unrealized PnL labels explicit.
- Add Net Amount and Realized PnL columns to Transaction History.
- Render a dash for Buy realized PnL.
- Pass holdings and refreshed response handling into `PortfolioTransactionDialog`.
- Preserve wide-table horizontal scrolling and minimum 44px mobile controls.

- [ ] **Step 6: Run preview and backend tests**

Run:

```powershell
npm run test -- src/lib/portfolio-transaction-preview.test.ts src/lib/backend/portfolio.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 7: Commit Task 4**

```powershell
git add src/lib/portfolio-transaction-preview.ts src/lib/portfolio-transaction-preview.test.ts src/components/PortfolioTransactionDialog.tsx src/components/MockPortfolio.tsx
git commit -m "feat: complete portfolio trading interface"
```

---

### Task 5: Run full verification and rendered Portfolio QA

**Files:**
- Modify only files required by failures proven during this task.

**Interfaces:**
- Consumes: completed domain, database, API, and UI changes.
- Produces: verified build and browser evidence for Buy/Sell accounting.

- [ ] **Step 1: Run deterministic repository gates**

Run with bundled Node 24:

```powershell
npm run test
npx tsc --noEmit
npm run lint
npm run build
git diff --check
```

Expected: test and typecheck exit 0; lint has zero errors; build exits 0; diff check emits no errors.

- [ ] **Step 2: Start a clean local production server**

Use `next start` on a free local port after the successful build. Do not reuse a stale server process. Confirm the listener before browser navigation.

- [ ] **Step 3: Test the rendered flow with the in-app Browser**

The flow under test is: `/portfolio` loads -> open Add Transaction -> preview a Buy/Sell -> save -> holdings, PnL, allocation, risk metrics, benchmark, and history refresh without runtime errors.

Check desktop 1440px and mobile 390px for:

- Page identity and meaningful content.
- No Next.js error overlay.
- No relevant console error or warning.
- Dialog keyboard/close behavior and inline errors.
- Buy preview and successful refresh.
- Sell preview and successful refresh.
- Oversell rejection.
- No page-level horizontal overflow; only intended table scrolling.
- Simulated-data disclosure remains visible.

- [ ] **Step 4: Preserve database state after QA**

Record the QA trades used. Add compensating manual trades only if they are valid and preserve the intended demo position state; otherwise reseed only with explicit confirmation because `db:reset` is destructive. Report any remaining demo-data change clearly.

- [ ] **Step 5: Commit verification fixes, if any**

Stage only files changed to fix proven verification failures and commit them with a scoped message. If no code changes were needed, do not create an empty commit.

- [ ] **Step 6: Finish the development branch**

Invoke `superpowers:verification-before-completion`, then `superpowers:finishing-a-development-branch`. Merge locally only after all gates pass and preserve the user's existing `next-env.d.ts` change.
