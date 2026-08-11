# Portfolio Backtest Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed FPT/BTC/XAU backtest with a reproducible 1-10 asset portfolio builder where every leg has an independent strategy and allocation derived from equal, custom, or shared optimizer modes.

**Architecture:** Keep QuantRun as the tenant-owned aggregate job and add immutable QuantRunLeg rows for per-asset dataset, strategy, allocation, and parameters. Resolve all assets, datasets, leverage limits, and strategy versions on the server; run each sleeve independently in Python and aggregate normalized portfolio capital. Extract a shared server-side mean-variance optimizer consumed by both Portfolio Optimizer and Backtest.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.8, Zod 4, Prisma 7/PostgreSQL, Vitest 4, Python 3.12, psycopg 3, pytest, Recharts.

## Global Constraints

- Preserve tenant and capability checks on every Quant route.
- New runs contain 1-10 unique normalized symbols; never inject FPT, BTC, or XAU implicitly.
- Allocation is integer basis points and must total exactly `10_000`.
- Every leg has its own strategy code/version, normalized parameters, leverage, active dataset version, and initial notional.
- The server derives Asset, Dataset Version, Strategy Version, market, and leverage truth.
- Supported timeframes remain `1d` and `1h`; execution remains long-only, signal-at-close, next-bar-open.
- Aggregate output is labeled normalized simulation capital, not broker cash or FX settlement.
- Uploaded code, notebooks, dynamic imports, shell fragments, and arbitrary provider URLs remain forbidden.
- Preserve readability of legacy QuantRun rows and artifacts.
- Keep existing unrelated working-tree changes out of every task commit.

---

## File Structure

- `src/lib/backtest/contracts.ts`: canonical portfolio submission schema and normalized DTO.
- `src/lib/backtest/allocation.ts`: deterministic equal/custom basis-point helpers.
- `src/lib/backtest/optimizer.ts`: pure mean-variance and capped-simplex optimizer.
- `src/lib/backtest/asset-client.ts`: browser-safe asset catalog API client.
- `src/lib/backtest/optimizer-client.ts`: browser-safe optimizer API client.
- `src/lib/backend/quant-assets.ts`: Asset/Dataset search and eligibility queries.
- `src/lib/backend/quant-runs.ts`: transactional run/leg creation and response mapping.
- `src/lib/backend/quant-optimizer.ts`: immutable bar loader for optimizer input.
- `src/components/PortfolioBacktestBuilder.tsx`: global builder state and submission.
- `src/components/BacktestLegCard.tsx`: one leg's allocation/strategy/parameter editor.
- `src/components/QuantAssetPickerDialog.tsx`: paginated eligible-asset search.
- `src/components/BacktestResults.tsx`: aggregate and per-leg result rendering.
- `quant-worker/backtest/portfolio.py`: portfolio sleeve aggregation.
- `quant-worker/worker.py`: QuantRunLeg loading, dispatch, and scoped artifact persistence.

---

### Task 1: Portfolio submission and allocation contracts

**Files:**

- Create: `src/lib/backtest/allocation.ts`
- Create: `src/lib/backtest/allocation.test.ts`
- Modify: `src/lib/backtest/contracts.ts`
- Modify: `src/lib/backtest/contracts.test.ts`
- Modify: `src/lib/backtest/hash.ts`

**Interfaces:**

- Produces: `PortfolioBacktestSubmission`, `PortfolioBacktestLeg`, `normalizeBacktestSubmission(input)`, `equalAllocationBps(symbols)`, and `notionalFromBps(totalCapital, allocationBps)`.
- Consumes: `strategyDefinition()` and `normalizeStrategyParameters()` from `strategy-catalog.ts`.

- [ ] **Step 1: Write failing allocation tests**

```ts
import { describe, expect, it } from "vitest";
import { equalAllocationBps, notionalFromBps } from "./allocation";

describe("portfolio allocation", () => {
  it("distributes remainder basis points in stable symbol order", () => {
    expect(equalAllocationBps(["VNM", "BTC", "FPT"])).toEqual({ BTC: 3334, FPT: 3333, VNM: 3333 });
  });

  it("derives sleeve notional without floating allocation drift", () => {
    expect(notionalFromBps(100_000, 3334)).toBe(33_340);
  });
});
```

- [ ] **Step 2: Run the allocation test and verify RED**

Run: `node node_modules/vitest/vitest.mjs run src/lib/backtest/allocation.test.ts`
Expected: FAIL because `./allocation` does not exist.

- [ ] **Step 3: Implement deterministic allocation helpers**

```ts
export const TOTAL_ALLOCATION_BPS = 10_000;

export function equalAllocationBps(symbols: string[]): Record<string, number> {
  const ordered = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()))].sort();
  if (ordered.length < 1 || ordered.length > 10) throw new Error("Expected 1 to 10 assets.");
  const base = Math.floor(TOTAL_ALLOCATION_BPS / ordered.length);
  let remainder = TOTAL_ALLOCATION_BPS - base * ordered.length;
  return Object.fromEntries(ordered.map((symbol) => [symbol, base + (remainder-- > 0 ? 1 : 0)]));
}

export function notionalFromBps(totalCapital: number, allocationBps: number) {
  return (totalCapital * allocationBps) / TOTAL_ALLOCATION_BPS;
}
```

- [ ] **Step 4: Replace the fixed asset enum with the portfolio DTO and failing contract cases**

```ts
const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9._/-]{0,19}$/);

export const portfolioBacktestLegSchema = z
  .object({
    symbol: symbolSchema,
    allocationBps: z.number().int().min(0).max(10_000),
    leverage: z.number().min(1).max(2),
    strategyCode: z.string().min(1),
    strategyVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    strategyParameters: z.record(z.string(), z.unknown()),
  })
  .strict();

export const canonicalBacktestSubmissionSchema = z
  .object({
    timeframe: z.enum(["1d", "1h"]),
    from: isoDateSchema,
    to: isoDateSchema,
    totalCapital: z.number().positive().max(100_000_000_000),
    allocationMode: z.enum(["equal", "custom", "optimized"]),
    feeBps: z.number().min(0).max(100),
    slippageBps: z.number().min(0).max(200),
    legs: z.array(portfolioBacktestLegSchema).min(1).max(10),
  })
  .strict();
```

Add literal tests that reject duplicate symbols, 9,999 basis points, 11 legs, invalid dates, and invalid parameters on only one leg. Normalize each leg independently and sort canonical legs by symbol before hashing.

- [ ] **Step 5: Run tests and commit**

Run: `node node_modules/vitest/vitest.mjs run src/lib/backtest/allocation.test.ts src/lib/backtest/contracts.test.ts`
Expected: PASS.
Commit:

```bash
git add src/lib/backtest/allocation.ts src/lib/backtest/allocation.test.ts src/lib/backtest/contracts.ts src/lib/backtest/contracts.test.ts src/lib/backtest/hash.ts
git commit -m "feat: define portfolio backtest contracts"
```

---

### Task 2: QuantRunLeg and scoped artifact persistence

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608110003_portfolio_backtest_legs/migration.sql`
- Modify: `src/lib/backend/tenant-isolation.integration.test.ts`

**Interfaces:**

- Produces: Prisma `QuantRunLeg`, `QuantRun.legs`, `QuantRunArtifact.scopeKey`, and optional `QuantRunArtifact.quantRunLegId`.
- Consumes: existing `Asset`, `DatasetVersion`, `StrategyVersion`, `QuantRun`, and `QuantRunArtifact` IDs.

- [ ] **Step 1: Add a failing migrated-database integration test**

```ts
it("cascades tenant run legs and preserves referenced immutable versions", async () => {
  const leg = await prisma.quantRunLeg.create({ data: seededLeg });
  await prisma.quantRunArtifact.create({
    data: {
      organizationId: orgA.id,
      quantRunId: runA.id,
      quantRunLegId: leg.id,
      scopeKey: `leg:${leg.id}`,
      kind: "manifest",
      checksum: "a".repeat(64),
      payload: {},
    },
  });
  await prisma.quantRun.delete({ where: { id: runA.id } });
  await expect(prisma.quantRunLeg.findUnique({ where: { id: leg.id } })).resolves.toBeNull();
  await expect(
    prisma.datasetVersion.findUnique({ where: { id: dataset.id } }),
  ).resolves.not.toBeNull();
});
```

- [ ] **Step 2: Run integration test and verify RED**

Run: `npm run test:integration`
Expected: FAIL because Prisma has no `quantRunLeg` model.

- [ ] **Step 3: Add Prisma relations and exact migration**

```prisma
model QuantRunLeg {
  id                String          @id @default(uuid()) @db.Uuid
  quantRunId        String          @map("quant_run_id") @db.Uuid
  assetId           String          @map("asset_id") @db.Uuid
  datasetVersionId  String          @map("dataset_version_id") @db.Uuid
  strategyVersionId String          @map("strategy_version_id") @db.Uuid
  symbolSnapshot    String          @map("symbol_snapshot")
  marketSnapshot    String          @map("market_snapshot")
  currencySnapshot  String          @map("currency_snapshot")
  allocationBps     Int             @map("allocation_bps")
  initialNotional   Decimal         @map("initial_notional") @db.Decimal(24, 8)
  leverage          Decimal         @db.Decimal(5, 2)
  parameters        Json            @default("{}")
  implementationHash String         @map("implementation_hash")
  status            String          @default("queued")
  progress          Int             @default(0)
  metrics           Json?
  errorCode         String?         @map("error_code")
  createdAt         DateTime        @default(now()) @map("created_at")
  quantRun          QuantRun        @relation(fields: [quantRunId], references: [id], onDelete: Cascade)
  asset             Asset           @relation(fields: [assetId], references: [id], onDelete: Restrict)
  datasetVersion    DatasetVersion  @relation(fields: [datasetVersionId], references: [id], onDelete: Restrict)
  strategyVersion   StrategyVersion @relation(fields: [strategyVersionId], references: [id], onDelete: Restrict)
  artifacts         QuantRunArtifact[]

  @@unique([quantRunId, assetId])
  @@index([datasetVersionId])
  @@index([strategyVersionId])
  @@map("quant_run_legs")
}
```

Add `scopeKey String @default("aggregate") @map("scope_key")`, optional `quantRunLegId`, relations, and replace `@@unique([quantRunId, kind])` with `@@unique([quantRunId, scopeKey, kind])`. The SQL migration must backfill existing artifacts with `scope_key = 'aggregate'` before adding `NOT NULL` and the new unique constraint.

- [ ] **Step 4: Generate Prisma and run migration tests**

Run: `npx prisma generate`
Run: `npm run test:integration`
Expected: PASS with the migrated test database only.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/202608110003_portfolio_backtest_legs/migration.sql src/lib/backend/tenant-isolation.integration.test.ts
git commit -m "feat: persist immutable portfolio run legs"
```

---

### Task 3: Supported Quant asset catalog

**Files:**

- Create: `src/lib/backend/quant-assets.ts`
- Create: `src/lib/backend/quant-assets.test.ts`
- Create: `src/app/api/quant/assets/route.ts`
- Modify: `src/app/api/tenant-routes.test.ts`
- Create: `src/lib/backtest/asset-client.ts`
- Create: `src/lib/backtest/asset-client.test.ts`
- Modify: `src/lib/backend/types.ts`

**Interfaces:**

- Produces: `QuantAssetCatalogItem`, `loadQuantAssetCatalog(query)`, `GET /api/quant/assets`, and `getQuantAssets(query, fetcher)`.
- Consumes: Asset/Dataset/DatasetVersion/Provider records and existing `calculateFreshness()`.

- [ ] **Step 1: Write failing backend catalog tests**

```ts
it("returns every matching system asset with timeframe-specific readiness", async () => {
  prisma.asset.findMany.mockResolvedValue([assetWithDailyDataset, assetWithoutHourlyDataset]);
  const result = await loadQuantAssetCatalog({
    q: "VN",
    timeframe: "1h",
    from: "2025-01-01",
    to: "2026-01-01",
  });
  expect(result.items).toEqual([
    expect.objectContaining({ symbol: "VNM", backtestable: true }),
    expect.objectContaining({
      symbol: "VN30",
      backtestable: false,
      reasonCode: "DATASET_UNAVAILABLE",
    }),
  ]);
});
```

- [ ] **Step 2: Run catalog tests and verify RED**

Run: `node node_modules/vitest/vitest.mjs run src/lib/backend/quant-assets.test.ts src/lib/backtest/asset-client.test.ts`
Expected: FAIL because catalog modules do not exist.

- [ ] **Step 3: Implement bounded catalog query and DTO**

```ts
export type QuantAssetCatalogItem = {
  symbol: string;
  name: string;
  market: "vn_equity" | "crypto_spot" | "metal_spot";
  venue: string | null;
  currency: string;
  maxLeverage: number;
  timeframe: "1d" | "1h";
  datasetVersionId: string | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  rowCount: number;
  freshness: MarketDataFreshness;
  backtestable: boolean;
  reasonCode: "DATASET_UNAVAILABLE" | "DATASET_RANGE_INSUFFICIENT" | null;
};
```

`loadQuantAssetCatalog` must normalize `q`, cap it at 40 characters, use `take: 50`, query only `market in [vn_equity, crypto_spot, metal_spot]`, and derive readiness from one active quality-passed raw Dataset Version for the requested timeframe/range.

- [ ] **Step 4: Add tenant route and strict browser client**

```ts
export async function GET(request: Request) {
  const context = await requireTenantContext();
  requireTenantCapability(context, "backtest", "read");
  const query = quantAssetQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return NextResponse.json(await loadQuantAssetCatalog(query));
}
```

The client must validate every returned field with strict Zod objects and throw `Invalid quant asset catalog response.` on malformed payloads.

- [ ] **Step 5: Run tests and commit**

Run: `node node_modules/vitest/vitest.mjs run src/lib/backend/quant-assets.test.ts src/lib/backtest/asset-client.test.ts src/app/api/tenant-routes.test.ts`
Expected: PASS.
Commit the seven files with message `feat: expose supported quant asset catalog`.

---

### Task 4: Transactional portfolio run creation and response mapping

**Files:**

- Create: `src/lib/backend/quant-runs.ts`
- Create: `src/lib/backend/quant-runs.test.ts`
- Modify: `src/lib/backend/db.ts`
- Modify: `src/lib/backend/types.ts`
- Modify: `src/lib/backtest/hash.ts`
- Modify: `src/app/api/quant/runs/route.ts`
- Modify: `src/app/api/quant/runs/[id]/route.ts`
- Modify: `src/app/api/tenant-routes.test.ts`
- Modify: `src/lib/backtest/client.ts`
- Modify: `src/lib/backtest/client.test.ts`

**Interfaces:**

- Produces: `createPortfolioQuantRun(context, submission)`, `hashResolvedPortfolioRun(input, resolvedLegs)`, `listQuantRuns(context)`, `loadQuantRun(context, id)`, and `PortfolioBacktestRun` with `legs` and scoped artifacts.
- Consumes: Task 1 normalized submission, Task 2 Prisma models, and Task 3 Asset eligibility rules.

- [ ] **Step 1: Write failing transactional run tests**

```ts
it("resolves a different strategy and dataset for every leg", async () => {
  await createPortfolioQuantRun(editorContext, twoLegSubmission);
  expect(prisma.$transaction).toHaveBeenCalledOnce();
  expect(prisma.quantRunLeg.createMany).toHaveBeenCalledWith({
    data: [
      expect.objectContaining({ symbolSnapshot: "BTC", allocationBps: 7000 }),
      expect.objectContaining({ symbolSnapshot: "VNM", allocationBps: 3000 }),
    ],
  });
});

it("fails before write when one leg lacks an eligible active dataset", async () => {
  await expect(createPortfolioQuantRun(editorContext, twoLegSubmission)).rejects.toThrow(
    "DATASET_UNAVAILABLE",
  );
  expect(prisma.quantRun.create).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run backend and route tests and verify RED**

Run: `node node_modules/vitest/vitest.mjs run src/lib/backend/quant-runs.test.ts src/app/api/tenant-routes.test.ts`
Expected: FAIL because portfolio run persistence is absent.

- [ ] **Step 3: Implement server-derived leg resolution and one transaction**

```ts
type ResolvedLeg = {
  assetId: string;
  datasetVersionId: string;
  strategyVersionId: string;
  symbol: string;
  market: string;
  currency: string;
  allocationBps: number;
  initialNotional: number;
  leverage: number;
  parameters: Record<string, unknown>;
  implementationHash: string;
};

export async function createPortfolioQuantRun(
  context: TenantContext,
  input: PortfolioBacktestSubmission,
) {
  const legs = await resolvePortfolioLegs(input);
  const portfolioHash = hashResolvedPortfolioRun(input, legs);
  return getPrisma().$transaction(async (tx) => {
    const run = await tx.quantRun.create({ data: aggregateRunData(context, input, portfolioHash) });
    await tx.quantRunLeg.createMany({ data: legs.map((leg) => legCreateData(run.id, leg)) });
    return loadRunWithLegs(tx, context.organizationId, run.id);
  });
}
```

Validate `leg.leverage <= Number(asset.maxLeverage)` and market caps (`vn_equity=2`, spot markets `=1`) after database resolution. Do not accept dataset or strategy IDs from the request.

- [ ] **Step 4: Extend strict response schema and preserve legacy reads**

```ts
const runLegSchema = z
  .object({
    id: z.string(),
    symbol: z.string(),
    market: z.string(),
    currency: z.string(),
    allocationBps: z.number().int(),
    initialNotional: z.number().positive(),
    leverage: z.number(),
    strategyCode: z.string(),
    strategyVersion: z.string(),
    strategyParameters: z.record(z.string(), z.unknown()),
    datasetVersionId: z.string(),
    status: z.string(),
    progress: z.number().int(),
    metrics: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict();
```

Map old rows with `legs: []` and legacy aggregate artifacts with `scopeKey: "aggregate"`. Route errors return 400 for Zod input, 409 for deterministic eligibility conflicts, and 503 only for unexpected infrastructure failures.

`hashResolvedPortfolioRun` hashes sorted leg descriptors containing symbol, Asset ID, Dataset Version ID, dataset checksum, Strategy Version ID, implementation hash, normalized parameters, allocation basis points, and leverage plus the global range/timeframe/fee/slippage/total capital fields. New aggregate runs expose `strategyCode: null` and `strategyVersion: null`; legacy runs preserve their string values.

- [ ] **Step 5: Run tests and commit**

Run: `node node_modules/vitest/vitest.mjs run src/lib/backend/quant-runs.test.ts src/app/api/tenant-routes.test.ts src/lib/backtest/client.test.ts`
Expected: PASS.
Commit the nine files with message `feat: create tenant portfolio backtest runs`.

---

### Task 5: Shared deterministic mean-variance optimizer

**Files:**

- Create: `src/lib/backtest/optimizer.ts`
- Create: `src/lib/backtest/optimizer.test.ts`
- Create: `src/lib/backend/quant-optimizer.ts`
- Create: `src/lib/backend/quant-optimizer.test.ts`
- Create: `src/app/api/quant/allocations/optimize/route.ts`
- Create: `src/lib/backtest/optimizer-client.ts`
- Create: `src/lib/backtest/optimizer-client.test.ts`
- Modify: `src/components/QuantLab.tsx`

**Interfaces:**

- Produces: `optimizeMeanVariance(input)`, `optimizeQuantAllocation(context, input)`, `POST /api/quant/allocations/optimize`, and `requestOptimizedAllocation(input)`.
- Consumes: selected symbols, immutable close series, timeframe/range, total capital, and `riskAversion` in `[1, 10]`.

- [ ] **Step 1: Write failing pure optimizer tests**

```ts
it("returns deterministic long-only capped basis points", () => {
  const result = optimizeMeanVariance({ returnsBySymbol, riskAversion: 4, maxWeightBps: 7000 });
  expect(result.weightsBps).toEqual({ BTC: 3000, FPT: 7000 });
  expect(Object.values(result.weightsBps).reduce((sum, value) => sum + value, 0)).toBe(10_000);
  expect(Object.values(result.weightsBps).every((value) => value >= 0 && value <= 7000)).toBe(true);
});
```

Also test one asset equals 10,000, input-order invariance, insufficient overlap, and singular covariance.

- [ ] **Step 2: Run optimizer tests and verify RED**

Run: `node node_modules/vitest/vitest.mjs run src/lib/backtest/optimizer.test.ts`
Expected: FAIL because optimizer does not exist.

- [ ] **Step 3: Implement projected-gradient optimizer and basis-point repair**

```ts
export function optimizeMeanVariance(input: OptimizerInput): OptimizerResult {
  const symbols = Object.keys(input.returnsBySymbol).sort();
  const mean = vectorMean(symbols, input.returnsBySymbol);
  const covariance = covarianceMatrix(symbols, input.returnsBySymbol);
  let weights = Array(symbols.length).fill(1 / symbols.length);
  for (let iteration = 0; iteration < 500; iteration += 1) {
    const gradient = mean.map((mu, i) => mu - input.riskAversion * dot(covariance[i], weights));
    weights = projectCappedSimplex(
      weights.map((weight, i) => weight + 0.05 * gradient[i]),
      0.7,
    );
  }
  return metricsAndBasisPoints(symbols, weights, mean, covariance);
}
```

`projectCappedSimplex` uses bounded bisection over the Lagrange multiplier, clamps each weight to `[0, cap]`, and repairs rounding remainder in symbol order. Reject fewer than 30 overlapping returns.

- [ ] **Step 4: Add immutable-data loader, route, strict client, and replace simulated optimizer math**

The backend resolves active Dataset Version IDs, reads closes ordered by timestamp, intersects timestamps, computes simple returns, calls the pure optimizer, and returns:

```ts
type OptimizerProposal = {
  weightsBps: Record<string, number>;
  expectedReturnPct: number;
  volatilityPct: number;
  sharpe: number | null;
  observationCount: number;
  datasetVersionIds: Record<string, string>;
  warnings: string[];
};
```

Update `OptimizerTab` to select real asset symbols through Task 3, call this same endpoint, and label results `SYSTEM` only after a successful response. Remove `corrBetween`, pseudo scores, and the fake `queueQuantRun("Mean-Variance Optimizer", ...)` call.

- [ ] **Step 5: Run tests and commit**

Run: `node node_modules/vitest/vitest.mjs run src/lib/backtest/optimizer.test.ts src/lib/backend/quant-optimizer.test.ts src/lib/backtest/optimizer-client.test.ts`
Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: PASS.
Commit the eight files with message `feat: share real portfolio allocation optimizer`.

---

### Task 6: Portfolio backtest builder UI

**Files:**

- Create: `src/components/PortfolioBacktestBuilder.tsx`
- Create: `src/components/BacktestLegCard.tsx`
- Create: `src/components/QuantAssetPickerDialog.tsx`
- Create: `src/lib/backtest/builder-state.ts`
- Create: `src/lib/backtest/builder-state.test.ts`
- Modify: `src/components/BacktestWorkbench.tsx`
- Modify: `src/app/quant-lab/page.tsx`

**Interfaces:**

- Produces: an empty-by-default builder, add/remove leg flow, per-leg strategy form, equal/custom/optimized allocation state, and `PortfolioBacktestSubmission`.
- Consumes: strategy catalog client, Task 3 asset catalog client, Task 5 optimizer client, and Task 4 run client.

- [ ] **Step 1: Write failing builder-state tests**

```ts
it("starts empty and keeps independent strategy state for added assets", () => {
  const initial = createBuilderState({ initialSymbols: [] });
  const withVnm = reduceBuilder(initial, {
    type: "assetAdded",
    asset: vnmAsset,
    strategy: maDefaults,
  });
  const withBtc = reduceBuilder(withVnm, {
    type: "assetAdded",
    asset: btcAsset,
    strategy: turtleDefaults,
  });
  expect(initial.legs).toEqual([]);
  expect(withBtc.legs.map((leg) => [leg.symbol, leg.strategyCode])).toEqual([
    ["VNM", "ma_crossover"],
    ["BTC", "turtle_breakout"],
  ]);
  expect(withBtc.legs.map((leg) => leg.allocationBps)).toEqual([5000, 5000]);
});
```

Add tests for remove, equal remainder, custom invalid total, optimizer apply, URL preselection, and unavailable asset disabled.

- [ ] **Step 2: Run component test and verify RED**

Run: `node node_modules/vitest/vitest.mjs run src/lib/backtest/builder-state.test.ts`
Expected: FAIL because the builder-state module does not exist.

- [ ] **Step 3: Implement builder state reducer**

```ts
type DraftLeg = QuantAssetCatalogItem & {
  allocationBps: number;
  leverage: number;
  strategyCode: string;
  strategyVersion: string;
  strategyParameters: Record<string, number>;
};

type BuilderState = {
  totalCapital: number;
  allocationMode: "equal" | "custom" | "optimized";
  timeframe: "1d" | "1h";
  from: string;
  to: string;
  legs: DraftLeg[];
};

export function reduceBuilder(state: BuilderState, action: BuilderAction): BuilderState {
  if (action.type === "assetAdded") return addDraftLeg(state, action.asset, action.strategy);
  if (action.type === "assetRemoved") return removeDraftLeg(state, action.symbol);
  if (action.type === "allocationEdited")
    return editDraftAllocation(state, action.symbol, action.allocationBps);
  if (action.type === "optimizerApplied") return applyOptimizerProposal(state, action.proposal);
  return state;
}
```

In equal mode, add/remove calls `equalAllocationBps`. In custom mode, add uses zero and remove preserves remaining weights. Manual weight/notional editing sets custom mode. Optimizer results apply only if their symbol set and dataset eligibility still match current state.

- [ ] **Step 4: Implement accessible picker and per-leg cards**

Each card owns a strategy `<select aria-label="Strategy for VNM">`, parameter inputs labeled with symbol, allocation/notional linked inputs, leverage bounded by catalog max, dataset badge, and Remove button. The submit button is disabled with a visible reason list until all legs, allocations, strategies, ranges, and datasets are valid.

Delete the local `ASSETS` constant, `fptLeverage` state, fixed three-leg submission, and fixed `MarketDataHealthPanel` rendering from BacktestWorkbench. Data health now comes from each selected `QuantAssetCatalogItem`; no unselected asset is rendered or submitted.

Read `symbols` with `searchParams` on the server page, normalize at most 10 values, and pass preferences to the client builder; the client still resolves them through `/api/quant/assets`.

- [ ] **Step 5: Run tests, typecheck, and commit**

Run: `node node_modules/vitest/vitest.mjs run src/lib/backtest/builder-state.test.ts src/lib/backtest/client.test.ts`
Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: PASS.
Commit the seven files with message `feat: build configurable portfolio backtest UI`.

---

### Task 7: Per-leg Python execution and aggregate artifacts

**Files:**

- Create: `quant-worker/backtest/portfolio.py`
- Create: `quant-worker/tests/test_portfolio.py`
- Modify: `quant-worker/backtest/engine.py`
- Modify: `quant-worker/worker.py`
- Modify: `quant-worker/tests/test_worker.py`

**Interfaces:**

- Produces: `PortfolioLegInput`, `PortfolioBacktestResult`, `run_portfolio(legs, fee_bps, slippage_bps, portfolio_hash)`, scoped artifacts, and repository leg loading.
- Consumes: QuantRunLeg rows, existing strategy implementations, DatasetInput, checksum verification, and lease ownership.

- [ ] **Step 1: Write failing portfolio engine tests**

```py
def test_portfolio_runs_different_strategies_and_aggregates_sleeves() -> None:
    result = run_portfolio(
        legs=[btc_turtle_leg(allocation_bps=7000), vnm_ma_leg(allocation_bps=3000)],
        fee_bps=Decimal("10"),
        slippage_bps=Decimal("5"),
        portfolio_hash="portfolio-hash",
    )
    assert result.summary["initialEquity"] == 100000.0
    assert {item.symbol for item in result.legs} == {"BTC", "VNM"}
    assert result.equity[-1]["equity"] == pytest.approx(
        sum(item.equity[-1]["equity"] for item in result.legs)
    )
```

Add no-look-ahead timestamp union, allocation sum, strategy mismatch, and one-leg failure tests.

- [ ] **Step 2: Run Python tests and verify RED**

Run: `python -m pytest quant-worker/tests/test_portfolio.py -q`
Expected: FAIL because `backtest.portfolio` does not exist.

- [ ] **Step 3: Implement per-leg sleeve runner and aggregate alignment**

```py
@dataclass(frozen=True)
class PortfolioLegInput:
    id: str
    symbol: str
    market: str
    allocation_bps: int
    initial_notional: Decimal
    leverage: Decimal
    strategy_code: str
    strategy_version: str
    strategy_parameters: dict[str, Any]
    dataset: DatasetInput

def run_portfolio(legs: list[PortfolioLegInput], *, fee_bps: Decimal, slippage_bps: Decimal, portfolio_hash: str) -> PortfolioBacktestResult:
    results = [run_leg(leg, fee_bps=fee_bps, slippage_bps=slippage_bps) for leg in sorted(legs, key=lambda item: item.symbol)]
    equity, drawdown = aggregate_completed_values(results)
    return PortfolioBacktestResult(summary=portfolio_metrics(equity, results), equity=equity, drawdown=drawdown, legs=results)
```

`aggregate_completed_values` uses the union of completed timestamps and carries only each sleeve's latest completed valuation. It never creates price bars.

- [ ] **Step 4: Load QuantRunLeg rows and persist scoped artifacts atomically**

Change `QueuedRun` to contain `legs: tuple[QueuedRunLeg, ...]`. Join each leg to Asset, DatasetVersion, Dataset bars, and StrategyVersion. Dispatch `build_strategy(code, parameters)` per leg. Persist `scopeKey="aggregate"` and `scopeKey=f"leg:{leg.id}"`; update leg status/metrics and aggregate run under the same active lease transaction. Retain the legacy path when no QuantRunLeg rows exist.

- [ ] **Step 5: Run Python suites and commit**

Run: `python -m pytest quant-worker/tests/test_portfolio.py quant-worker/tests/test_worker.py quant-worker/tests/test_engine_golden.py -q`
Expected: PASS.
Commit the five files with message `feat: execute portfolio strategies per asset`.

---

### Task 8: Aggregate and per-leg results with strategy handoff

**Files:**

- Create: `src/components/BacktestResults.tsx`
- Create: `src/lib/backtest/result-model.ts`
- Create: `src/lib/backtest/result-model.test.ts`
- Modify: `src/components/BacktestWorkbench.tsx`
- Modify: `src/lib/backtest/client.ts`
- Modify: `src/lib/backtest/client.test.ts`
- Modify: `src/lib/backend/types.ts`
- Modify: `src/lib/backtest/assignment-contracts.ts`
- Modify: `src/lib/backtest/assignment-contracts.test.ts`
- Modify: `src/lib/backend/db.ts`
- Modify: `src/app/api/portfolio/strategy-assignments/route.ts`
- Modify: `src/app/api/tenant-routes.test.ts`

**Interfaces:**

- Produces: aggregate charts, contribution table, per-leg tabs, scoped artifact parsing, and per-leg `Apply strategy to Mock Portfolio` validated by `backtestRunLegId`.
- Consumes: Task 4 run response and Task 7 scoped artifact schemas.

- [ ] **Step 1: Write failing strict-parser and result-model tests**

```ts
it("builds aggregate and independent leg result views", () => {
  const model = buildBacktestResultModel(successfulTwoLegRun);
  expect(model.aggregate.label).toBe("Normalized portfolio simulation");
  expect(model.legs.map((leg) => leg.label)).toEqual([
    "BTC · Turtle Breakout",
    "VNM · MA Crossover",
  ]);
});
```

The parser test must reject an artifact whose `scopeKey` references another leg or whose trade asset differs from its leg symbol.

- [ ] **Step 2: Run tests and verify RED**

Run: `node node_modules/vitest/vitest.mjs run src/lib/backtest/result-model.test.ts src/lib/backtest/client.test.ts`
Expected: FAIL because scoped result modeling/parsing is absent.

- [ ] **Step 3: Extend strict schemas and artifact selectors**

```ts
export function artifactsForLeg(run: PortfolioBacktestRun, legId: string) {
  const scopeKey = `leg:${legId}`;
  return run.artifacts.filter(
    (artifact) => artifact.scopeKey === scopeKey && artifact.quantRunLegId === legId,
  );
}

export function buildBacktestResultModel(run: PortfolioBacktestRun): BacktestResultModel {
  return {
    aggregate: aggregateResultModel(run),
    legs: [...run.legs]
      .sort((left, right) => left.symbol.localeCompare(right.symbol))
      .map((leg) => legResultModel(run, leg)),
  };
}
```

Add `contribution` and `benchmark` kinds, nullable metric semantics, and schema version checks. Do not cast unchecked JSON.

Replace the trade schema's `z.enum(["FPT", "BTC", "XAU"])` asset field with the normalized symbol schema and cross-check every parsed per-leg trade against that leg's `symbol`.

- [ ] **Step 4: Render results and apply one leg at a time**

Aggregate view shows equity, drawdown, metrics, allocations, and contribution. Each leg tab shows strategy/version/parameters, dataset ID, Buy & Hold comparison, trades, and signals. Apply posts exactly that leg's symbol, strategy code/version, parameters, source run ID, and `backtestRunLegId` to the existing Strategy Assignment endpoint.

Extend the assignment schema with:

```ts
backtestRunId: z.string().uuid().optional(),
backtestRunLegId: z.string().uuid().optional(),
```

Both IDs must be present together or both absent. When present, `upsertStrategyAssignment` loads a succeeded tenant-owned QuantRunLeg whose run ID, Asset symbol, Strategy Version, and normalized parameters exactly match the request, and reads only artifacts with `scopeKey = leg:<id>`. A leg from another run, asset, or tenant is rejected before assignment or signal writes. Replace the fixed FPT/BTC/XAU assignment symbol enum with the same normalized symbol grammar used by the portfolio contract; Asset support remains server-derived.

- [ ] **Step 5: Run tests and commit**

Run: `node node_modules/vitest/vitest.mjs run src/lib/backtest/result-model.test.ts src/lib/backtest/client.test.ts src/lib/backtest/assignment-contracts.test.ts`
Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: PASS.
Commit the twelve files with message `feat: show portfolio and per-asset backtest results`.

---

### Task 9: Core verification and browser QA

**Files:**

- No planned source changes; any failure reopens its owning task with a regression test.

**Interfaces:**

- Consumes: all prior tasks.
- Produces: evidence that migrations, contracts, worker, optimizer, builder, and results operate together.

- [ ] **Step 1: Run focused TypeScript and Python tests**

```powershell
node node_modules/vitest/vitest.mjs run --exclude '.worktrees/**'
python -m pytest quant-worker/tests -q
node node_modules/typescript/bin/tsc --noEmit
```

Expected: all commands exit 0. Any skipped integration test is reported as unverified rather than passed.

- [ ] **Step 2: Run migrated-database integration tests safely**

```powershell
npm run test:integration
```

Expected: run only against normalized `TEST_DATABASE_URL`; migrations apply, tenant tests pass, and the wrapper rejects a development database identity.

- [ ] **Step 3: Run production build**

```powershell
node node_modules/next/dist/bin/next build --webpack
```

Expected: exit 0 with no route/type/build error.

- [ ] **Step 4: Browser-test the target flow on port 3100**

Flow: `/quant-lab` -> Backtest -> empty builder -> add VNM and BTC -> assign MA and Turtle independently -> equal allocation -> custom invalid/valid allocation -> optimizer proposal -> submit -> worker completion -> aggregate result -> per-leg result -> Apply one strategy.

Verify desktop and 390px mobile, no fixed defaults, no page-level overflow, no framework overlay, and no relevant console error. Capture one builder and one successful results screenshot outside the repository.

- [ ] **Step 5: Confirm the verified tree is reviewable**

```bash
git status --short
git diff --check
```

Expected: only explicitly preserved pre-existing changes remain and `git diff --check` reports no whitespace error. If a gate failed, return to the task that owns the behavior, add a failing regression test, implement the fix there, rerun that task's full gate, and create its named commit before repeating Task 9.
