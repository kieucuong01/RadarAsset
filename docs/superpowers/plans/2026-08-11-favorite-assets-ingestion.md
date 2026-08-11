# Favorite Assets and On-Demand Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the existing tenant Watchlist as Favorite Assets in Mock Portfolio, allow supported symbol discovery, and queue idempotent free-provider ingestion before handing an eligible symbol to Quant Lab.

**Architecture:** Keep WatchlistItem as the only favorite relationship and add a tenant-scoped MarketIngestionRequest queue for on-demand data preparation. Resolve symbols only through synchronized ProviderInstrument records and approved adapters; never call providers directly from search keystrokes. Reuse the portfolio backtest asset catalog and pass selected symbols to Quant Lab as preferences, not authorization.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.8, Zod 4, Prisma 7/PostgreSQL, Vitest 4, Python 3.12, psycopg 3, pytest.

## Global Constraints

- This plan starts after `2026-08-11-portfolio-backtest-builder.md` Task 6 is merged because Favorite Assets consumes both the supported Quant asset catalog and symbol-prefilled builder.
- WatchlistItem remains the single source of favorite ownership; never create zero-quantity PortfolioPosition rows.
- Every favorite, removal, and ingestion request is scoped by existing tenant/user context and capability checks.
- Shared Asset, ProviderInstrument, Dataset, and DatasetVersion records are never deleted when a favorite is removed.
- Search uses the local synchronized provider catalog; third-party APIs are not called per keystroke.
- On-demand ingestion is idempotent and bounded by organization, user, provider, symbol, timeframe, and active status.
- Approved MVP adapters remain Binance spot, Vnstock/Vietnam equity, and the configured stable XAU source.
- Unsupported or unavailable data is labeled explicitly and cannot start Backtest.
- Keep unrelated working-tree changes out of every task commit.

---

## File Structure

- `src/lib/backend/provider-catalog.ts`: local provider instrument search and safe Asset materialization.
- `src/lib/backend/ingestion-requests.ts`: tenant-scoped idempotent request creation and response mapping.
- `src/lib/watchlist-client.ts`: list/add/remove favorite browser client.
- `src/components/FavoriteAssetsPanel.tsx`: Mock Portfolio favorite table/cards and actions.
- `src/components/FavoriteAssetDialog.tsx`: provider-catalog search and add flow.
- `quant-worker/process_ingestion_requests.py`: claims requests and invokes existing ingestion pipeline.

---

### Task 1: Provider catalog search and synchronization boundary

**Files:**

- Create: `src/lib/backend/provider-catalog.ts`
- Create: `src/lib/backend/provider-catalog.test.ts`
- Create: `src/app/api/market/instruments/route.ts`
- Modify: `src/app/api/tenant-routes.test.ts`
- Modify: `quant-worker/backtest/providers.py`
- Modify: `quant-worker/tests/test_providers.py`
- Create: `quant-worker/sync_provider_instruments.py`

**Interfaces:**

- Produces: `searchProviderInstruments(query)`, `resolveProviderInstrument(providerCode, providerSymbol)`, `GET /api/market/instruments`, and adapter-owned provider symbol normalization.
- Consumes: DataProvider and ProviderInstrument records plus approved provider adapters.

- [ ] **Step 1: Write failing local-search tests**

```ts
it("searches only active approved provider instruments", async () => {
  prisma.providerInstrument.findMany.mockResolvedValue([vnmInstrument]);
  await expect(searchProviderInstruments({ q: "vnm", limit: 20 })).resolves.toEqual({
    items: [
      expect.objectContaining({ providerCode: "vnstock", symbol: "VNM", market: "vn_equity" }),
    ],
  });
  expect(prisma.providerInstrument.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ take: 20 }),
  );
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node node_modules/vitest/vitest.mjs run src/lib/backend/provider-catalog.test.ts src/app/api/tenant-routes.test.ts`
Expected: FAIL because the provider catalog module/route does not exist.

- [ ] **Step 3: Implement bounded local catalog search**

```ts
export type ProviderInstrumentResult = {
  providerCode: string;
  providerSymbol: string;
  symbol: string;
  name: string;
  market: "vn_equity" | "crypto_spot" | "metal_spot";
  venue: string | null;
  currency: string;
  assetId: string;
};

export async function searchProviderInstruments(input: { q: string; limit?: number }) {
  const q = input.q.trim().toUpperCase().slice(0, 40);
  const take = Math.min(Math.max(input.limit ?? 20, 1), 50);
  return mapProviderRows(
    await getPrisma().providerInstrument.findMany({
      where: {
        provider: { status: "active", code: { in: APPROVED_PROVIDER_CODES } },
        OR: [
          { providerSymbol: { contains: q, mode: "insensitive" } },
          { asset: { symbol: { contains: q, mode: "insensitive" } } },
          { asset: { name: { contains: q, mode: "insensitive" } } },
        ],
      },
      include: { provider: true, asset: true },
      orderBy: { providerSymbol: "asc" },
      take,
    }),
  );
}
```

- [ ] **Step 4: Add explicit catalog synchronization CLI**

Each adapter exposes `list_instruments() -> list[ProviderInstrumentDescriptor]`. The CLI upserts Asset and ProviderInstrument rows transactionally, records source metadata, and never deletes an existing Asset. Unit tests use fake provider responses; no test calls the live network.

```py
@dataclass(frozen=True)
class ProviderInstrumentDescriptor:
    provider_symbol: str
    canonical_symbol: str
    name: str
    market: str
    venue: str | None
    currency: str
```

- [ ] **Step 5: Run tests and commit**

Run: `node node_modules/vitest/vitest.mjs run src/lib/backend/provider-catalog.test.ts src/app/api/tenant-routes.test.ts`
Run: `python -m pytest quant-worker/tests/test_providers.py -q`
Expected: PASS.
Commit the seven files with message `feat: synchronize approved provider instruments`.

---

### Task 2: Tenant-scoped idempotent ingestion request queue

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608110004_market_ingestion_requests/migration.sql`
- Create: `src/lib/backend/ingestion-requests.ts`
- Create: `src/lib/backend/ingestion-requests.test.ts`
- Create: `src/app/api/market/ingestion-requests/route.ts`
- Modify: `src/lib/backend/tenant-isolation.integration.test.ts`

**Interfaces:**

- Produces: Prisma `MarketIngestionRequest`, `requestMarketIngestion(context, input)`, and `POST /api/market/ingestion-requests`.
- Consumes: resolved ProviderInstrument, timeframe, and existing tenant/capability context.

- [ ] **Step 1: Write failing idempotency and isolation tests**

```ts
it("returns the active request instead of creating a duplicate", async () => {
  prisma.marketIngestionRequest.findFirst.mockResolvedValue(activeRequest);
  const result = await requestMarketIngestion(editorContext, {
    providerCode: "binance",
    symbol: "ETH",
    timeframe: "1h",
  });
  expect(result.id).toBe(activeRequest.id);
  expect(prisma.marketIngestionRequest.create).not.toHaveBeenCalled();
});
```

The integration test creates the same symbol for two organizations and proves each sees only its own request.

- [ ] **Step 2: Run unit/integration tests and verify RED**

Run: `node node_modules/vitest/vitest.mjs run src/lib/backend/ingestion-requests.test.ts`
Expected: FAIL because the model/module is absent.

- [ ] **Step 3: Add the queue model and migration**

```prisma
model MarketIngestionRequest {
  id                   String             @id @default(uuid()) @db.Uuid
  organizationId       String             @map("organization_id") @db.Uuid
  userId               String             @map("user_id") @db.Uuid
  providerInstrumentId String             @map("provider_instrument_id") @db.Uuid
  timeframe            String
  status               String             @default("queued")
  attemptCount         Int                @default(0) @map("attempt_count")
  availableAt          DateTime           @default(now()) @map("available_at") @db.Timestamptz(3)
  workerId             String?            @map("worker_id")
  leaseExpiresAt       DateTime?          @map("lease_expires_at") @db.Timestamptz(3)
  datasetVersionId     String?            @map("dataset_version_id") @db.Uuid
  errorCode            String?            @map("error_code")
  createdAt            DateTime           @default(now()) @map("created_at")
  updatedAt            DateTime           @updatedAt @map("updated_at")
  organization         Organization       @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user                 AppUser            @relation(fields: [userId], references: [id], onDelete: Cascade)
  providerInstrument   ProviderInstrument @relation(fields: [providerInstrumentId], references: [id], onDelete: Restrict)
  datasetVersion       DatasetVersion?    @relation(fields: [datasetVersionId], references: [id], onDelete: SetNull)

  @@index([organizationId, status, createdAt])
  @@index([status, availableAt])
  @@map("market_ingestion_requests")
}
```

The service uses a serializable transaction/advisory key to find or create one active `queued|running` request per organization/instrument/timeframe. It rate-limits to 20 active requests per user and 100 per organization.

- [ ] **Step 4: Add route validation and capability checks**

```ts
const requestSchema = z
  .object({
    providerCode: z.string().min(1).max(40),
    providerSymbol: z.string().min(1).max(80),
    timeframe: z.enum(["1d", "1h"]),
  })
  .strict();
```

Require `backtest:create`; resolve ProviderInstrument server-side; return 202 for a newly queued request and 200 for an existing active request.

- [ ] **Step 5: Run tests and commit**

Run: `npm run test:integration`
Run: `node node_modules/vitest/vitest.mjs run src/lib/backend/ingestion-requests.test.ts src/app/api/tenant-routes.test.ts`
Expected: PASS.
Commit the six files with message `feat: queue tenant market ingestion requests`.

---

### Task 3: Extend Watchlist add/remove and data state

**Files:**

- Modify: `src/lib/backend/db.ts`
- Modify: `src/lib/backend/types.ts`
- Modify: `src/app/api/watchlist/route.ts`
- Create: `src/app/api/watchlist/[id]/route.ts`
- Modify: `src/lib/watchlist-client.ts`
- Create: `src/lib/watchlist-client.test.ts`
- Modify: `src/app/api/tenant-routes.test.ts`

**Interfaces:**

- Produces: enriched `WatchlistItemResponse`, `addFavoriteAsset`, `removeFavoriteAsset`, and ingestion-state handoff.
- Consumes: Task 1 provider catalog, Task 2 ingestion request service, existing WatchlistItem, ticker, and insight loaders.

- [ ] **Step 1: Write failing add/remove client and service tests**

```ts
it("removes only the tenant/user watchlist row", async () => {
  await removeWatchlistItem(editorContext, "favorite-a");
  expect(prisma.watchlistItem.deleteMany).toHaveBeenCalledWith({
    where: {
      id: "favorite-a",
      organizationId: "org-a",
      userId: "user-a",
    },
  });
  expect(prisma.asset.delete).not.toHaveBeenCalled();
});
```

Client tests assert `DELETE /api/watchlist/favorite-a`, 204 handling, and strict parsing of data/ingestion status.

- [ ] **Step 2: Run tests and verify RED**

Run: `node node_modules/vitest/vitest.mjs run src/lib/watchlist-client.test.ts src/app/api/tenant-routes.test.ts`
Expected: FAIL because delete and enriched response are absent.

- [ ] **Step 3: Enrich response and safely add supported instruments**

```ts
export type WatchlistItemResponse = {
  id: string;
  sym: string;
  name: string;
  price: number;
  chg: number;
  alert: number;
  sentiment: "bull" | "bear" | "neutral";
  datasetState: "ready" | "stale" | "loading" | "unavailable";
  ingestionRequestId: string | null;
  backtestableTimeframes: Array<"1d" | "1h">;
};
```

POST accepts `providerCode`, `providerSymbol`, optional alert, and requested timeframes. Resolve the instrument locally, upsert WatchlistItem, and queue missing supported timeframes idempotently. Existing symbol-only calls remain compatible when the Asset already exists.

- [ ] **Step 4: Add tenant-scoped DELETE route and strict browser client**

`DELETE /api/watchlist/[id]` requires `watchlist:write`, calls `deleteMany` with ID + organization + user, returns 404 when count is zero, and returns 204 on success. The client reloads favorites after deletion rather than mutating unchecked local data.

- [ ] **Step 5: Run tests and commit**

Run: `node node_modules/vitest/vitest.mjs run src/lib/watchlist-client.test.ts src/app/api/tenant-routes.test.ts`
Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: PASS.
Commit the seven files with message `feat: manage favorite assets through watchlist`.

---

### Task 4: Favorite Assets panel in Mock Portfolio

**Files:**

- Create: `src/components/FavoriteAssetsPanel.tsx`
- Create: `src/components/FavoriteAssetDialog.tsx`
- Create: `src/lib/favorite-assets/state.ts`
- Create: `src/lib/favorite-assets/state.test.ts`
- Modify: `src/components/MockPortfolio.tsx`
- Modify: `src/components/WatchlistAddDialog.tsx`

**Interfaces:**

- Produces: search/add/remove favorite UI, state badges, Buy/Sell/alert actions, and Quant Lab handoff.
- Consumes: Task 1 instrument search, Task 3 watchlist client, and `/quant-lab?symbols=` from the core plan.

- [ ] **Step 1: Write failing favorite-state tests**

```ts
it("enables a safe Quant Lab handoff only for ready favorites", () => {
  expect(favoriteActionState(readyVnm)).toEqual({
    canBacktest: true,
    backtestHref: "/quant-lab?symbols=VNM",
    label: "Ready",
  });
  expect(favoriteActionState(loadingEth)).toEqual({
    canBacktest: false,
    backtestHref: null,
    label: "Loading data",
  });
});
```

Add loading-data disabled Backtest, remove confirmation, mobile card layout, and no-holdings-mutation tests.

- [ ] **Step 2: Run component test and verify RED**

Run: `node node_modules/vitest/vitest.mjs run src/lib/favorite-assets/state.test.ts`
Expected: FAIL because the favorite-state module does not exist.

- [ ] **Step 3: Implement the panel and dialog**

The panel loads `/api/watchlist`, renders price/change/alert and `Ready`, `Loading data`, `Stale`, or `Unavailable` badges. Backtest is a real link only when at least one timeframe is ready. Remove uses an AlertDialog and refreshes from the server after success.

The dialog debounces local catalog search by 250ms, aborts stale requests, requires one exact provider instrument selection, and never submits free-form provider URLs.

- [ ] **Step 4: Place panel without changing holdings accounting**

Render `FavoriteAssetsPanel` after Smart Holdings and before Strategy Assignment. It receives no PortfolioResponse setter and cannot write positions. Buy/Sell delegates to the existing `PortfolioTransactionDialog` with the selected symbol.

- [ ] **Step 5: Run tests and commit**

Run: `node node_modules/vitest/vitest.mjs run src/lib/favorite-assets/state.test.ts src/lib/watchlist-client.test.ts`
Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: PASS.
Commit the six files with message `feat: add favorite assets to mock portfolio`.

---

### Task 5: Process on-demand ingestion and verify end-to-end

**Files:**

- Create: `quant-worker/process_ingestion_requests.py`
- Create: `quant-worker/tests/test_ingestion_requests.py`
- Modify: `quant-worker/backtest/ingestion_repository.py`
- Modify: `quant-worker/ingest_market_data.py`
- Modify: `scripts/run-market-ingestion.ps1`

**Interfaces:**

- Produces: leased request claiming, approved adapter dispatch, dataset publication linkage, bounded retry, and final request state.
- Consumes: Task 2 MarketIngestionRequest and the existing ingestion/quality/publication pipeline.

- [ ] **Step 1: Write failing request-worker tests**

```py
def test_request_worker_claims_once_and_publishes_dataset() -> None:
    repository = FakeRequestRepository(queued_eth_request())
    response = process_next_ingestion_request(repository, fake_provider_factory)
    assert response["status"] == "succeeded"
    assert repository.completed.dataset_version_id == "eth-1h-version"
    assert repository.claim_count == 1

def test_request_worker_rejects_unapproved_provider() -> None:
    repository = FakeRequestRepository(queued_unknown_request())
    assert process_next_ingestion_request(repository, fake_provider_factory)["code"] == "PROVIDER_NOT_APPROVED"
```

- [ ] **Step 2: Run tests and verify RED**

Run: `python -m pytest quant-worker/tests/test_ingestion_requests.py -q`
Expected: FAIL because the request worker does not exist.

- [ ] **Step 3: Implement leased claim and existing pipeline dispatch**

```py
def process_next_ingestion_request(repository: RequestRepository, provider_factory: ProviderFactory) -> dict[str, Any]:
    request = repository.claim_next_request()
    if request is None:
        return {"status": "idle"}
    try:
        outcome = run_ingestion(selection=request.selection, provider_factory=provider_factory, repository=repository.ingestion_repository)
        repository.complete_request(request, outcome.dataset_version_id)
        return {"status": "succeeded", "id": request.id, "datasetVersionId": outcome.dataset_version_id}
    except ProviderUnavailableError:
        repository.retry_or_fail(request, "PROVIDER_UNAVAILABLE")
        return {"status": "failed", "id": request.id, "code": "PROVIDER_UNAVAILABLE"}
```

Claim with `FOR UPDATE SKIP LOCKED`, a five-minute lease, maximum three attempts, and bounded backoff. Completion writes the published Dataset Version ID. Stale leases are recoverable; duplicate requests do not duplicate Dataset Versions because publication remains checksum-idempotent.

- [ ] **Step 4: Wire the scheduled runner and run all gates**

`run-market-ingestion.ps1` processes scheduled feeds first, then a bounded batch of 20 on-demand requests. It uses the same database-safety checks and does not print credentials.

Run:

```powershell
python -m pytest quant-worker/tests -q
node node_modules/vitest/vitest.mjs run --exclude '.worktrees/**'
npm run test:integration
node node_modules/typescript/bin/tsc --noEmit
node node_modules/next/dist/bin/next build --webpack
```

Expected: all applicable gates exit 0; skipped/unavailable database gates are reported honestly.

- [ ] **Step 5: Browser QA and final tree check**

Flow: `/portfolio` -> Add favorite ETH -> Loading data -> worker processes request -> Ready -> Backtest ETH -> Quant Lab opens with ETH selected -> add another supported symbol -> remove ETH from favorites -> confirm holdings/PnL unchanged.

Verify desktop and 390px mobile, no horizontal overflow, no framework overlay, and no relevant console errors. Finish with `git status --short` and `git diff --check`. If QA exposes a defect, return to the task that owns the behavior, add a failing regression test, fix it in that task's exact files, rerun the owning gate, and commit with that task's specified message before repeating this flow.
