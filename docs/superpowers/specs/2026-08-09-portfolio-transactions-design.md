# Portfolio Accounting and Transactions Design

## Goal

Complete the manual portfolio tracker so holdings, allocation, PnL, benchmark performance, and risk metrics remain internally consistent after Buy and Sell transactions.

## Scope

- Keep the existing demo user, PostgreSQL portfolio, assets, market bars, and transaction tables.
- Treat the transaction ledger as the accounting source of truth.
- Treat `portfolio_positions` as a rebuildable projection of the ledger.
- Use weighted-average cost accounting.
- Do not add cash-balance accounting, deposits, withdrawals, broker connectivity, authentication, or order execution.
- Preserve the current simulated-data labeling.

## Accounting Rules

Transactions are replayed in ascending `executedAt`, then `createdAt`, then database identifier order. This gives backdated and same-timestamp trades a deterministic sequence.

### Buy

- New quantity: `old quantity + buy quantity`.
- New open cost basis: `old open cost basis + quantity * price + fee`.
- New average cost: `new open cost basis / new quantity`.
- Realized PnL is zero.

### Sell

- Reject a sell if no position exists at that point in ledger time.
- Reject a sell quantity larger than the quantity available at that point in ledger time.
- Released cost basis: `sell quantity * current average cost`.
- Net proceeds: `sell quantity * sell price - fee`.
- Realized PnL: `net proceeds - released cost basis`.
- Remaining average cost stays unchanged.
- Remove the position projection when the remaining quantity reaches zero.

Fees are therefore included in Buy cost basis and deducted from Sell realized PnL. Numeric calculations use the existing decimal database fields and controlled rounding at domain/output boundaries.

## Domain Architecture

Add a pure ledger replay function to the portfolio domain. It accepts asset metadata and chronologically ordered transaction events, and produces:

- Current position projections.
- Enriched transaction rows containing net amount, released cost basis, realized PnL, and remaining quantity.
- Aggregate realized PnL.

The existing transaction application helper remains the smallest unit for a single Buy or Sell, while ledger replay owns ordering and aggregation.

On transaction creation, the service writes the candidate transaction inside a database transaction, reloads the full portfolio ledger, replays it, rejects invalid historical states, and replaces the position projection atomically. A failure rolls back both the new transaction and position changes.

No schema migration is required because realized PnL and released cost basis are deterministic ledger-derived values rather than duplicated stored state.

## Portfolio Response

The portfolio response exposes:

- `totalValue`: current market value of open holdings.
- `totalCost`: current open cost basis.
- `unrealizedPnL`: current market value minus open cost basis.
- `realizedPnL`: cumulative realized PnL from all Sell transactions.
- `totalPnL`: realized plus unrealized PnL.
- `totalPnLPct`: total PnL divided by cumulative Buy capital, including Buy fees; zero when no Buy capital exists.

Each holding exposes quantity, average cost, current price, market value, allocation percentage, and unrealized PnL. Allocation is based on current market value only.

Each transaction response exposes gross amount, signed net cash flow, released cost basis, realized PnL, and remaining quantity. The API may return the newest display subset, but accounting and performance calculations always use the full ledger.

## Performance and Benchmark

Historical portfolio performance uses the transaction ledger rather than applying today's quantities to every historical market bar.

For each daily market-bar date:

1. Replay transactions through that date to determine end-of-day holdings.
2. Mark holdings with the latest known price on that date.
3. Treat Buy net amounts as external contributions and Sell net proceeds as external withdrawals because this tracker intentionally has no cash account.
4. Calculate daily return as `(ending market value - signed external flow) / prior ending market value - 1`, where a Buy is a positive contribution and a Sell is a negative withdrawal.
5. Chain daily returns into an index starting at 100.

The SPY benchmark is normalized to 100 over the same available dates. Risk metrics continue to use the displayed portfolio and benchmark indices, so Beta, Sharpe ratio, annualized volatility, maximum drawdown, and historical VaR reflect the trade-aware series. Diversification continues to use current allocation.

If insufficient market history exists, the API returns the available points and zero-safe risk metrics rather than fabricated data.

## Transaction API

`POST /api/portfolio/transactions` retains the existing payload:

- `symbol`
- `type`: `buy` or `sell`
- `quantity`
- `price`
- `fee`
- `executedAt`
- optional `note`

Validation errors return HTTP 400. Domain conflicts such as selling an unavailable quantity return HTTP 409. Database or service failures retain a 503 response. A successful request returns the fully refreshed portfolio response.

## User Interface

### Portfolio summary and holdings

- Show current value, open cost basis, unrealized PnL, realized PnL, total PnL, and day change without implying broker connectivity.
- Add quantity and average-cost visibility to Holdings.
- Preserve horizontal scrolling for wide desktop-style financial tables and readable mobile spacing.

### Add transaction dialog

- Buy can select any supported asset.
- Sell can select only currently held assets.
- Keep side, asset, date, quantity, execution price, and fee inputs.
- Display a live preview:
  - Buy: total cost, projected quantity, and projected average cost.
  - Sell: net proceeds, estimated realized PnL, and remaining quantity.
- Disable submission for invalid numeric values and show inline validation or API conflict messages.
- Preserve a loading state and prevent closing or double submission while saving.

### Transaction history

- Continue showing date, asset, side, quantity, price, and fee.
- Add net amount and realized PnL.
- Show realized PnL only for Sell rows.

## Error Handling

- Unknown asset: actionable validation error.
- Sell without an open position: conflict error.
- Oversell at any historical point: conflict error identifying the available quantity.
- Invalid dates and execution timestamps later than the current time: validation error; valid backdated trades are supported.
- Database failure: preserve the prior rendered portfolio and show a non-destructive toast.

## Testing

Domain tests cover:

- First Buy with fees.
- Multiple Buys with weighted-average cost.
- Partial Sell and unchanged remaining average cost.
- Full Sell and position removal.
- Sell fee treatment and realized PnL.
- Sell without a position and oversell rejection.
- Backdated transaction replay.
- Aggregate realized, unrealized, and total PnL.
- Allocation after a transaction.
- Trade-aware performance and benchmark normalization.
- Risk metrics from the recalculated series.

Rendered QA covers:

- Portfolio load and non-empty core sections.
- Buy preview and successful Buy refresh.
- Sell preview and successful Sell refresh.
- Oversell error behavior.
- Updated holdings and transaction history.
- Desktop and mobile viewport overflow, dialog usability, console health, and framework-overlay absence.

## Completion Criteria

- Portfolio accounting is reproducible from the full transaction ledger.
- Buy and Sell update the position projection atomically.
- Realized and unrealized PnL are visible and mathematically consistent.
- Benchmark and risk metrics use trade-aware performance rather than current-quantity backcasting.
- Existing simulated-data disclosure remains visible.
- Targeted tests, full Vitest, TypeScript, ESLint, production build, and browser QA pass.
