# Mock Portfolio Multi-Currency Ledger Design

## Goal

Make Mock Portfolio accounting consistent across Vietnamese equities, crypto, and XAU by:

- allowing users to create and edit trades in either VND or USD;
- allowing users to edit or delete any manual transaction;
- converting every money value in the portfolio UI to VND for Vietnamese and USD for English;
- using dated USD/VND observations for transaction accounting, daily valuation, performance, and benchmark comparison; and
- showing how much the same contributed capital would be worth if invested in VNINDEX.

The implementation remains daily-only. It does not introduce intraday FX or market data.

## Product Decisions

### Reporting currency

- Vietnamese UI reports all money in VND.
- English UI reports all money in USD.
- Changing language changes the reporting currency but never mutates the raw transaction.
- Quantity and percentages are currency-independent.
- USDT is treated as USD at 1:1 for this MVP. The UI uses the label USD for crypto transaction entry.

### Transaction currency defaults

- Vietnam equities and VN indices default to VND.
- Crypto and XAU default to USD.
- The user may explicitly choose VND or USD before saving.
- Price and fee are interpreted in the selected transaction currency.
- Saved transaction currency does not silently change when the UI language changes.

### FX history

- Backfill the most recent ten years of USD/VND daily history through the current date.
- The primary source is Vietcombank's dated exchange-rate endpoint:
  `https://www.vietcombank.com.vn/api/exchangerates?date=YYYY-MM-DD`.
- Persist the USD transfer-buy rate, USD sell rate, and derived midpoint:
  `(transfer_buy + sell) / 2`.
- One daily observation is stored per effective Vietcombank date with source and fetch timestamps.
- On weekends, public holidays, or missing calendar dates, resolve the latest observation on or before the requested date. Never look ahead.
- The scheduled daily pipeline refreshes the current observation and retries recent gaps.
- The initial ten-year backfill is resumable and idempotent so a partial run can continue without duplicating rows.
- `26,000 VND/USD` is the explicit emergency fallback only when no historical observation exists on or before the requested date. Fallback use must be returned in response metadata and visible near the affected transaction or portfolio summary; it must not masquerade as provider data.

### Transaction audit snapshot

Each transaction stores its raw currency and the dated FX resolution used when it was last created or edited:

- transaction currency;
- USD/VND rate;
- requested execution date;
- effective FX observation date;
- FX source; and
- whether the 26,000 fallback was used.

This makes later ledger replay deterministic and explainable. Re-running the daily collector does not silently rewrite saved transaction accounting. Editing a transaction resolves and stores the applicable FX snapshot again.

## Accounting Model

### Raw data and derived values

Raw transaction fields are the source of truth: asset, side, quantity, execution price, fee, execution date, currency, note, and FX snapshot. Portfolio positions are derived caches; they are rebuilt after every transaction create, edit, or delete.

For a requested reporting currency:

- VND to VND: multiply by 1.
- USD/USDT to VND: multiply by the applicable USD/VND rate.
- VND to USD: divide by the applicable USD/VND rate.
- USD/USDT to USD: multiply by 1.

Transaction cash flows and realized cost basis use the transaction's saved dated FX snapshot. Current asset values use the latest available daily FX observation. Historical portfolio values use the observation available for each valuation date.

### Ledger replay

After create, update, or delete:

1. Lock the tenant portfolio.
2. Validate that the transaction belongs to that tenant and portfolio.
3. Apply the mutation.
4. Reload all transactions in deterministic order: execution time, creation time, ID.
5. Resolve values in the requested accounting currency using the stored transaction snapshots.
6. Replay quantities, weighted average cost, fees, realized PnL, and remaining positions.
7. Reject a mutation if replay would create a sale before a position exists or a sale exceeding available quantity.
8. Replace the derived position cache in the same database transaction.

Deleting a transaction that would make a later sell invalid is rejected with an understandable message. Source-signal transactions may be edited or deleted only if the associated signal status can be restored consistently; otherwise the API rejects the mutation rather than leaving split state.

## Performance and Benchmark

The existing index-only benchmark is replaced with a cash-flow-matched VNINDEX simulation.

For every portfolio valuation day:

- portfolio holdings are valued from that day's asset closes and that day's FX rate;
- each buy contributes capital on its transaction date;
- each sell is treated as a withdrawal of its net proceeds;
- the synthetic benchmark buys or sells VNINDEX units with the same dated net external cash flow;
- VNINDEX closes are converted to the same reporting currency, although VNINDEX itself is VND-denominated; and
- no future price or future FX observation is used.

The response exposes both indexed performance and money values:

- current portfolio value;
- benchmark value from matched cash flows;
- portfolio return;
- benchmark return;
- excess return percentage; and
- excess value in the reporting currency.

The UI summarizes this as: "Danh mục hiện có X; nếu cùng dòng tiền đầu tư vào VNINDEX thì có Y; danh mục hơn/kém Z (P%)." The chart keeps normalized percentage lines for trend readability, while tooltips and summary cards show the comparable money values.

## API and UI

### API

- Portfolio reads accept `currency=VND|USD`; the client derives it from locale.
- Transaction create accepts `currency`.
- Transaction update uses `PATCH /api/portfolio/transactions/[id]`.
- Transaction delete uses `DELETE /api/portfolio/transactions/[id]`.
- Mutation responses return the rebuilt portfolio in the requested reporting currency.
- Responses include compact FX metadata: reporting currency, latest effective rate/date/source, and whether any visible values use fallback.
- API authorization remains tenant-scoped and requires portfolio write capability for all mutations.

### Add and edit dialog

- The same dialog handles create and edit modes.
- Edit mode pre-fills side, asset, date, quantity, price, fee, note, and original currency.
- Currency is a VND/USD select near execution price.
- Selecting a different asset updates the default currency only for a new untouched transaction. It never overwrites an explicit user choice or a saved transaction.
- The preview shows original transaction total, dated FX rate and effective date, and the equivalent amount in the current reporting currency.

### Transaction history

- Add Edit and Delete actions to every row.
- Delete requires a confirmation dialog stating that later holdings and PnL will be replayed.
- All displayed price, fee, net amount, and realized PnL columns use the single reporting currency.
- A compact secondary line identifies the raw transaction currency and dated FX rate so the conversion remains auditable without mixing currency labels in the main columns.
- Successful mutations refresh the portfolio cache and Smart Insights briefing just as transaction creation does.

### Other portfolio surfaces

Total balance, cost basis, realized/unrealized PnL, holdings, allocation money values, risk money values, strategy money values, transaction history, benchmark summary, and chart tooltips all use the response reporting currency. No component may independently infer a holding currency for a displayed portfolio total.

## Data Migration

- Add an immutable daily USD/VND rate table with a unique effective date and source provenance.
- Add transaction currency and FX snapshot fields to portfolio transactions.
- Backfill existing transactions using the asset quote currency as the original currency and the latest FX observation on or before each execution date.
- If the ten-year provider backfill does not cover an old transaction, mark that row as fallback at 26,000 instead of inventing a provider date.
- Rebuild every affected portfolio position after the transaction migration.
- Existing IDs, notes, source-signal links, and execution timestamps are preserved.

## Error Handling

- Provider schema drift fails the FX collection run closed and records a structured error; it does not write zero or malformed rates.
- A portfolio read may use the last known FX observation if today's fetch failed.
- A mutation without a usable historical observation uses 26,000 only as the declared fallback and returns that fact to the UI.
- Update/delete conflicts return HTTP 409 with a user-readable ledger reason.
- Missing or cross-tenant transaction IDs return 404 without revealing existence outside the tenant.

## Verification

### Unit and API tests

- currency defaults by asset market;
- explicit currency selection is preserved;
- VND/USD conversion in both directions;
- weekend and holiday previous-observation lookup;
- no future-observation lookup;
- 26,000 fallback metadata;
- create, update, and delete tenant authorization;
- full ledger replay after editing an early trade;
- delete rejection when a later sell becomes invalid;
- current and historical multi-currency valuation;
- cash-flow-matched benchmark value and excess value;
- locale-driven reporting currency;
- transaction history actions and confirmation behavior.

### Pipeline and live checks

- collector fixture tests for Vietcombank schema and numeric parsing;
- idempotent ten-year backfill test;
- daily scheduler registration test;
- live smoke against one historical date and the current date before enabling the source;
- database checks for ten-year coverage, gaps, duplicates, freshness, and provenance;
- local browser QA in Vietnamese and English with VND and USD transactions.

## Out of Scope

- intraday FX;
- currencies other than VND and USD;
- broker cash balances or settlement accounts;
- bid/ask execution simulation;
- automatic rewriting of historical transaction FX snapshots after provider corrections;
- changing the D-only market-data policy; and
- using FX as an AI-opinion factor.
