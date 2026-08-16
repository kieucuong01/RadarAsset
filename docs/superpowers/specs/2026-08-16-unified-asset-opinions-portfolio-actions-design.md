# Unified Asset Opinions and Portfolio Actions

## Goal

Make Smart Insights the single consumer surface for following an asset, reviewing its grounded AI/quant opinion, and taking the next portfolio action. Remove the duplicate Favorites panel from Mock Portfolio, improve Mock Portfolio information order, and use consistent asset identity icons anywhere a symbol is shown.

## Scope

### Smart Insights

- Add an `Add asset` action to the AI Asset Opinions header.
- Present one deduplicated asset list composed of:
  - current portfolio holdings;
  - user watchlist items;
  - the default representatives BTC, XAU, and VNINDEX.
- Preserve the existing click-anywhere behavior for opening the asset-opinion analysis modal.
- Add row/card actions for Buy, Sell, Backtest, and Remove.
- On desktop, show Buy, Sell, and Backtest directly and place Remove in an overflow menu.
- On mobile, show Buy and Sell directly and place Backtest and Remove in an overflow menu.
- Action controls must stop event propagation so they do not open the analysis modal.
- Remove is available only for user-added watchlist items that are neither current holdings nor the three default representatives.
- Sell is disabled when the user does not hold a positive quantity of the asset.
- Backtest is disabled until the watchlist/dataset contract reports at least one backtestable timeframe.

### Mock Portfolio

- Remove the standalone Favorites panel.
- Put the `Add transaction` action in the total-portfolio summary card, next to the total value on desktop and immediately below it on mobile.
- Render sections in this order:
  1. portfolio overview, allocation, and performance;
  2. Smart Holdings;
  3. Risk Metrics;
  4. strategy assignment and forward tests;
  5. transaction history.

### Asset icons

- Add one reusable `AssetIcon` component.
- Use locally defined icon treatments for supported crypto assets, XAU, VNINDEX, and the primary Vietnamese blue-chip symbols.
- Use a deterministic colored monogram fallback for all other symbols.
- Apply it to AI Asset Opinions, the add-asset dialog, Smart Holdings, and the asset-level allocation detail derived from current holdings. The existing category pie may remain category-based and therefore does not invent a symbol for Cash/Stocks/Crypto categories.
- Icons must not depend on a third-party image host and must include accessible symbol labeling when not accompanied by visible text.

## Existing Contracts to Reuse

- The watchlist remains the only persistence model for followed assets.
- `GET/POST /api/watchlist` and `DELETE /api/watchlist/[id]` remain the add/load/remove boundary.
- Watchlist mutations already enqueue Smart Insights briefing refreshes; the UI must expose the resulting generating state instead of inventing an opinion.
- Portfolio actions reuse `PortfolioTransactionDialog` and `/api/portfolio/transactions`.
- Backtest navigation reuses the existing Quant Lab URL contract emitted by `favoriteActionState`.
- The existing Asset Opinion modal and evidence flow remain unchanged except for launching portfolio actions from the list.

## Client Data Model

Introduce a presentation model that merges `AssetOpinionModel`, `WatchlistItemResponse`, and `PortfolioHoldingResponse` by canonical uppercase symbol. Each row exposes:

- symbol, name, market/currency metadata, and icon identity;
- optional current opinion;
- optional watchlist id and dataset state;
- optional holding and positive-position state;
- current quote when available;
- `isDefaultRepresentative`, `canRemove`, `canSell`, and `backtestHref`.

Deduplication priority is holding identity, then watchlist metadata, then opinion metadata. Opinion content is never copied between symbols. The visible ordering is current holdings first, followed assets second, then missing default representatives; stable ordering is used within each group.

## Data Flow and State

Smart Insights loads briefing, watchlist, and the existing cached portfolio response concurrently. Failures are isolated:

- a briefing failure still permits watchlist management and portfolio actions;
- a watchlist failure keeps existing opinions visible but disables add/remove operations with a clear error;
- a portfolio failure keeps analysis and backtest available but disables transaction actions.

After adding an asset, the returned watchlist replaces local watchlist state immediately. The new row shows its quote/dataset state and `Preparing analysis` until a matching asset opinion is published. After removing an asset, the row disappears only when it is not retained by a holding or default-representative rule. Briefing generation continues through the existing refresh/polling path.

Requests must remain bounded: one watchlist read and one portfolio read per Smart Insights page load, with no per-row fetches. Dialog asset catalogs remain lazy-loaded when opened.

## Interaction and Accessibility

- The non-action portion of each row/card is a keyboard-accessible analysis trigger.
- Nested action buttons have explicit accessible names containing the symbol.
- Destructive removal uses a confirmation dialog.
- Focus returns to the originating control after closing analysis, transaction, add-asset, overflow, or confirmation dialogs.
- Disabled Sell and Backtest controls explain the missing prerequisite with visible or tooltip text.
- Loading, empty, and error states never masquerade as investment conclusions.

## Testing

- Unit-test the merged presentation model, ordering, deduplication, and action eligibility.
- Component-test desktop and mobile Asset Opinions actions, propagation boundaries, add/remove confirmation, generating state, and icon fallback.
- Component-test Mock Portfolio section order and top transaction trigger.
- Test `AssetIcon` mappings and deterministic fallback.
- Retain existing transaction, watchlist, Asset Opinion modal, number-formatting, and backend contract tests.
- Run TypeScript, lint, format check, full Vitest, production build, and authenticated desktop/mobile Playwright flows.

## Non-goals

- No new watchlist table or duplicate favorites state.
- No automatic trade execution and no change to quant opinion scoring.
- No third-party logo service or runtime logo scraping.
- No deletion of current holdings or default representatives through the watchlist action.
- No opinion generated from placeholder or seed values when evidence is unavailable.
