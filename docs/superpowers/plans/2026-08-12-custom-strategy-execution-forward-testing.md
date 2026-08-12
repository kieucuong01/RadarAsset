# Custom Strategy Execution and Forward Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tenant-owned Price Threshold and monthly DCA strategies executable in Portfolio Backtest, assignable to Mock Portfolio, forward-tested after activation, and able to create deduplicated in-app BUY/SELL notifications that open a reviewable transaction.

**Architecture:** Extend the existing immutable `StrategyVersion` registry instead of creating a parallel execution catalog. PostgreSQL owns custom strategy definitions, versions, assignments, evaluation jobs, snapshots, signals, notifications, and signal-linked transactions; the Python worker executes frozen normalized rules for both historical and incremental runs. Strategy Lab and Mock Portfolio consume tenant-scoped APIs, while local browser drafts are offered for one-time explicit import.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.8, Zod 4, Prisma 7, PostgreSQL, Python 3.12-compatible code, psycopg 3, pytest, Vitest, Recharts, shadcn/Radix UI, Tailwind CSS 4.

## Global Constraints

- Node.js must remain `>=20.9.0` as declared in `package.json`.
- Do not add a runtime dependency; use existing Zod, Prisma, psycopg, React, and standard-library functionality.
- Custom versions are immutable after creation; edits always create a new version.
- DCA contributions are new external capital and must never be counted as profit.
- Price signals are detected at close of bar `t` and filled at open of bar `t + 1`.
- Price rules are long-only; no signal may open a short position.
- Price-rule currency must equal the assigned asset's native currency in this MVP.
- Fundamental strategies remain unavailable until point-in-time financial-statement ingestion exists.
- Applying a strategy never changes Mock Portfolio holdings automatically.
- An initial forward snapshot creates no notification.
- Every actionable signal creates at most one notification per portfolio owner, including after retries.
- Every tenant-owned read and mutation must be scoped by `organizationId`; cross-tenant identifiers return not found.
- Worker errors exposed to clients use bounded error codes and never include SQL, file paths, provider payloads, or stack traces.
- Existing built-in strategy behavior and implementation hashes must remain reproducible.

---

## File Structure

### Persistence and server domain

- `prisma/schema.prisma`: relations and Prisma models for custom strategies, forward evaluation, notifications, and signal-linked transactions.
- `prisma/migrations/202608120001_custom_strategy_execution/migration.sql`: database tables, foreign keys, partial uniqueness, and idempotency indexes.
- `src/lib/custom-strategies/contracts.ts`: strict normalized rule definitions and public API schemas.
- `src/lib/custom-strategies/hash.ts`: stable canonical JSON and SHA-256 implementation hash.
- `src/lib/backend/custom-strategies.ts`: tenant-scoped CRUD and immutable version creation.
- `src/lib/backend/strategy-forward-tests.ts`: tenant-scoped assignment, snapshot, signal, and notification reads/writes.

### Backtest execution

- `src/lib/backend/quant-runs.ts`: tenant-aware strategy resolution and frozen rule payloads.
- `src/lib/backtest/contracts.ts`: dynamic custom strategy leg contract while preserving built-in validation.
- `src/lib/backtest/client.ts`: built-in/custom catalog and execution-fill artifact parsing.
- `quant-worker/backtest/custom_rules.py`: allow-listed Price Threshold and DCA rule parsing.
- `quant-worker/backtest/custom_execution.py`: causal partial-fill and external-contribution simulation.
- `quant-worker/backtest/performance.py`: TWR, money-weighted return, and contribution-neutral profit calculations.
- `quant-worker/worker.py`: dispatch frozen custom rules and persist custom artifacts.

### Forward testing and UI

- `quant-worker/backtest/signal_jobs.py`: enqueue and claim dataset-version evaluation jobs.
- `quant-worker/backtest/forward_evaluator.py`: initial snapshots and incremental custom-rule evaluation.
- `quant-worker/backtest/publication.py`: enqueue jobs after an immutable dataset version becomes active.
- `src/lib/custom-strategies/client.ts`: Strategy Lab CRUD/import client.
- `src/lib/strategy-forward/client.ts`: assignment, snapshot, signal, notification, and mark-read client.
- `src/components/StrategyLab.tsx`: API-backed My Strategies and explicit local-draft import.
- `src/components/PortfolioStrategyForwardTests.tsx`: forward performance, latest status, and notification review surface.
- `src/components/NotificationCenter.tsx`: global in-app notification bell, unread badge, and bounded list.
- `src/components/PortfolioTransactionDialog.tsx`: signal-prefilled transaction confirmation.

---

### Task 1: Add tenant-owned immutable strategy and forward-test persistence

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608120001_custom_strategy_execution/migration.sql`
- Modify: `src/lib/backend/tenant-isolation.integration.test.ts`

**Interfaces:**

- Consumes: existing `AppUser`, `Organization`, `Portfolio`, `Asset`, `DatasetVersion`, `StrategyVersion`, `StrategyAssignment`, `StrategySignal`, and `PortfolioTransaction`.
- Produces: Prisma models `CustomStrategy`, `CustomStrategyVersion`, `StrategyEvaluationJob`, `StrategyForwardSnapshot`, and `Notification`; adds immutable ownership and idempotency fields to existing strategy models.

- [ ] **Step 1: Write failing two-organization persistence tests**

Add fixtures for one custom strategy per organization and assertions with exact tenant filters:

```ts
const visibleToA = await prisma.customStrategy.findMany({
  where: { organizationId: fixtures.organizationAId },
  include: { versions: true },
});
expect(visibleToA.map((row) => row.organizationId)).toEqual([fixtures.organizationAId]);

await prisma.organization.delete({ where: { id: fixtures.organizationAId } });
expect(await prisma.customStrategy.count({
  where: { organizationId: fixtures.organizationBId },
})).toBe(1);
expect(await prisma.notification.count({
  where: { organizationId: fixtures.organizationBId },
})).toBe(1);
```

Also assert the database rejects a duplicate active assignment for the same `(portfolioId, assetId)`, a duplicate evaluation key, a duplicate forward snapshot key, a duplicate notification `(userId, signalId)`, and a second transaction with the same `sourceSignalId`.

- [ ] **Step 2: Run the isolated integration test and verify RED**

Run: `npm run test:integration -- src/lib/backend/tenant-isolation.integration.test.ts`

Expected: FAIL because the new Prisma models and fields do not exist.

- [ ] **Step 3: Add Prisma models and relations**

Add these model contracts, using project UUID and timestamp conventions:

```prisma
model CustomStrategy {
  id              String                  @id @default(uuid()) @db.Uuid
  organizationId  String                  @map("organization_id") @db.Uuid
  createdByUserId String?                 @map("created_by_user_id") @db.Uuid
  name            String
  description     String?                 @db.Text
  family          String
  status          String                  @default("active")
  createdAt       DateTime                @default(now()) @map("created_at")
  updatedAt       DateTime                @updatedAt @map("updated_at")
  organization    Organization            @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  createdBy       AppUser?                @relation(fields: [createdByUserId], references: [id], onDelete: SetNull)
  versions        CustomStrategyVersion[]

  @@index([organizationId, status, updatedAt(sort: Desc)])
  @@map("custom_strategies")
}

model CustomStrategyVersion {
  id                   String            @id @default(uuid()) @db.Uuid
  customStrategyId     String            @map("custom_strategy_id") @db.Uuid
  version              String
  kind                 String
  ruleDefinition       Json              @map("rule_definition")
  implementationHash   String            @map("implementation_hash")
  status               String            @default("active")
  createdAt            DateTime          @default(now()) @map("created_at")
  customStrategy       CustomStrategy    @relation(fields: [customStrategyId], references: [id], onDelete: Cascade)
  executionVersion     StrategyVersion?

  @@unique([customStrategyId, version])
  @@unique([customStrategyId, implementationHash])
  @@map("custom_strategy_versions")
}
```

Add nullable `organizationId` and unique nullable `customStrategyVersionId` to `StrategyVersion`. Add activation/progress/source fields to `StrategyAssignment`: `activatedAt`, `lastEvaluatedAt`, `lastEvaluatedDatasetVersionId`, `lastEvaluatedBarAt`, `state`, `sourceQuantRunId`, and `sourceQuantRunLegId`. Replace Prisma's full `(portfolioId, assetId)` uniqueness with indexes because active-only uniqueness is enforced in SQL.

Add these exact durable models:

```prisma
model StrategyEvaluationJob {
  id               String             @id @default(uuid()) @db.Uuid
  organizationId   String             @map("organization_id") @db.Uuid
  assignmentId     String             @map("assignment_id") @db.Uuid
  datasetVersionId String             @map("dataset_version_id") @db.Uuid
  status           String             @default("queued")
  attemptCount     Int                @default(0) @map("attempt_count")
  workerId         String?            @map("worker_id")
  leaseExpiresAt   DateTime?          @map("lease_expires_at")
  errorCode        String?            @map("error_code")
  createdAt        DateTime           @default(now()) @map("created_at")
  finishedAt       DateTime?          @map("finished_at")
  organization     Organization       @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  assignment       StrategyAssignment @relation(fields: [assignmentId], references: [id], onDelete: Cascade)
  datasetVersion   DatasetVersion     @relation(fields: [datasetVersionId], references: [id], onDelete: Restrict)

  @@unique([assignmentId, datasetVersionId])
  @@index([status, createdAt])
  @@map("strategy_evaluation_jobs")
}

model StrategyForwardSnapshot {
  id                       String             @id @default(uuid()) @db.Uuid
  organizationId           String             @map("organization_id") @db.Uuid
  assignmentId             String             @map("assignment_id") @db.Uuid
  datasetVersionId         String             @map("dataset_version_id") @db.Uuid
  barAt                    DateTime           @map("bar_at") @db.Timestamptz(3)
  simulatedCash            Decimal            @map("simulated_cash") @db.Decimal(24, 8)
  simulatedQuantity        Decimal            @map("simulated_quantity") @db.Decimal(28, 10)
  marketValue              Decimal            @map("market_value") @db.Decimal(24, 8)
  equity                   Decimal            @db.Decimal(24, 8)
  cumulativeContributions  Decimal            @map("cumulative_contributions") @db.Decimal(24, 8)
  cumulativeFees           Decimal            @map("cumulative_fees") @db.Decimal(24, 8)
  pnlExcludingContributions Decimal           @map("pnl_excluding_contributions") @db.Decimal(24, 8)
  benchmarkEquity          Decimal            @map("benchmark_equity") @db.Decimal(24, 8)
  createdAt                DateTime           @default(now()) @map("created_at")
  organization             Organization       @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  assignment               StrategyAssignment @relation(fields: [assignmentId], references: [id], onDelete: Cascade)
  datasetVersion           DatasetVersion     @relation(fields: [datasetVersionId], references: [id], onDelete: Restrict)

  @@unique([assignmentId, datasetVersionId, barAt])
  @@index([organizationId, assignmentId, barAt])
  @@map("strategy_forward_snapshots")
}
```

Add nullable `datasetVersionId` and non-null `eventType` to `StrategySignal`, and replace its legacy unique key with `(assignmentId, datasetVersionId, signalAt, eventType)` for new forward events. Keep legacy imported rows valid through a partial SQL unique index that applies only when `dataset_version_id IS NOT NULL`. Add `Notification` with `organizationId`, `userId`, `assignmentId`, `signalId`, `type`, `title`, `body`, `readAt`, `createdAt`, and unique `(userId, signalId)`. Add nullable unique `sourceSignalId` to `PortfolioTransaction`.

- [ ] **Step 4: Encode database-only invariants in the migration**

Use explicit checks and partial indexes:

```sql
CREATE UNIQUE INDEX strategy_assignments_one_active_per_asset
ON strategy_assignments (portfolio_id, asset_id)
WHERE status = 'active';

CREATE UNIQUE INDEX strategy_signals_forward_event_idempotency
ON strategy_signals (assignment_id, dataset_version_id, signal_at, event_type)
WHERE dataset_version_id IS NOT NULL;

ALTER TABLE custom_strategies
  ADD CONSTRAINT custom_strategies_family_check CHECK (family IN ('technical', 'systematic')),
  ADD CONSTRAINT custom_strategies_status_check CHECK (status IN ('active', 'archived'));

ALTER TABLE custom_strategy_versions
  ADD CONSTRAINT custom_strategy_versions_kind_check CHECK (kind IN ('price_threshold', 'scheduled_dca')),
  ADD CONSTRAINT custom_strategy_versions_status_check CHECK (status IN ('active', 'retired'));

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN ('strategy_buy', 'strategy_sell'));
```

Backfill existing `StrategyAssignment.activatedAt` from `createdAt`, set existing historical `StrategySignal.datasetVersionId` only when metadata contains a verified dataset version, and leave it nullable for imported legacy backtest signals. Do not invent dataset ownership.

- [ ] **Step 5: Regenerate Prisma and run migration-integrity tests**

Run:

```powershell
npx prisma generate
npm run test:integration -- src/lib/backend/tenant-isolation.integration.test.ts
```

Expected: PASS; organization B rows survive deletion of organization A, and all idempotency conflicts are rejected.

- [ ] **Step 6: Commit persistence**

```powershell
git add prisma/schema.prisma prisma/migrations/202608120001_custom_strategy_execution/migration.sql src/lib/backend/tenant-isolation.integration.test.ts
git commit -m "feat: persist custom strategy forward tests"
```

### Task 2: Define normalized custom rules, stable hashes, and tenant CRUD

**Files:**

- Create: `src/lib/custom-strategies/contracts.ts`
- Create: `src/lib/custom-strategies/contracts.test.ts`
- Create: `src/lib/custom-strategies/hash.ts`
- Create: `src/lib/custom-strategies/hash.test.ts`
- Create: `src/lib/backend/custom-strategies.ts`
- Create: `src/lib/backend/custom-strategies.test.ts`
- Create: `src/app/api/quant/custom-strategies/route.ts`
- Create: `src/app/api/quant/custom-strategies/[id]/route.ts`
- Create: `src/app/api/quant/custom-strategies/[id]/versions/route.ts`
- Modify: `src/app/api/tenant-routes.test.ts`

**Interfaces:**

- Consumes: models from Task 1 and `TenantContext`/capabilities.
- Produces: `normalizeExecutableRule(input)`, `implementationHash(rule)`, `createCustomStrategy(context, input)`, `createCustomStrategyVersion(context, id, input)`, `listCustomStrategies(context)`, and `archiveCustomStrategy(context, id)`.

- [ ] **Step 1: Write failing strict rule-contract tests**

Use exact canonical inputs without asset identity:

```ts
expect(normalizeExecutableRule({
  schemaVersion: 1,
  kind: "price_threshold",
  operator: "crosses_above",
  threshold: 50_000,
  currency: "USD",
  action: "buy",
  sizePct: 25,
})).toEqual(expect.objectContaining({ threshold: 50_000, sizePct: 25 }));

expect(normalizeExecutableRule({
  schemaVersion: 1,
  kind: "scheduled_dca",
  contributionAmount: 400,
  currency: "USD",
  frequency: "monthly",
  dayOfMonth: 15,
})).toEqual(expect.objectContaining({ contributionAmount: 400 }));

expect(() => normalizeExecutableRule({
  schemaVersion: 1,
  kind: "scheduled_dca",
  contributionAmount: 0,
  currency: "USD",
  frequency: "monthly",
  dayOfMonth: 29,
})).toThrow();
```

Reject unknown keys, non-finite numbers, threshold above `1_000_000_000_000`, contribution above `1_000_000_000_000`, `sizePct` outside `(0,100]`, unsupported currency, and unsupported frequency.

- [ ] **Step 2: Write failing stable-hash tests**

```ts
expect(implementationHash({ b: 2, a: 1 })).toBe(implementationHash({ a: 1, b: 2 }));
expect(implementationHash(normalizeExecutableRule(priceRule))).toMatch(/^[a-f0-9]{64}$/);
expect(implementationHash(priceRule)).not.toBe(
  implementationHash(Object.assign({}, priceRule, { sizePct: 50 })),
);
```

- [ ] **Step 3: Run contract tests and verify RED**

Run: `npm test -- src/lib/custom-strategies/contracts.test.ts src/lib/custom-strategies/hash.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement strict schemas and canonical hashing**

Export these types and functions:

```ts
export type ExecutableRule = PriceThresholdRule | ScheduledDcaRule;
export type CreateCustomStrategyInput = {
  name: string;
  description?: string;
  rule: ExecutableRule;
};
export function normalizeExecutableRule(input: unknown): ExecutableRule;
export function nextSemanticVersion(previous: string | null): string;
export function canonicalJson(input: unknown): string;
export function implementationHash(input: unknown): string;
```

`canonicalJson` recursively sorts object keys, preserves array order, rejects `undefined`/non-finite numbers, and serializes normalized JSON with no whitespace. `nextSemanticVersion(null)` returns `1.0.0`; subsequent user edits increment the patch component.

- [ ] **Step 5: Write failing backend ownership and immutability tests**

Mock Prisma to assert:

```ts
await createCustomStrategy(editorContext, input);
expect(prisma.$transaction).toHaveBeenCalled();
expect(prisma.strategyVersion.create).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({
    code: expect.stringMatching(/^custom:/),
    organizationId: editorContext.organizationId,
    category: "custom_rule",
  }),
}));

await expect(
  createCustomStrategyVersion(contextA, strategyFromOrgB, { rule: priceRule }),
).rejects.toThrow("Custom strategy not found.");
```

Assert creation writes `CustomStrategy`, immutable `CustomStrategyVersion`, and linked `StrategyVersion` in one transaction. Assert duplicate normalized rules return the existing version without mutation. Assert archive retires future selection but leaves past versions and runs readable.

- [ ] **Step 6: Run backend tests and verify RED**

Run: `npm test -- src/lib/backend/custom-strategies.test.ts src/app/api/tenant-routes.test.ts`

Expected: FAIL because services/routes are absent.

- [ ] **Step 7: Implement tenant services and execution registry linkage**

Use `family = rule.kind === "scheduled_dca" ? "systematic" : "technical"`. Create linked `StrategyVersion` with:

```ts
{
  code: `custom:${customVersion.id}`,
  version: customVersion.version,
  name: customStrategy.name,
  category: "custom_rule",
  organizationId: context.organizationId,
  customStrategyVersionId: customVersion.id,
  parameterSchema: [],
  defaultParameters: rule,
  supportedMarkets: ["vn_equity", "crypto_spot", "metal_spot"],
  supportedTimeframes: ["1d", "1h"],
  implementationHash: implementationHash(rule),
}
```

List only `organizationId = context.organizationId`, maximum 100 strategies, newest updated first. Resolve item IDs with `findFirst({ where: { id, organizationId } })`; return the same `Custom strategy not found.` message for missing and cross-tenant IDs.

- [ ] **Step 8: Implement capability-checked APIs**

- `GET /api/quant/custom-strategies`: `backtest/read`.
- `POST /api/quant/custom-strategies`: `backtest/create`, status 201.
- `GET /api/quant/custom-strategies/:id`: `backtest/read`.
- `POST /api/quant/custom-strategies/:id/versions`: `backtest/create`, status 201.
- `PATCH /api/quant/custom-strategies/:id`: accept only `{ action: "archive" }`, require `backtest/create`.

Map `ZodError` to 400 and missing tenant rows to 404. Pass no Prisma error text to `apiError`.

- [ ] **Step 9: Run Task 2 tests**

Run: `npm test -- src/lib/custom-strategies src/lib/backend/custom-strategies.test.ts src/app/api/tenant-routes.test.ts`

Expected: PASS.

- [ ] **Step 10: Commit custom strategy CRUD**

```powershell
git add src/lib/custom-strategies src/lib/backend/custom-strategies.ts src/lib/backend/custom-strategies.test.ts src/app/api/quant/custom-strategies src/app/api/tenant-routes.test.ts
git commit -m "feat: add tenant custom strategy versions"
```

### Task 3: Expose custom versions in Backtest and freeze tenant execution inputs

**Files:**

- Modify: `src/lib/backtest/strategy-catalog.ts`
- Modify: `src/lib/backtest/strategy-catalog.test.ts`
- Modify: `src/lib/backtest/contracts.ts`
- Modify: `src/lib/backtest/contracts.test.ts`
- Modify: `src/lib/backtest/client.ts`
- Modify: `src/lib/backtest/client.test.ts`
- Modify: `src/lib/backend/quant-runs.ts`
- Modify: `src/lib/backend/quant-runs.test.ts`
- Modify: `src/app/api/quant/strategies/route.ts`
- Modify: `src/app/api/tenant-routes.test.ts`

**Interfaces:**

- Consumes: linked execution registry from Task 2.
- Produces: `listStrategyCatalog(context)`, catalog `origin`, optional `customStrategyId`, and a frozen per-leg `ruleDefinition`/`implementationHash` resolved under the current tenant.

- [ ] **Step 1: Write failing catalog visibility and parsing tests**

```ts
expect(await listStrategyCatalog(contextA)).toEqual(expect.arrayContaining([
  expect.objectContaining({ origin: "built_in", code: "ma_crossover" }),
  expect.objectContaining({
    origin: "custom",
    code: `custom:${versionAId}`,
    customStrategyId: strategyAId,
  }),
]));
expect((await listStrategyCatalog(contextA)).some((item) => item.code === `custom:${versionBId}`))
  .toBe(false);
```

Update client parsing to require `origin: "built_in" | "custom"`, accept `family: "technical" | "systematic"`, and accept nullable custom IDs. Built-in catalog constants expose `origin: "built_in"` without changing their implementation hashes.

- [ ] **Step 2: Run catalog tests and verify RED**

Run: `npm test -- src/lib/backtest/strategy-catalog.test.ts src/lib/backtest/client.test.ts src/app/api/tenant-routes.test.ts`

Expected: FAIL until the dynamic tenant catalog fields exist.

- [ ] **Step 3: Implement tenant-aware catalog loading**

Move database composition into `src/lib/backend/custom-strategies.ts`; keep static built-ins in `strategy-catalog.ts`. Route `GET` passes the exact tenant context. Query custom registry rows with:

```ts
where: {
  status: "active",
  OR: [{ organizationId: null }, { organizationId: context.organizationId }],
}
```

Return at most 200 total entries and never expose `createdByUserId`.

- [ ] **Step 4: Write failing submission and tenant-resolution tests**

Cover a custom leg with `strategyCode = custom:<versionId>`. Assert static normalization accepts only the `custom:<uuid>` shape and an empty mutable parameter object. Assert `createPortfolioQuantRun` rejects an organization B custom version under context A with `STRATEGY_UNAVAILABLE`, rejects retired versions, rejects currency mismatch, and persists the frozen rule definition and hash from storage rather than trusting request JSON.

- [ ] **Step 5: Run resolution tests and verify RED**

Run: `npm test -- src/lib/backtest/contracts.test.ts src/lib/backend/quant-runs.test.ts`

Expected: FAIL until custom resolution is supported.

- [ ] **Step 6: Implement two-stage validation**

Client/shared contract validation allows either a built-in catalog strategy or `custom:<uuid>` with `{}` parameters. `resolvePortfolioLegs(context, input)` performs authoritative database resolution and returns:

```ts
type ResolvedLeg = {
  // existing resolved fields
  strategyOrigin: "built_in" | "custom";
  ruleDefinition: Record<string, unknown> | null;
  implementationHash: string;
};
```

For custom strategies, verify `strategy.organizationId === context.organizationId`, status active, supported market/timeframe, and rule currency equals `Asset.currency`. Store the normalized frozen rule in `QuantRunLeg.parameters`; keep the request body free of server-owned rule JSON. Include rule hash in `hashResolvedPortfolioRun`.

- [ ] **Step 7: Run Task 3 tests**

Run: `npm test -- src/lib/backtest/strategy-catalog.test.ts src/lib/backtest/contracts.test.ts src/lib/backtest/client.test.ts src/lib/backend/quant-runs.test.ts src/app/api/tenant-routes.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit backtest catalog integration**

```powershell
git add src/lib/backtest src/lib/backend/quant-runs.ts src/lib/backend/quant-runs.test.ts src/lib/backend/custom-strategies.ts src/app/api/quant/strategies/route.ts src/app/api/tenant-routes.test.ts
git commit -m "feat: run tenant strategies from backtest catalog"
```

### Task 4: Execute causal partial-size Price Threshold backtests

**Files:**

- Create: `quant-worker/backtest/custom_rules.py`
- Create: `quant-worker/backtest/custom_execution.py`
- Create: `quant-worker/tests/test_custom_rules.py`
- Create: `quant-worker/tests/test_price_threshold_execution.py`
- Modify: `quant-worker/worker.py`
- Modify: `quant-worker/tests/test_worker.py`
- Modify: `quant-worker/backtest/portfolio.py`
- Modify: `quant-worker/tests/test_portfolio.py`
- Modify: `src/lib/backtest/client.ts`
- Modify: `src/lib/backtest/client.test.ts`
- Modify: `src/lib/backtest/result-model.ts`
- Modify: `src/lib/backtest/result-model.test.ts`
- Modify: `src/components/backtest-results/BacktestTradeList.tsx`

**Interfaces:**

- Consumes: frozen `ruleDefinition` and implementation hash from Task 3 plus existing `Bar`, per-market costs, and immutable datasets.
- Produces: `parse_custom_rule(value)`, `run_price_threshold` with the exact signature in Step 4, and execution-fill trade rows that the existing Trade List can render.

- [ ] **Step 1: Write failing Python parser and crossing tests**

```python
rule = parse_custom_rule({
    "schemaVersion": 1,
    "kind": "price_threshold",
    "operator": "crosses_above",
    "threshold": 100,
    "currency": "USD",
    "action": "buy",
    "sizePct": 25,
})
assert rule.threshold == Decimal("100")
assert rule.size_pct == Decimal("25")
```

Use bars with closes `[99, 101, 102, 98, 101]` and opens `[99, 100, 103, 99, 100]`. Assert signals occur only on the two true crossings, each fills at the next bar open, remaining above creates no event, and a crossing on the final bar creates no fill.

- [ ] **Step 2: Write failing execution accounting tests**

Assert a 25% buy uses 25% of available cash after commission/slippage, a 50% sell disposes exactly half current quantity, a sell while flat becomes a non-actionable `HOLD`, and total fees equal the fill ledger. Assert no quantity or cash becomes negative.

Expected fill shape:

```python
{
    "asset": "BTC",
    "action": "buy",
    "signalAt": "2026-01-02T00:00:00Z",
    "executedAt": "2026-01-03T00:00:00Z",
    "referenceOpen": 103.0,
    "fillPrice": 103.103,
    "quantity": 24.22337369,
    "fees": 2.4975025,
    "sizePct": 25.0,
    "reason": "price_crosses_above",
}
```

- [ ] **Step 3: Run focused Python tests and verify RED**

Run: `python -m pytest quant-worker/tests/test_custom_rules.py quant-worker/tests/test_price_threshold_execution.py -q`

Expected: FAIL because custom rule execution is absent.

- [ ] **Step 4: Implement allow-listed parsing and price execution**

Create immutable dataclasses `PriceThresholdRule` and `ScheduledDcaRule`. `parse_custom_rule` requires exact keys and bounded Decimals. Implement:

```python
def run_price_threshold(
    asset: str,
    bars: list[Bar],
    *,
    initial_capital: Decimal,
    rule: PriceThresholdRule,
    fee_bps: Decimal,
    sell_tax_bps: Decimal,
    slippage_bps: Decimal,
    strategy_hash: str,
    dataset_checksum: str,
) -> BacktestResult:
    """Return causal equity, drawdown, and partial execution fills."""
```

Maintain a fill ledger, cash, quantity, average cost, realized PnL, and next-bar pending event. `crosses_above` uses `previous.close <= threshold < current.close`; `crosses_below` uses `previous.close >= threshold > current.close`. Buy notional is `cash * sizePct / 100`, bounded so notional plus costs does not exceed cash. Sell quantity is `quantity * sizePct / 100`. Mark equity at every close.

- [ ] **Step 5: Dispatch Price Threshold legs in the worker**

When `strategy_code` begins with `custom:` parse the frozen `leg.strategy_parameters`. Verify the SHA-256 hash equals `leg.implementation_hash` before execution. For `price_threshold`, call `run_price_threshold`; on mismatch fail the leg with sanitized `STRATEGY_HASH_MISMATCH`, and on invalid rule use `DSL_INVALID`.

- [ ] **Step 6: Write failing TypeScript artifact/UI normalization tests**

Add a strict `executionFillSchema` and assert `buildBacktestTradeRows` maps both legacy round-trip trades and custom execution fills to table rows with timestamp, action, quantity, fill price, fees, realized PnL when available, and reason. Invalid custom rows must make response parsing fail rather than render partial data.

- [ ] **Step 7: Implement execution-fill parsing and Trade List rendering**

Use a discriminated union keyed by presence of `action` versus `side`. Keep existing columns for legacy rows; render custom rows with `BUY`/`SELL`, signal/fill timestamps, quantity, price, costs, and reason. Do not label an open BUY fill as a completed profitable trade.

- [ ] **Step 8: Run Task 4 tests**

Run:

```powershell
python -m pytest quant-worker/tests/test_custom_rules.py quant-worker/tests/test_price_threshold_execution.py quant-worker/tests/test_worker.py -q
npm test -- src/lib/backtest/client.test.ts src/lib/backtest/result-model.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit price execution**

```powershell
git add quant-worker/backtest/custom_rules.py quant-worker/backtest/custom_execution.py quant-worker/worker.py quant-worker/tests/test_custom_rules.py quant-worker/tests/test_price_threshold_execution.py quant-worker/tests/test_worker.py src/lib/backtest/client.ts src/lib/backtest/client.test.ts src/lib/backtest/result-model.ts src/lib/backtest/result-model.test.ts src/components/backtest-results/BacktestTradeList.tsx
git commit -m "feat: backtest price threshold strategies"
```

### Task 5: Execute asset-specific DCA with contribution-neutral returns

**Files:**

- Modify: `quant-worker/backtest/custom_execution.py`
- Create: `quant-worker/backtest/performance.py`
- Create: `quant-worker/tests/test_dca_execution.py`
- Create: `quant-worker/tests/test_cash_flow_performance.py`
- Modify: `quant-worker/worker.py`
- Modify: `quant-worker/tests/test_worker.py`
- Modify: `src/lib/backtest/client.ts`
- Modify: `src/lib/backtest/client.test.ts`
- Modify: `src/lib/backtest/result-model.ts`
- Modify: `src/lib/backtest/result-model.test.ts`
- Modify: `src/components/backtest-results/BacktestKpiGrid.tsx`
- Modify: `src/components/backtest-results/BacktestAdvancedAnalysis.tsx`

**Interfaces:**

- Consumes: `ScheduledDcaRule`, immutable bars, market costs, and frozen custom version identity.
- Produces: `run_scheduled_dca` with the exact signature in Step 4, `time_weighted_return`, `money_weighted_return`, per-leg `contribution`/`cash_flow` artifacts, and contribution-aware portfolio aggregation.

- [ ] **Step 1: Write failing schedule and fill tests**

Create daily bars covering January through March with the configured day falling on a weekend in February. Assert:

```python
result = run_scheduled_dca(
    "BTC",
    bars,
    initial_capital=Decimal("1000"),
    rule=ScheduledDcaRule(
        contribution_amount=Decimal("400"),
        currency="USD",
        frequency="monthly",
        day_of_month=15,
    ),
    fee_bps=Decimal("10"),
    slippage_bps=Decimal("5"),
    strategy_hash="a" * 64,
    dataset_checksum="b" * 64,
)
assert [row["amount"] for row in result.contributions] == [400.0, 400.0, 400.0]
assert result.contributions[1]["scheduledDay"] == 15
assert result.contributions[1]["executedAt"] == "2026-02-16T00:00:00Z"
```

Also assert at most one contribution per month, no contribution after the requested end, no event for a month without a later eligible bar, and the deposit occurs immediately before that bar's open.

- [ ] **Step 2: Write failing cash-flow metric tests**

Use a flat-price dataset and zero costs: `initialCapital=1000`, two DCA deposits of `400`, `finalEquity=1800`. Assert:

```python
assert summary["cumulativeContributions"] == 800.0
assert summary["netProfitExcludingContributions"] == 0.0
assert summary["timeWeightedReturnPct"] == 0.0
assert summary["totalReturnPct"] == 0.0
```

Use a rising dataset to assert positive TWR and verify `finalEquity - initialEquity - cumulativeContributions == netProfitExcludingContributions`. Assert money-weighted return is `None` when dated flows are insufficient and finite when a closing valuation exists.

- [ ] **Step 3: Run DCA tests and verify RED**

Run: `python -m pytest quant-worker/tests/test_dca_execution.py quant-worker/tests/test_cash_flow_performance.py -q`

Expected: FAIL because DCA execution/performance modules are absent.

- [ ] **Step 4: Implement DCA scheduling and fractional fills**

Add:

```python
@dataclass(frozen=True)
class CustomBacktestResult:
    result: BacktestResult
    contributions: list[dict[str, Any]]
    cash_flow: list[dict[str, Any]]

def run_scheduled_dca(
    asset: str,
    bars: list[Bar],
    *,
    initial_capital: Decimal,
    rule: ScheduledDcaRule,
    fee_bps: Decimal,
    slippage_bps: Decimal,
    strategy_hash: str,
    dataset_checksum: str,
) -> CustomBacktestResult:
    """Return DCA valuation plus dated external cash-flow artifacts."""
```

Group bars by `(year, month)`, choose the first bar whose local dataset date is at or after `day_of_month`, add exactly `contributionAmount` to cash, then purchase at open plus slippage. Bound quantity so cost plus commission is no more than the new contribution. Preserve unspent cash. Add manifest field `quantityModel` as `fractional_research` for `vn_equity` and `fractional` for crypto/XAU; never claim broker board-lot compatibility.

- [ ] **Step 5: Implement contribution-neutral performance**

Compute TWR by chaining subperiod returns around dated external flows:

```python
subperiod_return = (ending_equity - external_flow) / starting_equity - Decimal("1")
twr = product(Decimal("1") + value for value in subperiod_returns) - Decimal("1")
```

Compute MWR with a bounded bisection XIRR solver over `[-0.9999, 1000]`, maximum 200 iterations, returning `None` when cash flows do not have both signs or no bracketed root exists. Expose `initialEquity`, `finalEquity`, `cumulativeContributions`, `netProfitExcludingContributions`, `timeWeightedReturnPct`, `moneyWeightedReturnPct`, `totalFees`, and `slippageCost`.

- [ ] **Step 6: Persist DCA artifacts without double counting portfolio assumptions**

Extend `PortfolioLegInput` with `external_contributions: list[dict[str, Any]]`. The worker passes each DCA result's rows into its exact leg and passes `[]` for Price Threshold/built-in legs. In `run_portfolio`, index strategy contributions by `(leg.id, timestamp, source)` and neutralize that external flow when computing aggregate normalized returns; then process existing portfolio-level monthly contributions once under the separate `portfolio_assumption` source. Add tests where both sources share a timestamp and assert both appear exactly once while neither amount is treated as return.

The worker writes per-leg `contribution` and `cash_flow` artifacts under `scopeKey = leg:<id>`. Keep aggregate portfolio assumptions under `scopeKey = aggregate`. Add `source: "strategy_dca"` and `legId` to leg rows, and `source: "portfolio_assumption"` with `legId: null` to aggregate rows. Never merge contributions by timestamp alone.

- [ ] **Step 7: Write failing TypeScript DCA response tests**

Assert strict parsing of contribution rows `{ scheduledDay, scheduledAt, executedAt, amount, currency, investedAmount, fees, remainingCash, source }`, cash-flow rows, and nullable MWR. Assert KPI presentation labels contributed capital separately and displays net profit/TWR instead of deriving return from final equity divided only by initial capital.

- [ ] **Step 8: Implement DCA result presentation**

Add contribution summary to `BacktestKpiGrid` and a dated cash-flow table to `BacktestAdvancedAnalysis`. Display `Vốn góp thêm`, `Lợi nhuận không tính vốn góp`, `TWR`, and `MWR` when available. Preserve the classic Equity Curve/Drawdown and Trade List surfaces.

- [ ] **Step 9: Run Task 5 tests**

Run:

```powershell
python -m pytest quant-worker/tests/test_dca_execution.py quant-worker/tests/test_cash_flow_performance.py quant-worker/tests/test_portfolio.py quant-worker/tests/test_worker.py -q
npm test -- src/lib/backtest/client.test.ts src/lib/backtest/result-model.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit DCA execution**

```powershell
git add quant-worker/backtest/custom_execution.py quant-worker/backtest/performance.py quant-worker/backtest/portfolio.py quant-worker/worker.py quant-worker/tests/test_dca_execution.py quant-worker/tests/test_cash_flow_performance.py quant-worker/tests/test_portfolio.py quant-worker/tests/test_worker.py src/lib/backtest/client.ts src/lib/backtest/client.test.ts src/lib/backtest/result-model.ts src/lib/backtest/result-model.test.ts src/components/backtest-results/BacktestKpiGrid.tsx src/components/backtest-results/BacktestAdvancedAnalysis.tsx
git commit -m "feat: backtest asset-specific DCA cash flows"
```

### Task 6: Replace browser-only executable drafts with Strategy Lab persistence

**Files:**

- Create: `src/lib/custom-strategies/client.ts`
- Create: `src/lib/custom-strategies/client.test.ts`
- Modify: `src/lib/strategy-lab/custom-strategy.ts`
- Modify: `src/lib/strategy-lab/custom-strategy.test.ts`
- Modify: `src/components/StrategyLab.tsx`
- Modify: `src/components/QuantLab.tsx`
- Modify: `src/app/quant-lab/page.tsx`

**Interfaces:**

- Consumes: Task 2 APIs and the existing `radarasset.strategy-lab.v1` local storage payload.
- Produces: `listCustomStrategiesClient()`, `createCustomStrategyClient()`, `archiveCustomStrategyClient()`, `executableLocalDrafts(raw)`, and an API-backed My Strategies UI.

- [ ] **Step 1: Write failing strict client tests**

Use fake fetchers to verify list/create/version/archive response parsing, `cache: "no-store"`, JSON content type, 201 handling, and the stable public error `Không thể lưu chiến lược.` for non-2xx/malformed responses. The client accepts no server fields outside its Zod schemas.

- [ ] **Step 2: Write failing import-selection tests**

```ts
const result = executableLocalDrafts(serializeCustomStrategies([
  localDca,
  localPrice,
  localFundamental,
]));
expect(result.importable.map((row) => row.kind)).toEqual(["scheduled_dca", "price_threshold"]);
expect(result.unsupported.map((row) => row.kind)).toEqual(["fundamental_threshold"]);
```

Map legacy `amount -> contributionAmount` and `value -> threshold`; remove `id` and `symbol` from the reusable server rule while preserving the symbol as an optional Backtest preselection hint.

- [ ] **Step 3: Run client/import tests and verify RED**

Run: `npm test -- src/lib/custom-strategies/client.test.ts src/lib/strategy-lab/custom-strategy.test.ts`

Expected: FAIL because API client/import mapping is absent.

- [ ] **Step 4: Implement typed client and explicit import mapper**

Export:

```ts
export type CustomStrategySummary = {
  id: string;
  name: string;
  description: string | null;
  family: "technical" | "systematic";
  status: "active" | "archived";
  versions: CustomStrategyVersionSummary[];
};
```

Never upload `catalog_preset` or `fundamental_threshold` local drafts through the custom rule endpoint. Catalog presets remain built-in selections; fundamentals remain local and visibly unavailable.

- [ ] **Step 5: Refactor Strategy Lab to server-owned executable strategies**

On mount, fetch My Strategies and separately parse local drafts. If importable drafts exist, show an `AlertDialog` listing their names and rule kinds with `Import` and `Not now`. Import sequentially with per-row result accounting; remove only successfully imported IDs from local storage after the API confirms each create. Leave failed and unsupported drafts untouched.

The builder Save action sends DCA/Price strategies to the API. My Strategies shows active immutable version, family, rule summary, archive, `Tạo phiên bản mới`, and `Dùng trong Backtest`. Modify `src/app/quant-lab/page.tsx` to retain the `TenantContext` returned by `requireTenantPage`, derive `canCreateStrategies = hasTenantCapability(context.role, "backtest", "create")`, pass that boolean through `QuantLab` into `StrategyLab`, and hide or disable mutation controls for viewers. Fundamental copy remains `Cần dữ liệu point-in-time`.

- [ ] **Step 6: Add component behavior tests through pure extracted state helpers**

Extract `mergeImportedDraftResults(stored, results)` and test partial success, retry safety, unsupported preservation, and no silent deletion. Avoid adding a DOM testing dependency.

- [ ] **Step 7: Run Task 6 tests**

Run: `npm test -- src/lib/custom-strategies src/lib/strategy-lab`

Expected: PASS.

- [ ] **Step 8: Commit Strategy Lab persistence**

```powershell
git add src/lib/custom-strategies/client.ts src/lib/custom-strategies/client.test.ts src/lib/strategy-lab/custom-strategy.ts src/lib/strategy-lab/custom-strategy.test.ts src/components/StrategyLab.tsx src/components/QuantLab.tsx src/app/quant-lab/page.tsx
git commit -m "feat: persist executable Strategy Lab rules"
```

### Task 7: Apply successful custom runs and create an initial forward snapshot

**Files:**

- Modify: `src/lib/backtest/assignment-contracts.ts`
- Modify: `src/lib/backtest/assignment-contracts.test.ts`
- Create: `src/lib/backend/strategy-forward-tests.ts`
- Create: `src/lib/backend/strategy-forward-tests.test.ts`
- Modify: `src/app/api/portfolio/strategy-assignments/route.ts`
- Modify: `src/app/api/tenant-routes.test.ts`
- Modify: `src/lib/backend/types.ts`

**Interfaces:**

- Consumes: a succeeded custom-strategy `QuantRunLeg`, current Portfolio position, active dataset, and Task 1 models.
- Produces: `applyStrategyAssignment(context, input)` and an `INITIAL_SNAPSHOT` forward state without notification.

- [ ] **Step 1: Write failing assignment contract tests**

Replace the hard-coded built-in enum with:

```ts
const strategyCodeSchema = z.union([
  builtInStrategyCodeSchema,
  z.string().regex(/^custom:[0-9a-f]{8}-[0-9a-f-]{27}$/i),
]);
```

Require `portfolioId`, `symbol`, `strategyCode`, `strategyVersion`, `{}` custom parameters, `backtestRunId`, and `backtestRunLegId`. Reject incomplete run/leg pairs and unknown fields.

- [ ] **Step 2: Write failing source-run/activation tests**

Test exact rejection cases: run is not succeeded, run or portfolio belongs to another tenant, leg/asset/version/hash mismatch, no active eligible dataset, currency mismatch, retired version, and unsupported timeframe. Assert a successful apply archives the previous active assignment, creates a new assignment, `INITIAL_SNAPSHOT` signal, first `StrategyForwardSnapshot`, and progress fields in one transaction; notification count remains zero.

- [ ] **Step 3: Run assignment tests and verify RED**

Run: `npm test -- src/lib/backtest/assignment-contracts.test.ts src/lib/backend/strategy-forward-tests.test.ts src/app/api/tenant-routes.test.ts`

Expected: FAIL until the forward assignment service exists.

- [ ] **Step 4: Implement atomic apply behavior**

Within one Prisma transaction:

1. Load the exact tenant portfolio and its `userId`.
2. Load the succeeded tenant run and requested leg with strategy and dataset.
3. Revalidate code/version/hash/symbol/currency.
4. Archive existing active assignment for the portfolio/asset.
5. Create assignment with frozen parameters, activation timestamp, starting position quantity/average cost, starting bar price, starting simulated cash, and last evaluated dataset/bar.
6. Create `INITIAL_SNAPSHOT` and first forward snapshot using the latest eligible bar whose timestamp is at or before activation. If no as-of bar exists, persist a queued evaluation job and no fabricated price. Bars after activation are evaluated only by the forward worker.

Use stable errors `SOURCE_RUN_MISMATCH`, `DATASET_UNAVAILABLE`, `STRATEGY_UNAVAILABLE`, and `CURRENCY_MISMATCH`. Routes expose 409 for correctable eligibility errors and 404 for tenant-owned resources that do not exist.

- [ ] **Step 5: Replace legacy assignment import behavior**

Stop copying historical backtest BUY/SELL rows into `StrategySignal`; historical trades remain in run artifacts. Route POST calls `applyStrategyAssignment`, requires both `portfolio/write` and `backtest/read`, and returns 201. Existing GET continues to return only current-tenant assignments.

- [ ] **Step 6: Run Task 7 tests**

Run: `npm test -- src/lib/backtest/assignment-contracts.test.ts src/lib/backend/strategy-forward-tests.test.ts src/app/api/tenant-routes.test.ts src/lib/backend/tenant-scoping.test.ts`

Expected: PASS, including regression coverage that no historical notification is created.

- [ ] **Step 7: Commit forward activation**

```powershell
git add src/lib/backtest/assignment-contracts.ts src/lib/backtest/assignment-contracts.test.ts src/lib/backend/strategy-forward-tests.ts src/lib/backend/strategy-forward-tests.test.ts src/lib/backend/types.ts src/app/api/portfolio/strategy-assignments/route.ts src/app/api/tenant-routes.test.ts src/lib/backend/tenant-scoping.test.ts
git commit -m "feat: activate custom strategy forward tests"
```

### Task 8: Enqueue and evaluate forward tests idempotently after ingestion

**Files:**

- Create: `quant-worker/backtest/signal_jobs.py`
- Create: `quant-worker/backtest/forward_evaluator.py`
- Create: `quant-worker/tests/test_signal_jobs.py`
- Create: `quant-worker/tests/test_forward_evaluator.py`
- Create: `quant-worker/tests/test_forward_evaluator_integration.py`
- Modify: `quant-worker/backtest/publication.py`
- Modify: `quant-worker/tests/test_publication.py`
- Modify: `quant-worker/worker.py`
- Modify: `quant-worker/tests/test_worker.py`

**Interfaces:**

- Consumes: active dataset publication, assignment state, frozen custom rule, and Task 1 evaluation tables.
- Produces: `enqueue_strategy_evaluations(connection, dataset_version_id)`, `claim_next_evaluation(connection, worker_id)`, and `process_next_evaluation(repository)`.

- [ ] **Step 1: Write failing publication/idempotency tests**

Assert publishing a new eligible active version enqueues one job per active assignment for that asset/timeframe. Re-publishing the same version creates none. Paused/archived assignments, retired/inaccessible custom versions, mismatched asset/timeframe, and quarantined data create no job.

- [ ] **Step 2: Run publication tests and verify RED**

Run: `python -m pytest quant-worker/tests/test_signal_jobs.py quant-worker/tests/test_publication.py -q`

Expected: FAIL because the job module is absent and publication still evaluates synchronously.

- [ ] **Step 3: Replace synchronous publication signals with job enqueueing**

After activating the immutable version, call:

```python
INSERT INTO strategy_evaluation_jobs (
    id, organization_id, assignment_id, dataset_version_id, status, attempt_count, created_at
)
SELECT gen_random_uuid(), assignment.organization_id, assignment.id, %s, 'queued', 0, NOW()
FROM strategy_assignments AS assignment
JOIN strategy_versions AS version ON version.id = assignment.strategy_version_id
WHERE assignment.asset_id = %s
  AND assignment.status = 'active'
  AND version.status = 'active'
ON CONFLICT (assignment_id, dataset_version_id) DO NOTHING
```

Remove direct `evaluate_latest_signal` and `strategy_signals` insertion from `publication.py`. Keep dataset activation and job insertion inside the same transaction.

- [ ] **Step 4: Write failing forward evaluation tests**

Price tests assert prior-close context, only bars after `lastEvaluatedBarAt`, one crossing, signal-close reference metadata, state update, snapshot, BUY/SELL signal, and one notification. A forward notification is emitted when the crossing close becomes known; it must not claim a next-bar fill that has not occurred. DCA tests assert an unpaid month emits one external-contribution BUY at the first eligible scheduled bar, retry emits none, and the next month can emit again. Assert `INITIAL_SNAPSHOT` when no prior progress exists and no notification.

Use the exact idempotency tuple `(assignmentId, datasetVersionId, barAt, eventType)` in repository fakes and database integration assertions.

- [ ] **Step 5: Run evaluator tests and verify RED**

Run: `python -m pytest quant-worker/tests/test_forward_evaluator.py -q`

Expected: FAIL until incremental evaluation exists.

- [ ] **Step 6: Implement job claiming and bounded incremental context**

Claim with `FOR UPDATE SKIP LOCKED`, increment attempts, set a five-minute lease, and cap retries at 3. Load only bars after `last_evaluated_bar_at` plus two prior bars for Price Threshold; DCA needs only the prior paid-month state and current month bars. Verify dataset checksum and custom implementation hash.

Persist assignment state, `StrategyForwardSnapshot`, actionable `StrategySignal`, and portfolio-owner `Notification` in one transaction. Insert notification only when signal insert returned a new row. Use `ON CONFLICT DO NOTHING` for jobs, snapshots, signals, and notifications. Errors persist only `DATASET_INVALID`, `STRATEGY_HASH_MISMATCH`, `DSL_INVALID`, or `ENGINE_FAILED`.

- [ ] **Step 7: Extend the durable worker loop fairly**

Each loop iteration processes at most one Quant Run and one Strategy Evaluation Job before sleeping. A busy backtest queue must not starve forward alerts; an evaluation failure must not terminate the backtest worker.

- [ ] **Step 8: Run Python unit and database integration tests**

Run:

```powershell
python -m pytest quant-worker/tests/test_signal_jobs.py quant-worker/tests/test_publication.py quant-worker/tests/test_forward_evaluator.py quant-worker/tests/test_worker.py -q
python -m pytest quant-worker/tests/test_forward_evaluator_integration.py -q
```

Expected: PASS with the isolated PostgreSQL test database configured; retry produces one signal/snapshot/notification only.

- [ ] **Step 9: Commit forward evaluation**

```powershell
git add quant-worker/backtest/signal_jobs.py quant-worker/backtest/forward_evaluator.py quant-worker/backtest/publication.py quant-worker/worker.py quant-worker/tests/test_signal_jobs.py quant-worker/tests/test_publication.py quant-worker/tests/test_forward_evaluator.py quant-worker/tests/test_forward_evaluator_integration.py quant-worker/tests/test_worker.py
git commit -m "feat: evaluate strategy forward signals"
```

### Task 9: Expose forward performance and in-app notifications safely

**Files:**

- Modify: `src/lib/backend/strategy-forward-tests.ts`
- Modify: `src/lib/backend/strategy-forward-tests.test.ts`
- Create: `src/app/api/portfolio/strategy-forward-tests/route.ts`
- Create: `src/app/api/notifications/route.ts`
- Create: `src/app/api/notifications/[id]/route.ts`
- Create: `src/lib/strategy-forward/client.ts`
- Create: `src/lib/strategy-forward/client.test.ts`
- Create: `src/components/NotificationCenter.tsx`
- Modify: `src/components/Header.tsx`
- Modify: `src/app/api/tenant-routes.test.ts`
- Modify: `src/lib/backend/types.ts`
- Modify: `src/lib/mvp-ui.ts`
- Modify: `src/lib/mvp-ui.test.ts`

**Interfaces:**

- Consumes: forward snapshots/signals/notifications from Task 8.
- Produces: `loadStrategyForwardTests(context)`, `loadNotifications(context, cursor)`, `markNotificationRead(context, id)`, and strict browser clients.

- [ ] **Step 1: Write failing tenant-scoped loader tests**

Assert `loadStrategyForwardTests(contextA)` returns active assignments owned by organization A with at most 365 newest snapshots per assignment, latest signal, and no organization B identifiers. Assert response contains:

```ts
type StrategyForwardTestResponse = {
  assignmentId: string;
  portfolioId: string;
  symbol: string;
  strategy: { code: string; version: string; name: string; kind: string };
  status: "active" | "paused" | "evaluation_failed";
  activatedAt: string;
  latestSignal: StrategySignalResponse | null;
  snapshots: Array<{
    timestamp: string;
    equity: number;
    benchmarkEquity: number;
    pnlExcludingContributions: number;
    cumulativeContributions: number;
  }>;
};
```

Assert notification list returns only `userId = context.userId` and `organizationId = context.organizationId`, newest first, 25 rows per page, bounded cursor, unread count, and no raw job error.

- [ ] **Step 2: Write failing notification mutation tests**

Assert mark-read uses `updateMany({ where: { id, organizationId, userId, readAt: null } })`; cross-tenant and another organization member's IDs return `Notification not found.` without revealing ownership. Repeated mark-read is idempotent.

- [ ] **Step 3: Run backend tests and verify RED**

Run: `npm test -- src/lib/backend/strategy-forward-tests.test.ts src/app/api/tenant-routes.test.ts`

Expected: FAIL because read APIs are missing.

- [ ] **Step 4: Implement bounded loaders and routes**

- `GET /api/portfolio/strategy-forward-tests`: `portfolio/read`.
- `GET /api/notifications?cursor=<id>`: `portfolio/read`; return `{ items, nextCursor, unreadCount }`.
- `PATCH /api/notifications/:id`: accept only `{ read: true }`, require `portfolio/read`.

All nested Prisma filters include `organizationId`. Select only fields in the public response. Map unknown statuses to a sanitized `evaluation_failed` state rather than returning database strings.

- [ ] **Step 5: Write failing client parsing tests**

Verify strict schemas reject cross-shaped/malformed snapshot values, invalid notification types, negative unread counts, and unbounded body text. Verify fetch failures return Vietnamese product-level messages without raw response bodies.

- [ ] **Step 6: Implement forward/notification clients and enable the capability**

Create `getStrategyForwardTests`, `getNotifications`, and `markNotificationRead`. Bound notification title to 120 characters and body to 500 in schemas. Change `MVP_FEATURES.notifications.available` to `true` only after these APIs exist; update its unit test to expect true.

Add `NotificationCenter` beside the theme control in `Header`: fetch the first page on mount, show a Bell button with unread badge, render newest-first items in a Popover, mark one item read when opened, and link strategy notifications to `/portfolio?signal=<signalId>`. Poll every 60 seconds only while the document is visible; abort requests on unmount. The global center is the real in-app delivery surface, while Mock Portfolio renders detailed forward state.

Because `Header` also renders on signed-out routes, a 401 from `/api/notifications` makes `NotificationCenter` render nothing and stops polling; it must not show an error toast or retry loop on public authentication pages.

- [ ] **Step 7: Run Task 9 tests**

Run: `npm test -- src/lib/backend/strategy-forward-tests.test.ts src/lib/strategy-forward/client.test.ts src/app/api/tenant-routes.test.ts src/lib/mvp-ui.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit read APIs**

```powershell
git add src/lib/backend/strategy-forward-tests.ts src/lib/backend/strategy-forward-tests.test.ts src/lib/backend/types.ts src/lib/strategy-forward src/components/NotificationCenter.tsx src/components/Header.tsx src/app/api/portfolio/strategy-forward-tests src/app/api/notifications src/app/api/tenant-routes.test.ts src/lib/mvp-ui.ts src/lib/mvp-ui.test.ts
git commit -m "feat: expose strategy forward notifications"
```

### Task 10: Present forward testing in Mock Portfolio

**Files:**

- Create: `src/components/PortfolioStrategyForwardTests.tsx`
- Create: `src/lib/strategy-forward/presentation.ts`
- Create: `src/lib/strategy-forward/presentation.test.ts`
- Modify: `src/components/MockPortfolio.tsx`
- Modify: `src/components/StrategyAssignmentPanel.tsx`
- Modify: `src/app/portfolio/page.tsx`

**Interfaces:**

- Consumes: clients from Task 9, existing Mock Portfolio holdings, and successful Backtest Apply action.
- Produces: forward equity/benchmark chart, contribution-neutral KPI cards, assignment status controls, and a notification list action callback.

- [ ] **Step 1: Write failing presentation-model tests**

```ts
expect(buildForwardChart(snapshots)).toEqual([
  { timestamp: "2026-08-01T00:00:00.000Z", strategy: 100, buyHold: 100 },
  { timestamp: "2026-08-02T00:00:00.000Z", strategy: 102, buyHold: 101 },
]);
expect(forwardKpis(latest)).toMatchObject({
  pnlExcludingContributions: 20,
  cumulativeContributions: 400,
});
```

Assert normalization returns an empty model for fewer than one snapshot and never divides by zero.

- [ ] **Step 2: Run presentation tests and verify RED**

Run: `npm test -- src/lib/strategy-forward/presentation.test.ts`

Expected: FAIL because the presentation module does not exist.

- [ ] **Step 3: Implement pure presentation helpers**

Normalize strategy and benchmark series to 100 at activation for comparable charting. Keep actual equity, contribution, fees, and PnL values separate for KPI labels. Map latest signals to Vietnamese `Mua`, `Bán`, `Khởi tạo`, or `Không có tín hiệu mới` copy.

- [ ] **Step 4: Build the forward-test portfolio surface**

Create a card per active assignment showing strategy name/version, symbol, activation date, last evaluation/data freshness, latest signal, cumulative contributions, PnL excluding contributions, fees, and a two-line Strategy vs Buy & Hold chart. Use existing Recharts primitives and responsive containers; no new chart dependency. Loading, empty, error, paused, and evaluation-failed states must be explicit.

- [ ] **Step 5: Integrate Apply and refresh behavior**

After successful Apply from Backtest, navigate or refresh Portfolio and focus the new assignment card. Portfolio fetches assignments/forward tests in parallel on the client after the initial server portfolio payload. Poll only while a queued evaluation exists, with 5-second interval, abort on unmount, and no polling when the document is hidden.

- [ ] **Step 6: Run focused tests and TypeScript checks**

Run:

```powershell
npm test -- src/lib/strategy-forward/presentation.test.ts src/lib/backtest/assignment-contracts.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit Mock Portfolio forward UI**

```powershell
git add src/components/PortfolioStrategyForwardTests.tsx src/components/MockPortfolio.tsx src/components/StrategyAssignmentPanel.tsx src/app/portfolio/page.tsx src/lib/strategy-forward/presentation.ts src/lib/strategy-forward/presentation.test.ts
git commit -m "feat: show forward strategy performance"
```

### Task 11: Link one signal to one reviewed Mock Portfolio transaction

**Files:**

- Modify: `src/lib/portfolio-transaction-preview.ts`
- Modify: `src/lib/portfolio-transaction-preview.test.ts`
- Modify: `src/lib/backend/portfolio.ts`
- Modify: `src/lib/backend/portfolio.test.ts`
- Modify: `src/app/api/portfolio/transactions/route.ts`
- Modify: `src/app/api/portfolio/transactions/route.test.ts`
- Modify: `src/components/PortfolioTransactionDialog.tsx`
- Modify: `src/components/PortfolioStrategyForwardTests.tsx`

**Interfaces:**

- Consumes: actionable tenant signal/notification and existing transaction accounting.
- Produces: `sourceSignalId` transaction input, `loadSignalTransactionPreview(context, signalId)`, and confirmed signal-linked Buy/Sell behavior.

- [ ] **Step 1: Write failing preview validation tests**

For Price Threshold BUY, assert proposed quantity and reference price come from the signal-close metadata, clearly labeled as a reference rather than an executed fill. For SELL, assert proposed quantity is no more than current holding. For DCA BUY, assert preview exposes `contributionAmount` and computes affordable quantity with current market costs. Reject `HOLD`, `SKIPPED`, `INITIAL_SNAPSHOT`, dismissed/executed signals, and missing reference price.

- [ ] **Step 2: Write failing transaction ownership/idempotency tests**

Post `{ assetId, type, quantity, price, fee, executedAt, sourceSignalId }`. Assert server verifies signal organization, assignment portfolio, asset, action, quantity upper bound, and reference price tolerance. Assert another tenant's signal returns 404, opposite side returns 409 `SIGNAL_SIDE_MISMATCH`, and a second confirmation returns 409 `SIGNAL_ALREADY_ACTED` without modifying positions.

- [ ] **Step 3: Run transaction tests and verify RED**

Run: `npm test -- src/lib/portfolio-transaction-preview.test.ts src/lib/backend/portfolio.test.ts src/app/api/portfolio/transactions/route.test.ts`

Expected: FAIL until source-signal flow exists.

- [ ] **Step 4: Implement server-authoritative signal transaction confirmation**

Inside one transaction, select tenant signal plus assignment/portfolio/asset, reject terminal status, validate normalized transaction, create `PortfolioTransaction.sourceSignalId`, replay/update the position using existing average-cost accounting, and mark the signal `executed`. Rely on the unique `sourceSignalId` database index for race safety; translate uniqueness conflicts to `SIGNAL_ALREADY_ACTED`.

For DCA, the transaction is a normal BUY whose capital is supplied externally by the user; no separate portfolio cash account is fabricated. Persist note `Strategy signal <signalId>` and keep the contribution amount in signal metadata for audit.

- [ ] **Step 5: Prefill but require explicit confirmation in the dialog**

Clicking `Xem giao dịch` marks the notification read and opens `PortfolioTransactionDialog` with locked asset/action/source signal, proposed but editable quantity/price/fee/execution time, and a visible warning that this is a Mock Portfolio record, not broker execution. Holdings remain unchanged until the user clicks the existing confirmation button and POST succeeds.

`MockPortfolio` reads the optional `signal` search parameter with `useSearchParams`, loads only that tenant-owned preview, opens the dialog once, and removes the query parameter with `router.replace("/portfolio", { scroll: false })` after close or successful confirmation. Invalid, already executed, or cross-tenant signal IDs show the same bounded `Tín hiệu không khả dụng.` message.

- [ ] **Step 6: Run Task 11 tests**

Run: `npm test -- src/lib/portfolio-transaction-preview.test.ts src/lib/backend/portfolio.test.ts src/app/api/portfolio/transactions/route.test.ts src/app/api/tenant-routes.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit reviewed transactions**

```powershell
git add src/lib/portfolio-transaction-preview.ts src/lib/portfolio-transaction-preview.test.ts src/lib/backend/portfolio.ts src/lib/backend/portfolio.test.ts src/app/api/portfolio/transactions/route.ts src/app/api/portfolio/transactions/route.test.ts src/components/PortfolioTransactionDialog.tsx src/components/PortfolioStrategyForwardTests.tsx
git commit -m "feat: confirm strategy signal transactions"
```

### Task 12: Verify security, tenant isolation, responsive UI, and local delivery

**Files:**

- Modify: `src/lib/backend/tenant-isolation.integration.test.ts`
- Create: `docs/qa/2026-08-12-custom-strategy-forward-testing.md`
- Modify: `docs/superpowers/plans/2026-08-12-custom-strategy-execution-forward-testing.md`

**Interfaces:**

- Consumes: completed Tasks 1-11.
- Produces: test/build/browser evidence, verified commits, and a local application running on fixed port 3100.

- [ ] **Step 1: Complete end-to-end database isolation coverage**

Exercise real migrated PostgreSQL with organizations A/B through service functions: create/version/list custom strategies, submit/resolve custom backtest, apply assignment, enqueue/evaluate twice, read snapshots/notifications, mark read, and confirm one transaction. Assert A cannot read or mutate any B resource and deleting A preserves B custom versions, runs, assignments, snapshots, notifications, signals, and transactions.

- [ ] **Step 2: Run all focused TypeScript tests**

Run:

```powershell
npm test -- src/lib/custom-strategies src/lib/strategy-lab src/lib/backtest src/lib/backend/custom-strategies.test.ts src/lib/backend/strategy-forward-tests.test.ts src/lib/backend/portfolio.test.ts src/lib/strategy-forward src/lib/portfolio-transaction-preview.test.ts src/app/api/tenant-routes.test.ts src/app/api/portfolio/transactions/route.test.ts
```

Expected: PASS with zero failures.

- [ ] **Step 3: Run all focused Python tests**

Run:

```powershell
python -m pytest quant-worker/tests/test_custom_rules.py quant-worker/tests/test_price_threshold_execution.py quant-worker/tests/test_dca_execution.py quant-worker/tests/test_cash_flow_performance.py quant-worker/tests/test_signal_jobs.py quant-worker/tests/test_publication.py quant-worker/tests/test_forward_evaluator.py quant-worker/tests/test_worker.py -q
```

Expected: PASS with zero failures.

- [ ] **Step 4: Run migrated-database integration tests**

Set distinct normalized local PostgreSQL URLs: development database name must not end in `_test`; test database name must end in `_test`. Then run:

```powershell
npm run test:integration -- src/lib/backend/tenant-isolation.integration.test.ts
python -m pytest quant-worker/tests/test_forward_evaluator_integration.py -q
```

Expected: PASS. Do not point `DATABASE_URL` and `TEST_DATABASE_URL` at the same database even if query parameters differ.

- [ ] **Step 5: Run full static and production gates**

Run:

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build
python -m pytest quant-worker/tests -q
```

Expected: every command exits 0. A timeout is recorded as unverified, not passed.

- [ ] **Step 6: Start the delivered checkout on fixed port 3100**

Resolve only the current listener on port 3100, stop that process, and run `npm run dev` from this worktree with a hidden window. Confirm `http://localhost:3100/` returns HTTP 200. Do not start a second Next.js port.

- [ ] **Step 7: Perform authenticated browser QA**

Using the in-app browser, verify this exact path with a signed-in editor:

`Strategy Lab -> create Price rule -> save -> Backtest one eligible asset -> inspect Equity Curve/Drawdown and Trade List -> Apply to Mock Portfolio -> inspect initial snapshot/no notification -> activate a later dataset -> inspect one notification -> open reviewed transaction -> confirm -> inspect updated holding and forward chart`.

Repeat rule creation/backtest for DCA and confirm contributions appear separately from profit. Verify viewer mutation controls are unavailable. Verify desktop and a 390px mobile viewport have no page-level horizontal overflow, tab menus remain reachable, charts resize, dialogs fit, and loading/empty/error states are understandable.

- [ ] **Step 8: Record evidence and scope review**

Write `docs/qa/2026-08-12-custom-strategy-forward-testing.md` with exact commands, exit codes, test counts, database names with credentials redacted, built commit SHA, HTTP result, authenticated browser observations, and any unverified item. Then run:

```powershell
git diff --check
git status --short
git log --oneline --decorate -15
```

Expected: no whitespace errors, no unexpected generated files, no `.env*`, credentials, database dumps, screenshots containing secrets, or unrelated user changes staged.

- [ ] **Step 9: Commit verification evidence**

```powershell
git add docs/qa/2026-08-12-custom-strategy-forward-testing.md docs/superpowers/plans/2026-08-12-custom-strategy-execution-forward-testing.md src/lib/backend/tenant-isolation.integration.test.ts
git commit -m "test: verify custom strategy workflow"
```

## Acceptance Traceability

1. Tenant save/isolation: Tasks 1, 2, and 12.
2. Saved version runs without localStorage: Tasks 3, 4, 5, and 6.
3. Causal Price Threshold/no repeats: Task 4.
4. DCA external capital/contribution-neutral profit: Task 5.
5. Successful custom run applies to Mock Portfolio: Task 7.
6. Initial snapshot creates no notification: Tasks 7 and 8.
7. Later event creates exactly one signal/notification after retry: Tasks 8 and 9.
8. Notification opens a prefilled transaction and holdings change only after confirmation: Task 11.
9. Forward performance and buy-and-hold are visible from activation: Tasks 9 and 10.
10. TypeScript/Python, tenant integration, production build, and authenticated browser evidence: Task 12.

## Explicit Follow-Ups Not Implemented by This Plan

- Point-in-time fundamental ingestion and P/B, P/E, ROE, or earnings execution.
- Walk-forward validation, purge/embargo, parameter robustness, and multiple-testing controls.
- External notification channels or broker execution.
