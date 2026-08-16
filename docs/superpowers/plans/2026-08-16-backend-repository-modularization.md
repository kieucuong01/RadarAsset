# Backend Repository Modularization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 1,800-line `src/lib/backend/db.ts` catch-all with focused market, portfolio, research, and strategy-forward repositories while preserving every API response, tenant predicate, and financial calculation.

**Architecture:** Move existing Prisma queries without rewriting them, one business domain at a time. API routes import their owning repository directly; a temporary `db.ts` facade may re-export moved functions until the final task removes it. Existing `quant-runs.ts` remains the canonical Quant run repository, so the obsolete duplicate Quant implementation in `db.ts` is deleted rather than renamed.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma/PostgreSQL, Vitest, existing tenant integration tests.

## Global Constraints

- Preserve all public function signatures, API payloads, HTTP errors, tenant predicates, and transaction boundaries.
- Do not modify Prisma schema, migrations, financial calculations, market-data eligibility, strategy behavior, or UI.
- Do not add dependencies or introduce repository classes/factories.
- Move code first; simplify only after parity tests pass in a later task.
- Keep `getPrisma()` acquisition inside each owning repository.
- A route must import its owning repository directly before `db.ts` can be deleted.
- Every task ends with lint, formatting, TypeScript, targeted Vitest, and a scoped commit.

---

## File map

**Create:**

- `src/lib/backend/db-mappers.ts`: pure storage-to-domain scalar and JSON conversion helpers used by at least two repositories.
- `src/lib/backend/db-mappers.test.ts`: deterministic mapper characterization.
- `src/lib/backend/market-repository.ts`: assets, ticker, bars, active dataset-bar access, and market-data health.
- `src/lib/backend/portfolio-repository.ts`: portfolio snapshot, performance, transaction creation, and timeframe normalization.
- `src/lib/backend/research-repository.ts`: public insights/events/intelligence, tenant watchlists, and imported research runs.
- `src/lib/backend/strategy-forward-repository.ts`: strategy assignments and signal lifecycle persistence.
- `src/lib/backend/repository-boundaries.test.ts`: source guard preventing routes from returning to the catch-all module.

**Modify:**

- `src/lib/backend/db.ts`: temporary facade, then delete.
- `src/lib/backend/tenant-scoping.test.ts`: import each subject from its owner.
- `src/lib/backend/tenant-isolation.integration.test.ts`: import each subject from its owner.
- `src/lib/backend/market-data-health.test.ts`: import the market repository.
- `src/app/api/tenant-routes.test.ts`: mock the owning repository modules.
- Market, asset, portfolio, watchlist, research, and strategy-assignment API routes: import their owner directly.
- `src/app/api/portfolio/transactions/route.test.ts`: mock the portfolio repository.

**Delete:**

- `src/lib/backend/db.ts` after all production and test consumers are migrated.

## Stable interfaces

```ts
// db-mappers.ts
export function numberFromDecimal(value: unknown): number;
export function objectJson(value: unknown): Record<string, unknown>;
export function stringArrayJson(value: unknown): string[];

// market-repository.ts
export async function loadAssets(): Promise<unknown>;
export async function loadTickerResponse(symbols?: string[]): Promise<MarketTickerResponse[]>;
export async function loadMarketBars(symbol: string, timeframe?: string): Promise<unknown>;
export async function loadMarketDataHealth(now?: Date): Promise<MarketDataHealthItem[]>;

// portfolio-repository.ts
export async function loadPortfolioResponse(
  context: TenantContext,
  timeframe?: PortfolioTimeframe,
): Promise<PortfolioResponse>;
export async function createPortfolioTransaction(
  context: TenantContext,
  input: PortfolioTransactionCreateInput,
): Promise<PortfolioResponse>;
export async function loadPortfolioPerformance(
  context: TenantContext,
  timeframe?: PortfolioTimeframe,
): Promise<ReturnType<typeof buildTradeAwarePerformance>>;
export function normalizePortfolioTimeframe(value: string | null): PortfolioTimeframe;

// research-repository.ts and strategy-forward-repository.ts retain the exact exported
// signatures currently declared in db.ts.
```

---

### Task 1: Establish mapper and route-boundary guards

**Files:**

- Create: `src/lib/backend/db-mappers.ts`
- Create: `src/lib/backend/db-mappers.test.ts`
- Create: `src/lib/backend/repository-boundaries.test.ts`
- Modify: `src/lib/backend/db.ts`

**Interfaces:**

- Consumes: existing pure helpers in `db.ts`.
- Produces: `numberFromDecimal`, `objectJson`, and `stringArrayJson` for Tasks 2-5; a source guard listing each API route that must no longer import `@/lib/backend/db`.

- [ ] **Step 1: Write mapper characterization tests**

Create tests that assert Decimal-like objects, strings, numbers, invalid objects, JSON records, and mixed arrays preserve current behavior:

```ts
expect(numberFromDecimal({ toString: () => "12.5" })).toBe(12.5);
expect(numberFromDecimal(null)).toBe(0);
expect(objectJson({ nested: true })).toEqual({ nested: true });
expect(objectJson([])).toEqual({});
expect(stringArrayJson(["a", 1, "b"])).toEqual(["a", "b"]);
```

- [ ] **Step 2: Write the failing boundary test**

Create `repository-boundaries.test.ts` with a table of API route paths and their expected owner. Initially assert only that each route is readable and record current catch-all imports; add the first enforceable assertion for market routes:

```ts
for (const route of marketRoutes) {
  expect(readFileSync(route, "utf8")).not.toContain('from "@/lib/backend/db"');
}
```

Run:

```powershell
npx vitest run src/lib/backend/repository-boundaries.test.ts
```

Expected: FAIL because market routes still import `db.ts`.

- [ ] **Step 3: Extract the pure helpers**

Move the three functions unchanged to `db-mappers.ts`, export them, and import them back into `db.ts`. Do not move domain validators.

- [ ] **Step 4: Verify helper parity**

Run:

```powershell
npx vitest run src/lib/backend/db-mappers.test.ts src/lib/backend/tenant-scoping.test.ts
npm run typecheck
```

Expected: mapper and tenant tests pass; the boundary test remains intentionally red until Task 2.

- [ ] **Step 5: Commit**

```powershell
git add -- src/lib/backend/db-mappers.ts src/lib/backend/db-mappers.test.ts src/lib/backend/repository-boundaries.test.ts src/lib/backend/db.ts
git commit -m "refactor: extract shared database mappers"
```

---

### Task 2: Extract the market repository

**Files:**

- Create: `src/lib/backend/market-repository.ts`
- Modify: `src/lib/backend/db.ts`
- Modify: `src/lib/backend/market-data-health.test.ts`
- Modify: `src/lib/backend/repository-boundaries.test.ts`
- Modify: `src/app/api/assets/route.ts`
- Modify: `src/app/api/market/ticker/route.ts`
- Modify: `src/app/api/market/bars/route.ts`
- Modify: `src/app/api/market/data-health/route.ts`

**Interfaces:**

- Consumes: shared scalar mappers and existing `buildTickerResponse`/`calculateFreshness` functions.
- Produces: the four public market functions plus an internal active-dataset query used by the portfolio repository.

- [ ] **Step 1: Move market constants, validators, dataset-bar helpers, and four public functions unchanged**

Move `MARKET_DATA_SYMBOLS`, `MARKET_DATA_TIMEFRAMES`, dataset eligibility constants, public error codes, `assertMarketDataMarket`, ingestion-status/error helpers, `ActiveDatasetBarRow`, `loadActiveDatasetBars`, `preferActiveDatasetBars`, `latestBarsByAssetId`, `loadAssets`, `loadTickerResponse`, `loadMarketBars`, and `loadMarketDataHealth` into `market-repository.ts`.

Export the dataset helper only under this explicit repository contract:

```ts
export async function loadActiveMarketBarsForAssets(
  prisma: ReturnType<typeof getPrisma>,
  input: {
    timeframe: string;
    assetIds?: string[];
    symbols?: string[];
    barLimit?: number;
  },
): Promise<ActiveDatasetBarRow[]>;
```

- [ ] **Step 2: Keep temporary compatibility exports**

Replace the moved implementations in `db.ts` with:

```ts
export {
  loadAssets,
  loadMarketBars,
  loadMarketDataHealth,
  loadTickerResponse,
} from "./market-repository";
```

- [ ] **Step 3: Point production routes and health tests to the owner**

Replace only the import source:

```ts
import { loadMarketDataHealth } from "@/lib/backend/market-repository";
```

Use the corresponding market export in the other three routes. Update `market-data-health.test.ts` to import `./market-repository`.

- [ ] **Step 4: Make the market boundary test green**

Run:

```powershell
npx vitest run src/lib/backend/repository-boundaries.test.ts src/lib/backend/market-data-health.test.ts src/lib/backend/market.test.ts
npm run typecheck
npm run lint
```

Expected: all pass and no market/asset route imports `db.ts`.

- [ ] **Step 5: Commit**

```powershell
git add -- src/lib/backend/market-repository.ts src/lib/backend/db.ts src/lib/backend/market-data-health.test.ts src/lib/backend/repository-boundaries.test.ts src/app/api/assets src/app/api/market
git commit -m "refactor: extract market repository"
```

---

### Task 3: Extract the portfolio repository

**Files:**

- Create: `src/lib/backend/portfolio-repository.ts`
- Modify: `src/lib/backend/db.ts`
- Modify: `src/lib/backend/tenant-scoping.test.ts`
- Modify: `src/lib/backend/tenant-isolation.integration.test.ts`
- Modify: `src/lib/backend/repository-boundaries.test.ts`
- Modify: `src/app/api/portfolio/route.ts`
- Modify: `src/app/api/portfolio/performance/route.ts`
- Modify: `src/app/api/portfolio/transactions/route.ts`
- Modify: `src/app/api/portfolio/transactions/route.test.ts`
- Modify: `src/app/api/tenant-routes.test.ts`

**Interfaces:**

- Consumes: `loadActiveMarketBarsForAssets`, shared mappers, and existing pure portfolio calculations.
- Produces: portfolio load/performance/transaction/timeframe functions with unchanged signatures.

- [ ] **Step 1: Extend the boundary test for portfolio routes**

Add portfolio, performance, and transaction routes to the no-`db.ts` table and run the guard.

Expected: FAIL on all three routes.

- [ ] **Step 2: Move portfolio implementation unchanged**

Move `TIMEFRAME_LIMITS`, portfolio validators, `loadPortfolioResponse`, `validateSourceSignalExecution`, `createPortfolioTransaction`, `loadPortfolioPerformance`, and `normalizePortfolioTimeframe` to `portfolio-repository.ts`. Replace calls to the old dataset helper with `loadActiveMarketBarsForAssets`.

- [ ] **Step 3: Re-export temporarily and migrate consumers**

Re-export the four public functions from `db.ts`. Update the three routes and the transaction route test mock to `portfolio-repository`. Split the portfolio imports in tenant tests away from `./db`.

- [ ] **Step 4: Verify portfolio behavior and isolation**

Run:

```powershell
npx vitest run src/lib/backend/portfolio.test.ts src/lib/backend/tenant-scoping.test.ts src/app/api/portfolio/transactions/route.test.ts src/app/api/tenant-routes.test.ts src/lib/backend/repository-boundaries.test.ts
npm run typecheck
```

If `TEST_DATABASE_URL` is configured, also run:

```powershell
npm run test:integration -- src/lib/backend/tenant-isolation.integration.test.ts
```

Expected: public fixtures, tenant predicates, transaction linking, and source-signal behavior remain unchanged.

- [ ] **Step 5: Commit**

```powershell
git add -- src/lib/backend/portfolio-repository.ts src/lib/backend/db.ts src/lib/backend/tenant-scoping.test.ts src/lib/backend/tenant-isolation.integration.test.ts src/lib/backend/repository-boundaries.test.ts src/app/api/portfolio src/app/api/tenant-routes.test.ts
git commit -m "refactor: extract portfolio repository"
```

---

### Task 4: Extract the research and watchlist repository

**Files:**

- Create: `src/lib/backend/research-repository.ts`
- Modify: `src/lib/backend/db.ts`
- Modify: `src/lib/backend/tenant-scoping.test.ts`
- Modify: `src/lib/backend/tenant-isolation.integration.test.ts`
- Modify: `src/lib/backend/repository-boundaries.test.ts`
- Modify: asset-intelligence, insights, events, watchlist, and research-run API routes
- Modify: `src/app/api/tenant-routes.test.ts`

**Interfaces:**

- Consumes: shared mappers, `buildAssetIntelligence`, `resolveProviderInstrument`, and `requestMarketIngestion`.
- Produces: `loadInsights`, `loadAssetIntelligence`, `loadEvents`, watchlist CRUD, and research import/list functions with unchanged signatures.

- [ ] **Step 1: Extend the boundary test**

Add these route groups to the no-`db.ts` assertion: `/api/insights`, `/api/events`, `/api/assets/[symbol]/intelligence`, `/api/watchlist`, `/api/watchlist/[id]`, `/api/research/runs`, and `/api/research/runs/import`.

Expected: FAIL before migration.

- [ ] **Step 2: Move research/watchlist functions and their private mappers unchanged**

Move sentiment/thesis validators, relative-date labels, public intelligence queries, tenant watchlist queries/mutations, research import/list queries, and research response mappers into `research-repository.ts`. Keep the global-plus-current-tenant insight predicate exactly as implemented.

- [ ] **Step 3: Re-export temporarily and migrate consumers/mocks**

Re-export the public functions from `db.ts`, point all listed routes at `research-repository`, and split tenant test imports/mocks by owner.

- [ ] **Step 4: Verify tenant and response parity**

Run:

```powershell
npx vitest run src/lib/backend/investor-intelligence.test.ts src/lib/backend/tenant-scoping.test.ts src/app/api/tenant-routes.test.ts src/lib/backend/repository-boundaries.test.ts
npm run typecheck
```

Run tenant integration when the test database is available.

- [ ] **Step 5: Commit**

```powershell
git add -- src/lib/backend/research-repository.ts src/lib/backend/db.ts src/lib/backend/tenant-scoping.test.ts src/lib/backend/tenant-isolation.integration.test.ts src/lib/backend/repository-boundaries.test.ts src/app/api/assets src/app/api/insights src/app/api/events src/app/api/watchlist src/app/api/research src/app/api/tenant-routes.test.ts
git commit -m "refactor: extract research repository"
```

---

### Task 5: Extract strategy-forward persistence

**Files:**

- Create: `src/lib/backend/strategy-forward-repository.ts`
- Modify: `src/lib/backend/db.ts`
- Modify: `src/lib/backend/tenant-scoping.test.ts`
- Modify: `src/lib/backend/repository-boundaries.test.ts`
- Modify: strategy-assignment and signal-status API routes
- Modify: `src/app/api/tenant-routes.test.ts`

**Interfaces:**

- Consumes: `normalizeStrategyAssignment`, shared mappers, and existing Prisma transaction logic.
- Produces: assignment upsert/list and signal-status functions with unchanged tenant and status validation.

- [ ] **Step 1: Add the strategy routes to the failing boundary test**

Assert both assignment routes contain no `@/lib/backend/db` import.

- [ ] **Step 2: Move the complete strategy block unchanged**

Move signal validators/mappers, artifact signal parsing, `upsertStrategyAssignment`, `listStrategyAssignments`, and `updateStrategySignalStatus` to `strategy-forward-repository.ts`.

- [ ] **Step 3: Re-export temporarily and migrate routes/tests**

Point production routes and tenant test mocks at the new repository. Preserve the existing `strategy-forward-tests.ts` service; do not merge service orchestration into persistence.

- [ ] **Step 4: Verify signal lifecycle and tenant scope**

Run:

```powershell
npx vitest run src/lib/backend/strategy-forward-tests.test.ts src/lib/backend/tenant-scoping.test.ts src/app/api/tenant-routes.test.ts src/lib/backend/repository-boundaries.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```powershell
git add -- src/lib/backend/strategy-forward-repository.ts src/lib/backend/db.ts src/lib/backend/tenant-scoping.test.ts src/lib/backend/repository-boundaries.test.ts src/app/api/portfolio/strategy-assignments src/app/api/tenant-routes.test.ts
git commit -m "refactor: extract strategy forward repository"
```

---

### Task 6: Remove obsolete duplicate Quant persistence and the facade

**Files:**

- Delete: `src/lib/backend/db.ts`
- Modify: `src/lib/backend/tenant-scoping.test.ts`
- Modify: `src/lib/backend/tenant-isolation.integration.test.ts`
- Modify: `src/app/api/tenant-routes.test.ts`
- Modify: `src/lib/backend/repository-boundaries.test.ts`

**Interfaces:**

- Consumes: existing canonical `createPortfolioQuantRun`, `listPortfolioQuantRuns`, and `loadPortfolioQuantRun` from `quant-runs.ts`.
- Produces: no facade; every backend query has one owning module.

- [ ] **Step 1: Prove legacy Quant exports have no production consumer**

Run:

```powershell
rg -n "createQuantRun|listQuantRuns|getQuantRun" src --glob "!src/lib/backend/db.ts" --glob "!**/*.test.*"
```

Expected: no production hit. Quant API routes must already use `quant-runs.ts`.

- [ ] **Step 2: Migrate legacy tenant tests to canonical Quant functions**

Replace legacy test imports/calls with:

```ts
import {
  createPortfolioQuantRun,
  listPortfolioQuantRuns,
  loadPortfolioQuantRun,
} from "./quant-runs";
```

Adjust only input names required by the canonical portfolio submission contract; retain the same organization A/B isolation assertions.

- [ ] **Step 3: Remove the facade and make the guard global**

Delete `db.ts`. Update `repository-boundaries.test.ts` to scan every `src/app/api/**/route.ts` and fail on `@/lib/backend/db`. Assert the file itself is absent:

```ts
expect(existsSync(path.join(repoRoot, "src/lib/backend/db.ts"))).toBe(false);
```

- [ ] **Step 4: Verify all direct and dynamic references are gone**

Run:

```powershell
rg -n "backend/db|from \"\./db\"" src
npx vitest run src/lib/backend src/app/api/tenant-routes.test.ts src/app/api/portfolio/transactions/route.test.ts
npm run lint
npm run format:check
npm run typecheck
```

Expected: source search has no imports; all commands pass.

- [ ] **Step 5: Commit**

```powershell
git add --all src/lib/backend src/app/api
git diff --cached --check
git commit -m "refactor: remove backend database facade"
```

---

### Task 7: Full backend regression gate and architecture note

**Files:**

- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-16-codebase-simplification-design.md`

**Interfaces:**

- Consumes: all repository modules from Tasks 1-6.
- Produces: documented backend ownership and a green repository-root gate.

- [ ] **Step 1: Document repository ownership**

Add a short README architecture paragraph naming market, portfolio, research, strategy-forward, and Quant run owners. Mark Phase 2 backend boundary complete in the design document; do not document the Python worker split as complete.

- [ ] **Step 2: Run the final non-database gate**

```powershell
npm run check
$env:BETTER_AUTH_URL='http://localhost:3100'
$env:BETTER_AUTH_SECRET='build-verification-only-secret-32-characters'
$env:DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/quant_insight_radar'
npm run build
```

Expected: lint, formatting, TypeScript, Vitest, Python tests, and production build all exit 0.

- [ ] **Step 3: Run database isolation when configured**

```powershell
if ($env:TEST_DATABASE_URL) { npm run test:integration }
```

Expected: integration tests pass when a dedicated `_test` database is configured; otherwise record that the database gate was not executed rather than claiming it passed.

- [ ] **Step 4: Review size and ownership**

```powershell
rg -n "backend/db|from \"\./db\"" src
Get-ChildItem src/lib/backend/*-repository.ts | ForEach-Object {
  "{0}: {1}" -f $_.Name, (Get-Content $_ | Measure-Object -Line).Lines
}
git diff --check
git status --short --branch
```

Expected: no catch-all import, no dirty generated artifact, and each repository has one named business responsibility.

- [ ] **Step 5: Commit**

```powershell
git add -- README.md docs/superpowers/specs/2026-08-16-codebase-simplification-design.md
git commit -m "docs: document backend repository ownership"
```

After this checkpoint, create and execute a separate Python worker modularization plan. Do not combine the worker split with this backend refactor.
