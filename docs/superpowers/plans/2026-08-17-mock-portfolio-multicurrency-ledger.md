# Mock Portfolio Multi-Currency Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ten years of dated USD/VND rates, editable/deletable portfolio transactions, locale-driven single-currency reporting, and a cash-flow-matched VNINDEX money benchmark.

**Architecture:** Vietcombank daily rates are collected by the existing Python/PowerShell daily pipeline and persisted in a dedicated immutable FX table. Raw transactions retain their entered currency and dated FX snapshot; the TypeScript portfolio repository converts transaction cash flows, daily marks, and benchmark marks into the requested VND or USD reporting currency before replaying the ledger. React receives one reporting currency and never performs portfolio accounting or mixed-currency aggregation.

**Tech Stack:** PostgreSQL, Prisma 7, Next.js 16 Route Handlers, TypeScript, React 19, Vitest, Python 3/pytest/psycopg/stdlib urllib, PowerShell scheduler, Recharts.

## Global Constraints

- Follow `docs/superpowers/specs/2026-08-17-mock-portfolio-multicurrency-ledger-design.md`.
- Keep the entire market-data and portfolio feature daily-only; do not add an intraday timeframe.
- Backfill the most recent ten years of USD/VND data through the current date.
- Use Vietcombank transfer-buy/sell midpoint and latest-on-or-before lookup; never look ahead.
- Use `26,000 VND/USD` only as explicit fallback metadata when no provider observation exists.
- Vietnamese reports every portfolio money value in VND; English reports every portfolio money value in USD.
- USDT is treated as USD at 1:1 for this MVP.
- Preserve tenant authorization, source-signal integrity, and all unrelated dirty work.
- Use test-first red-green-refactor for every behavior change.
- Do not expose FX collection or dataset-health administration on the user-facing portfolio UI.

---

## File Structure

### New files

- `prisma/migrations/202608170001_portfolio_fx_rates/migration.sql` — FX table and transaction audit columns.
- `quant-worker/fx_rates/__init__.py` — package boundary.
- `quant-worker/fx_rates/vietcombank.py` — dated endpoint client and strict parser.
- `quant-worker/fx_rates/repository.py` — idempotent persistence and gap lookup.
- `quant-worker/sync_fx_rates.py` — resumable ten-year/current-day CLI.
- `quant-worker/tests/fixtures/fx/vietcombank-usd-vnd.json` — captured provider-shape fixture.
- `quant-worker/tests/test_fx_rates.py` — parser, date range, fallback, and repository tests.
- `scripts/run-market-ingestion.test.mjs` — scheduler integration contract.
- `src/lib/backend/fx-rates.ts` — pure conversion and latest-on-or-before selection.
- `src/lib/backend/fx-rates.test.ts` — FX domain tests.
- `src/app/api/portfolio/transactions/[id]/route.ts` — PATCH/DELETE route.
- `src/app/api/portfolio/transactions/[id]/route.test.ts` — dynamic mutation API tests.
- `src/components/mock-portfolio/PortfolioBenchmarkSummary.tsx` — money comparison cards and copy.

### Modified files

- `prisma/schema.prisma` — `FxRate` model and transaction snapshot fields.
- `scripts/run-market-ingestion.ps1` — invoke FX sync before scheduler success is recorded.
- `quant-worker/verify_daily_pipeline.py` and test — require a fresh FX observation.
- `src/lib/backend/types.ts` — currency, FX metadata, mutation, and benchmark contracts.
- `src/lib/backend/portfolio.ts` and test — reporting-currency replay and benchmark value simulation.
- `src/lib/backend/portfolio-repository.ts` and new focused test — dated-rate loading, normalization, create/update/delete replay.
- `src/app/api/portfolio/route.ts` and tests — validate reporting currency.
- `src/app/api/portfolio/performance/route.ts` — pass reporting currency.
- `src/app/api/portfolio/transactions/route.ts` and test — accept transaction/reporting currency.
- `src/lib/portfolio-client.ts` and test — currency-aware cache keys and mutation clients.
- `src/lib/portfolio-transaction-preview.ts` and test — pure currency defaults and equivalent preview.
- `src/components/PortfolioTransactionDialog.tsx` and test — create/edit modes and currency selection.
- `src/components/mock-portfolio/PortfolioTransactionLog.tsx` — edit/delete actions and confirmation.
- `src/components/mock-portfolio/PortfolioOverviewPanel.tsx` — reporting currency and benchmark summary.
- `src/components/mock-portfolio/PortfolioHoldingsTable.tsx` — stop using holding-native currency for displayed money.
- `src/components/MockPortfolio.tsx` — locale currency request and shared dialog mutation state.
- `src/components/PortfolioNumberFormatting.test.tsx` — application-wide portfolio money guard.
- `src/components/mock-portfolio/component-boundaries.test.ts` — new benchmark component and line budgets.
- `src/lib/i18n/dictionaries/vi/portfolio.ts` and `en/portfolio.ts` — user copy.
- `README.md` and `docs/operations/dataset-bootstrap-runbook.md` — FX bootstrap/daily commands and validation.

---

### Task 1: Persist dated FX rates and transaction audit snapshots

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608170001_portfolio_fx_rates/migration.sql`
- Test: `src/lib/backend/seed-safety.test.ts`

**Interfaces:**
- Produces Prisma model `FxRate` keyed by `(baseCurrency, quoteCurrency, effectiveDate, source)`.
- Produces transaction fields `currency`, `fxRateToVnd`, `fxEffectiveDate`, `fxSource`, and `fxFallback`.

- [ ] **Step 1: Write a failing schema contract test**

Add assertions to `src/lib/backend/seed-safety.test.ts` that read `prisma/schema.prisma` and require:

```ts
expect(schema).toContain("model FxRate");
expect(schema).toContain('@@map("fx_rates")');
expect(schema).toContain('currency       String   @default("USD")');
expect(schema).toContain("fxRateToVnd");
expect(schema).toContain("fxEffectiveDate");
expect(schema).toContain("fxFallback");
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `npx vitest run src/lib/backend/seed-safety.test.ts`

Expected: FAIL because `FxRate` and the transaction snapshot columns do not exist.

- [ ] **Step 3: Add Prisma models and SQL migration**

Add this model shape to `prisma/schema.prisma`:

```prisma
model FxRate {
  id            String   @id @default(uuid()) @db.Uuid
  baseCurrency  String   @map("base_currency")
  quoteCurrency String   @map("quote_currency")
  effectiveDate DateTime @map("effective_date") @db.Date
  transferBuy   Decimal  @map("transfer_buy") @db.Decimal(20, 8)
  sell          Decimal  @db.Decimal(20, 8)
  mid           Decimal  @db.Decimal(20, 8)
  source        String
  fetchedAt     DateTime @map("fetched_at")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  @@unique([baseCurrency, quoteCurrency, effectiveDate, source])
  @@index([baseCurrency, quoteCurrency, effectiveDate(sort: Desc)])
  @@map("fx_rates")
}
```

Add these fields to `PortfolioTransaction`:

```prisma
currency        String    @default("USD")
fxRateToVnd     Decimal   @default(26000) @map("fx_rate_to_vnd") @db.Decimal(20, 8)
fxEffectiveDate DateTime? @map("fx_effective_date") @db.Date
fxSource        String?   @map("fx_source")
fxFallback      Boolean   @default(true) @map("fx_fallback")
```

The SQL migration must create `fx_rates`, indexes, add the transaction fields, then backfill existing transactions with `VND/1` when the joined asset currency is VND and `USD/26000/fallback` otherwise. Preserve every existing transaction ID and source-signal link.

- [ ] **Step 4: Generate Prisma client and verify GREEN**

Run:

```powershell
npx prisma generate
npx vitest run src/lib/backend/seed-safety.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add prisma/schema.prisma prisma/migrations/202608170001_portfolio_fx_rates/migration.sql src/lib/backend/seed-safety.test.ts
git commit -m "feat: persist portfolio fx snapshots"
```

---

### Task 2: Collect and backfill ten years of Vietcombank USD/VND data

**Files:**
- Create: `quant-worker/fx_rates/__init__.py`
- Create: `quant-worker/fx_rates/vietcombank.py`
- Create: `quant-worker/fx_rates/repository.py`
- Create: `quant-worker/sync_fx_rates.py`
- Create: `quant-worker/tests/fixtures/fx/vietcombank-usd-vnd.json`
- Create: `quant-worker/tests/test_fx_rates.py`

**Interfaces:**
- Produces `FxObservation(effective_date, transfer_buy, sell, mid, source, fetched_at)`.
- Produces `sync_range(connection, client, start_date, end_date) -> SyncSummary`.
- CLI supports `--mode backfill|daily`, `--start`, `--end`, `--env-file`, and `--live-smoke`.

- [ ] **Step 1: Write failing parser and range tests**

Use this fixture contract:

```json
{
  "Date": "2026-08-15",
  "Data": [
    {
      "currencyCode": "USD",
      "currencyName": "US DOLLAR",
      "cash": "26,050.00",
      "transfer": "26,080.00",
      "sell": "26,450.00"
    }
  ]
}
```

Add tests equivalent to:

```python
def test_parse_usd_midpoint() -> None:
    row = parse_vietcombank_response(load_fixture(), requested_date=date(2026, 8, 15))
    assert row.transfer_buy == Decimal("26080.00")
    assert row.sell == Decimal("26450.00")
    assert row.mid == Decimal("26265.00")

def test_ten_year_range_is_inclusive() -> None:
    start, end = backfill_window(date(2026, 8, 17))
    assert start == date(2016, 8, 17)
    assert end == date(2026, 8, 17)

def test_parser_rejects_missing_usd_or_non_positive_rate() -> None:
    with pytest.raises(FxSchemaDrift):
        parse_vietcombank_response({"Date": "2026-08-15", "Data": []}, requested_date=date(2026, 8, 15))
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm run test:python -- quant-worker/tests/test_fx_rates.py -q`

Expected: FAIL because the `fx_rates` package does not exist.

- [ ] **Step 3: Implement strict client, parser, and idempotent repository**

Implement the endpoint as:

```python
URL = "https://www.vietcombank.com.vn/api/exchangerates"

def fetch_day(transport: UrllibTransport, requested_date: date) -> FxObservation:
    url = f"{URL}?{urlencode({'date': requested_date.isoformat()})}"
    response = transport.fetch(url, timeout_seconds=20.0, max_bytes=1_000_000)
    return parse_vietcombank_response(
        json.loads(response.body),
        requested_date=requested_date,
    )
```

Parsing must remove grouping commas, use `Decimal`, require positive transfer/sell values, calculate midpoint with decimal arithmetic, and use the provider response date as `effective_date`. Repository persistence must use `INSERT ... ON CONFLICT ... DO UPDATE` only when the provider fields are valid. Duplicate weekend responses update one effective date instead of creating fabricated calendar rows.

The backfill iterates business dates in the inclusive ten-year range, commits bounded batches, skips effective dates already present, and resumes from the first missing business date after interruption. Provider holidays may resolve to an already-stored prior effective date and are counted as deduplicated. Emit JSON summary fields `requested`, `stored`, `deduplicated`, `failed`, `coverageStart`, and `coverageEnd`. A failed request remains retryable and never stores 26,000 as provider data.

- [ ] **Step 4: Run parser/repository tests and verify GREEN**

Run: `npm run test:python -- quant-worker/tests/test_fx_rates.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add quant-worker/fx_rates quant-worker/sync_fx_rates.py quant-worker/tests/fixtures/fx/vietcombank-usd-vnd.json quant-worker/tests/test_fx_rates.py
git commit -m "feat: collect dated Vietcombank fx rates"
```

---

### Task 3: Add FX collection to the daily pipeline and readiness gate

**Files:**
- Modify: `scripts/run-market-ingestion.ps1`
- Create: `scripts/run-market-ingestion.test.mjs`
- Modify: `quant-worker/verify_daily_pipeline.py`
- Modify: `quant-worker/tests/test_verify_daily_pipeline.py`
- Modify: `README.md`
- Modify: `docs/operations/dataset-bootstrap-runbook.md`

**Interfaces:**
- Daily wrapper calls `sync_fx_rates.py --mode daily` before marking the scheduler run successful.
- Pipeline verification returns `DAILY_FX_RATE_MISSING` when no current-or-prior fresh rate exists.

- [ ] **Step 1: Write failing scheduler and health tests**

The Node contract test must assert that the PowerShell wrapper references `sync_fx_rates.py`, passes `--mode daily`, and maps failure to `fx_rate_sync_failed`.

Extend the Python health fixture with `fx_effective_date` and assert:

```python
def test_daily_pipeline_requires_fresh_fx_rate() -> None:
    row = healthy_row() | {"fx_effective_date": None}
    assert verify_daily_pipeline_health(row) == ["DAILY_FX_RATE_MISSING"]
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node --test scripts/run-market-ingestion.test.mjs
npm run test:python -- quant-worker/tests/test_verify_daily_pipeline.py -q
```

Expected: FAIL because FX sync and readiness are absent.

- [ ] **Step 3: Wire the daily stage and health query**

Add `$taskFxRatePath` and invoke:

```powershell
& $taskPython $taskFxRatePath "--mode" "daily" "--env-file" $taskEnvPath
if ($LASTEXITCODE -ne 0) {
    if ($taskExitCode -eq 0) { $taskExitCode = $LASTEXITCODE }
    $taskErrorCode = "fx_rate_sync_failed"
}
```

Extend `DAILY_PIPELINE_SQL` with the maximum Vietcombank USD/VND effective date not later than the local date. Accept Friday for weekend runs, but fail when the latest observation is more than four calendar days old.

Document:

```powershell
python quant-worker/sync_fx_rates.py --mode backfill --env-file .env.local
powershell.exe -NoProfile -File scripts/run-market-ingestion.ps1 -Command daily
```

- [ ] **Step 4: Verify GREEN**

Run the two focused commands from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/run-market-ingestion.ps1 scripts/run-market-ingestion.test.mjs quant-worker/verify_daily_pipeline.py quant-worker/tests/test_verify_daily_pipeline.py README.md docs/operations/dataset-bootstrap-runbook.md
git commit -m "feat: refresh fx rates in daily pipeline"
```

---

### Task 4: Build the pure FX and cash-flow-matched benchmark engine

**Files:**
- Create: `src/lib/backend/fx-rates.ts`
- Create: `src/lib/backend/fx-rates.test.ts`
- Modify: `src/lib/backend/types.ts`
- Modify: `src/lib/backend/portfolio.ts`
- Modify: `src/lib/backend/portfolio.test.ts`

**Interfaces:**
- `normalizeCurrency(value: string): "USD" | "VND"` maps USDT to USD and rejects unsupported values.
- `convertMoney(value, from, to, usdVndRate)` converts only USD/VND.
- `selectRateOnOrBefore(rates, date)` never returns a future row and returns explicit fallback metadata.
- `buildTradeAwarePerformance(...)` returns indexed and money fields plus a benchmark summary.

- [ ] **Step 1: Write failing conversion tests**

Add:

```ts
expect(convertMoney(100, "USD", "VND", 26_250)).toBe(2_625_000);
expect(convertMoney(2_625_000, "VND", "USD", 26_250)).toBe(100);
expect(convertMoney(100, "USDT", "USD", 26_250)).toBe(100);
expect(selectRateOnOrBefore(rates, "2026-08-16").effectiveDate).toBe("2026-08-15");
expect(selectRateOnOrBefore(rates, "2010-01-01")).toMatchObject({
  rate: 26_000,
  source: "fallback",
  fallback: true,
});
```

Add a multi-currency ledger case: buy BTC in USD, buy FPT in VND, report in VND, and assert total cost/PnL are summed only after conversion.

Add a benchmark case where identical buy contributions purchase VNINDEX units on each contribution date and a sell removes the same net withdrawal. Assert final `benchmarkValue`, `portfolioValue`, `excessValue`, and `excessReturnPct`.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npx vitest run src/lib/backend/fx-rates.test.ts src/lib/backend/portfolio.test.ts
```

Expected: FAIL because conversion and money benchmark contracts are absent.

- [ ] **Step 3: Implement pure domain logic**

Use this result contract:

```ts
export type PortfolioPerformancePoint = {
  label: string;
  Portfolio: number;
  Benchmark: number;
  portfolioValue: number;
  benchmarkValue: number | null;
};

export type PortfolioBenchmarkSummary = {
  symbol: "VNINDEX";
  portfolioValue: number;
  benchmarkValue: number | null;
  excessValue: number | null;
  portfolioReturnPct: number;
  benchmarkReturnPct: number | null;
  excessReturnPct: number | null;
};
```

Before `replayPortfolioLedger`, convert every raw transaction price/fee into the requested reporting currency using its stored snapshot. Convert each asset mark and daily bar with the applicable date's rate. Maintain synthetic VNINDEX units by applying the same net contributions/withdrawals at that day's benchmark close. If a withdrawal exceeds the synthetic benchmark value, preserve the shortfall as negative benchmark cash rather than fabricating units or silently clamping the result.

- [ ] **Step 4: Verify GREEN and refactor**

Run the focused command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/backend/fx-rates.ts src/lib/backend/fx-rates.test.ts src/lib/backend/types.ts src/lib/backend/portfolio.ts src/lib/backend/portfolio.test.ts
git commit -m "feat: calculate multi-currency portfolio benchmark"
```

---

### Task 5: Make the portfolio repository replay mutations in reporting currency

**Files:**
- Modify: `src/lib/backend/portfolio-repository.ts`
- Create: `src/lib/backend/portfolio-repository.test.ts`
- Modify: `src/lib/backend/types.ts`

**Interfaces:**
- `loadPortfolioResponse(context, timeframe, reportingCurrency)`.
- `createPortfolioTransaction(context, input)` accepts `currency` and `reportingCurrency`.
- `updatePortfolioTransaction(context, id, input)` returns rebuilt `PortfolioResponse`.
- `deletePortfolioTransaction(context, id, timeframe, reportingCurrency)` returns rebuilt `PortfolioResponse`.

- [ ] **Step 1: Write failing repository tests**

Cover:

```ts
it("loads the latest fx row on or before every transaction and valuation date", async () => {});
it("stores the selected currency and dated fx snapshot when creating a transaction", async () => {});
it("replays later transactions after editing an early buy", async () => {});
it("rolls back deleting a buy when a later sell becomes invalid", async () => {});
it("does not update or delete a transaction outside the tenant portfolio", async () => {});
it("restores a linked strategy signal when its transaction is deleted", async () => {});
```

Use the existing Prisma dependency injection/mocking pattern in the file; assert transaction boundaries and final response values, not only method calls.

- [ ] **Step 2: Run and verify RED**

Run: `npx vitest run src/lib/backend/portfolio-repository.test.ts`

Expected: FAIL because update/delete/reporting-currency repository methods are absent.

- [ ] **Step 3: Extract one locked replay helper and implement mutations**

Add a private repository helper with this responsibility:

```ts
async function rebuildPortfolioPositions(
  tx: Prisma.TransactionClient,
  portfolioId: string,
): Promise<void>
```

It loads all raw rows, normalizes each trade into the portfolio's persisted position currency, calls `replayPortfolioLedger`, and replaces positions atomically. Mutation functions must first scope the row through the tenant portfolio, lock the portfolio, apply the row mutation, call the helper, and allow a ledger error to roll back the whole transaction.

`loadPortfolioResponse` separately builds a reporting-currency response from raw transactions, dated FX rows, asset bars, and VNINDEX bars; it does not trust mixed legacy position money.

- [ ] **Step 4: Verify GREEN**

Run the focused repository test. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/backend/portfolio-repository.ts src/lib/backend/portfolio-repository.test.ts src/lib/backend/types.ts
git commit -m "feat: replay editable portfolio transactions"
```

---

### Task 6: Expose currency-aware portfolio and transaction APIs

**Files:**
- Modify: `src/app/api/portfolio/route.ts`
- Modify: `src/app/api/portfolio/performance/route.ts`
- Modify: `src/app/api/portfolio/transactions/route.ts`
- Modify: `src/app/api/portfolio/transactions/route.test.ts`
- Create: `src/app/api/portfolio/transactions/[id]/route.ts`
- Create: `src/app/api/portfolio/transactions/[id]/route.test.ts`
- Modify: `src/app/api/tenant-routes.test.ts`
- Modify: `src/lib/portfolio-client.ts`
- Modify: `src/lib/portfolio-client.test.ts`

**Interfaces:**
- Query: `currency=VND|USD` on reads and mutations.
- POST/PATCH body includes raw transaction `currency`.
- Dynamic route uses `RouteContext<'/api/portfolio/transactions/[id]'>` and awaits `ctx.params` per Next.js 16 docs.

- [ ] **Step 1: Write failing route/client tests**

Assert:

```ts
expect(fetcher).toHaveBeenCalledWith(
  "/api/portfolio?timeframe=1M&currency=VND",
  { cache: "no-store" },
);
```

Route cases must include valid PATCH, valid DELETE, invalid currency 400, malformed UUID 400, cross-tenant 404, ledger conflict 409, and write-capability rejection.

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npx vitest run src/lib/portfolio-client.test.ts src/app/api/portfolio/transactions/route.test.ts 'src/app/api/portfolio/transactions/[id]/route.test.ts' src/app/api/tenant-routes.test.ts
```

Expected: FAIL because the query/body contracts and dynamic route do not exist.

- [ ] **Step 3: Implement schemas and route handlers**

Use a shared Zod schema for create/edit fields and a strict reporting currency parser:

```ts
const reportingCurrencySchema = z.enum(["VND", "USD"]);
const transactionCurrencySchema = z.enum(["VND", "USD"]);
```

PATCH returns 200 with the rebuilt portfolio. DELETE returns 200 with the rebuilt portfolio so the client can refresh without a second request. Both queue `enqueueBriefingRefresh` after successful mutation and return `X-Smart-Insights-Refresh`.

Make the client cache key `portfolio:${timeframe}:${currency}` and clear all `portfolio:` keys after mutation.

- [ ] **Step 4: Verify GREEN**

Run the focused command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/app/api/portfolio src/lib/portfolio-client.ts src/lib/portfolio-client.test.ts src/app/api/tenant-routes.test.ts
git commit -m "feat: expose editable portfolio transaction api"
```

---

### Task 7: Add transaction currency defaults, create/edit dialog, and delete confirmation

**Files:**
- Modify: `src/lib/portfolio-transaction-preview.ts`
- Modify: `src/lib/portfolio-transaction-preview.test.ts`
- Modify: `src/components/PortfolioTransactionDialog.tsx`
- Modify: `src/components/PortfolioTransactionDialog.test.tsx`
- Modify: `src/components/mock-portfolio/PortfolioTransactionLog.tsx`
- Modify: `src/components/MockPortfolio.tsx`
- Modify: `src/lib/i18n/dictionaries/vi/portfolio.ts`
- Modify: `src/lib/i18n/dictionaries/en/portfolio.ts`

**Interfaces:**
- `transactionCurrencyForAsset({ assetClass, currency }): "VND" | "USD"`.
- Dialog prop `editingTransaction?: PortfolioTransactionResponse | null`.
- Transaction log emits `onEdit(transaction)` and `onDelete(transaction)`.

- [ ] **Step 1: Write failing default and interaction tests**

Pure tests:

```ts
expect(transactionCurrencyForAsset({ assetClass: "equity", currency: "VND" })).toBe("VND");
expect(transactionCurrencyForAsset({ assetClass: "crypto", currency: "USDT" })).toBe("USD");
expect(transactionCurrencyForAsset({ assetClass: "commodity", currency: "USD" })).toBe("USD");
```

Rendered tests must assert a VND/USD select, edit-mode prefill, PATCH URL, delete confirmation text, DELETE URL, pending-button state, and refreshed response callback.

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npx vitest run src/lib/portfolio-transaction-preview.test.ts src/components/PortfolioTransactionDialog.test.tsx src/components/mock-portfolio/component-boundaries.test.ts
```

Expected: FAIL because currency selection and edit/delete controls are absent.

- [ ] **Step 3: Implement UI behavior**

Keep one controlled `PortfolioTransactionDialog` at `MockPortfolio` level for editing, while the overview retains the primary create trigger. Use the selected asset market/currency to initialize a new draft only when the user has not manually changed currency.

Each transaction row gets icon buttons with visible tooltips/ARIA labels `Sửa giao dịch {symbol}` and `Xóa giao dịch {symbol}`. Use the existing AlertDialog component for destructive confirmation. On success, pass the returned portfolio to `handlePortfolioRecorded`, close the modal, clear selection, and show a localized toast.

The edit preview shows:

```text
Giá trị gốc: 1,000.00 USD
Tỷ giá 15/08/2026: 26,265 VND/USD
Quy đổi: 26,265,000 VND
```

- [ ] **Step 4: Verify GREEN**

Run the focused command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/portfolio-transaction-preview.ts src/lib/portfolio-transaction-preview.test.ts src/components/PortfolioTransactionDialog.tsx src/components/PortfolioTransactionDialog.test.tsx src/components/mock-portfolio/PortfolioTransactionLog.tsx src/components/MockPortfolio.tsx src/lib/i18n/dictionaries/vi/portfolio.ts src/lib/i18n/dictionaries/en/portfolio.ts
git commit -m "feat: edit and delete portfolio transactions"
```

---

### Task 8: Unify portfolio money presentation and add benchmark money comparison

**Files:**
- Create: `src/components/mock-portfolio/PortfolioBenchmarkSummary.tsx`
- Modify: `src/components/mock-portfolio/PortfolioOverviewPanel.tsx`
- Modify: `src/components/mock-portfolio/PortfolioHoldingsTable.tsx`
- Modify: `src/components/mock-portfolio/PortfolioRiskMetrics.tsx`
- Modify: `src/components/mock-portfolio/PortfolioTransactionLog.tsx`
- Modify: `src/components/MockPortfolio.tsx`
- Modify: `src/components/PortfolioNumberFormatting.test.tsx`
- Modify: `src/components/mock-portfolio/component-boundaries.test.ts`
- Modify: `src/lib/i18n/dictionaries/vi/portfolio.ts`
- Modify: `src/lib/i18n/dictionaries/en/portfolio.ts`

**Interfaces:**
- Every portfolio money formatter receives `portfolio.baseCurrency` only.
- Benchmark summary receives `PortfolioResponse["benchmark"]` and `currency`.

- [ ] **Step 1: Write failing server-rendered presentation tests**

For a Vietnamese response, assert the rendered page contains only VND on total, holdings, transactions, risk money, benchmark value, and chart tooltip formatters; raw USD appears only in the small transaction audit line. Repeat with English/USD.

Assert summary copy contains equivalent values:

```text
Danh mục hiện có 520,000,000 VND
Nếu cùng dòng tiền đầu tư vào VNINDEX: 500,000,000 VND
Vượt benchmark: +20,000,000 VND (+4.00%)
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npx vitest run src/components/PortfolioNumberFormatting.test.tsx src/components/mock-portfolio/component-boundaries.test.ts
```

Expected: FAIL because holdings and transaction history still select native currencies and benchmark money is absent.

- [ ] **Step 3: Implement unified formatting and benchmark cards**

Remove `holding.currency ?? currency` from money displays. Format all primary money with the response currency. Keep quantities in native units and preserve raw transaction currency only in the audit subtitle.

Place `PortfolioBenchmarkSummary` above the existing performance chart. Retain normalized index lines for trend comparison, add money fields to the tooltip, and visually separate Portfolio, VNINDEX equivalent, and excess value in compact cards.

Derive `reportingCurrency` in `MockPortfolio` as:

```ts
const reportingCurrency = locale === "vi" ? "VND" : "USD";
```

Pass it into `getCachedPortfolio(timeframe, reportingCurrency)` and reload on locale change without mutating raw transactions.

- [ ] **Step 4: Verify GREEN**

Run the focused command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/components/mock-portfolio src/components/MockPortfolio.tsx src/components/PortfolioNumberFormatting.test.tsx src/lib/i18n/dictionaries/vi/portfolio.ts src/lib/i18n/dictionaries/en/portfolio.ts
git commit -m "feat: compare portfolio value with VNINDEX"
```

---

### Task 9: Apply, backfill, live-smoke, and verify the complete feature

**Files:**
- Modify only files required by failures discovered in this task.
- Record evidence in: `docs/verification/2026-08-17-portfolio-multicurrency-ledger.md`

**Interfaces:**
- Produces migrated local database, ten-year FX coverage report, fresh local services, and browser evidence.

- [ ] **Step 1: Run all static and automated gates**

Run:

```powershell
npm run format:check
npm run typecheck
npm run lint
npm test
npm run test:python
git diff --check
```

Expected: all commands exit 0. Fix only feature-related failures, rerun focused tests first, then rerun the complete gate.

- [ ] **Step 2: Apply the migration and ten-year backfill locally**

Run:

```powershell
npx prisma migrate deploy
python quant-worker/sync_fx_rates.py --mode backfill --env-file .env.local
```

Expected: migration succeeds; JSON summary shows coverage from no later than `2016-08-17` through the latest available 2026 date, zero duplicate effective-date/source rows, and zero unclassified parser failures.

- [ ] **Step 3: Live-smoke provider and daily pipeline**

Run:

```powershell
python quant-worker/sync_fx_rates.py --mode daily --live-smoke --env-file .env.local
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/run-market-ingestion.ps1 -Command daily
python quant-worker/verify_daily_pipeline.py --env-file .env.local
```

Expected: current/historical Vietcombank shape parses; daily scheduler and readiness succeed. If live provider access fails, report the actual error and do not enable fake provider rows.

- [ ] **Step 4: Start local services and perform browser QA**

Run `npm run dev`, verify `http://localhost:3100` and `http://127.0.0.1:8100/healthz`, then test:

1. Vietnamese: add BTC in USD and FPT in VND; all main money is VND.
2. English: reload; all main money is USD and raw trade fields remain unchanged.
3. Edit the early BTC trade; holdings, PnL, benchmark money, and history update.
4. Attempt a delete that invalidates a later sell; UI shows the 409 ledger reason.
5. Delete a safe transaction; row, holdings, and benchmark update without a full-page reload.
6. Verify mobile table actions, modal keyboard navigation, confirmation focus, chart lines, and tooltips.

- [ ] **Step 5: Write verification evidence and final commit**

The verification file must record command, exit code, FX coverage start/end/count, fallback count, local HTTP statuses, and the browser cases above. Do not claim production deployment.

```powershell
git add docs/verification/2026-08-17-portfolio-multicurrency-ledger.md
git commit -m "test: verify multi-currency portfolio ledger"
```

---

## Plan Self-Review

- Spec coverage: all approved requirements map to Tasks 1–9.
- Type consistency: `VND | USD`, `fxRateToVnd`, `PortfolioBenchmarkSummary`, and reporting-currency parameters use the same names across tasks.
- Scope: no intraday data, extra currencies, broker cash ledger, or AI-opinion changes.
- Failure behavior: provider schema drift, missing dated data, invalid delete replay, and tenant isolation all fail explicitly.
- Performance: rates are bulk-loaded once per portfolio request, conversions are map lookups, independent data reads can run concurrently, and the UI does not fetch FX per row.
