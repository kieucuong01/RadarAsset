# Custom Strategy Execution and Forward Testing Design

**Date:** 2026-08-12
**Status:** Approved for implementation
**Scope:** Executable Price Rule and DCA strategies, tenant persistence, Mock Portfolio forward testing, and in-app notifications

## 1. Goal

Turn Strategy Lab from an educational catalog and local rule designer into an end-to-end workflow for two custom strategy types that can use the platform's existing market data:

1. Price threshold strategies that emit causal buy or sell signals.
2. Periodic DCA strategies that add new capital and buy one configured asset on schedule.

Users must be able to save these strategies to their organization, backtest them, apply them to a Mock Portfolio holding, observe performance from the application time onward, and receive a real in-app notification when a new actionable event occurs.

This work must not imply support for fundamental strategies. P/B, P/E, ROE, and earnings rules remain unavailable until point-in-time financial-statement ingestion exists.

## 2. Current State

### Implemented

- Strategy Lab is a first-class Quant Lab tab between Portfolio Optimizer and Backtest.
- The immutable technical catalog contains nine executable OHLCV strategies.
- Strategy Lab explains catalog strategies and classifies technical, fundamental, and systematic approaches.
- The visual builder validates and stores catalog presets, DCA rules, price rules, and fundamental-rule drafts in versioned browser storage.
- Catalog-backed technical presets pass directly into Portfolio Backtest Builder.
- Portfolio Backtest supports per-asset strategies, market costs, cash allocation, periodic portfolio contributions, and rebalancing.
- PostgreSQL stores immutable Strategy Versions, tenant-owned Strategy Assignments, and Strategy Signals.
- A successful backtest leg can be applied to Mock Portfolio as an assignment.

### Incomplete

- DCA and price rules are browser-only drafts and are not executable.
- Custom strategies are not shared across devices or organization members.
- Existing periodic portfolio contribution is a portfolio assumption, not a strategy assigned to one asset.
- Mock Portfolio shows assignments and imported historical signals but does not calculate a separate forward-test performance series from assignment activation.
- In-app notifications are intentionally disabled.
- Fundamental point-in-time ingestion and robustness analysis are not implemented.

## 3. Scope Boundaries

### Included

- Price threshold rule execution in backtests and incremental evaluation.
- Asset-specific DCA execution with new external capital per scheduled purchase.
- Tenant-scoped custom strategy persistence and immutable versions.
- Backtest catalog integration for executable custom strategy versions.
- Assignment of custom strategy versions to Mock Portfolio assets.
- Forward-test snapshots and performance against buy-and-hold from activation time.
- Tenant-scoped, deduplicated in-app notifications.
- Reviewable Mock Portfolio Buy/Sell actions; no automatic trade execution.

### Excluded

- Fundamental data ingestion or fundamental strategy execution.
- Email, Telegram, SMS, or push delivery.
- Arbitrary Python or user-provided executable code.
- Short selling, derivatives, or broker execution.
- Natural-language-to-rule compilation.
- Walk-forward optimization, parameter search, or overfitting analysis.

Fundamental ingestion and robustness form independent follow-up specs because they require different data contracts, validation methods, and operational schedules.

## 4. Domain Model

### 4.1 CustomStrategy

`CustomStrategy` is a tenant-owned logical strategy that users can rename, archive, or extend with new versions.

Required fields:

- `id`
- `organizationId`
- `createdByUserId`
- `name`
- `description` nullable
- `family`: `technical` or `systematic`
- `status`: `active` or `archived`
- `createdAt`, `updatedAt`

Deleting an organization cascades its custom strategies. Deleting a user does not delete organization strategies; the creator reference becomes nullable or is restricted according to the existing AppUser ownership convention.

### 4.2 CustomStrategyVersion

Every version is immutable once created. Editing a used strategy creates a new semantic version rather than mutating past backtests or assignments.

Required fields:

- `id`
- `customStrategyId`
- `version`
- `kind`: `price_threshold` or `scheduled_dca`
- `ruleDefinition`: normalized JSON
- `implementationHash`
- `status`: `active` or `retired`
- `createdAt`

Unique constraints:

- `(customStrategyId, version)`
- `(customStrategyId, implementationHash)`

Normalized rule schemas:

```ts
type PriceThresholdRule = {
  schemaVersion: 1;
  kind: "price_threshold";
  operator: "crosses_above" | "crosses_below";
  threshold: number;
  currency: "USD" | "VND";
  action: "buy" | "sell";
  sizePct: number; // (0, 100]
};

type ScheduledDcaRule = {
  schemaVersion: 1;
  kind: "scheduled_dca";
  contributionAmount: number; // > 0, always new external capital
  currency: "USD" | "VND";
  frequency: "monthly";
  dayOfMonth: number; // 1..28
};
```

The assigned asset is not embedded in a version. One version may be assigned to different assets, while every assignment chooses exactly one asset.

### 4.3 Execution Identity

Existing global `StrategyVersion` rows remain the execution registry used by Quant Runs and Strategy Assignments. An executable custom version receives a linked global execution record with:

- deterministic code `custom:<customStrategyVersionId>`
- semantic version copied from the custom version
- category `custom_rule`
- parameter schema containing no mutable user parameters
- default parameters containing the normalized rule definition
- supported markets and timeframes derived server-side
- implementation hash equal to the custom version hash
- organization ownership linkage

Global catalog queries must never expose another organization's custom strategies. Public built-in versions remain organization-neutral. All loaders use `organizationId IS NULL OR organizationId = current tenant`, with creation/update restricted to the tenant side.

## 5. Price Threshold Semantics

### 5.1 Causal Signal

A price event occurs only on a crossing:

- `crosses_above`: previous close `<= threshold` and current close `> threshold`.
- `crosses_below`: previous close `>= threshold` and current close `< threshold`.

Remaining above or below the threshold does not emit repeated events.

### 5.2 Execution

- Signal timestamp: close of bar `t`.
- Fill timestamp and price basis: open of bar `t + 1`.
- Fees and slippage: existing per-market cost model.
- `buy`: invest `sizePct` of available sleeve cash.
- `sell`: liquidate `sizePct` of the current asset quantity.
- Long-only; a sell signal while flat is recorded as HOLD/non-actionable rather than opening a short.
- A buy signal with no available cash is non-actionable and records a bounded reason.
- No final-bar signal can fill without a next bar.

Price thresholds use the assigned asset's native trading currency. MVP rejects a rule currency that differs from the asset currency rather than fabricating historical FX.

## 6. DCA Semantics

### 6.1 External Capital

Each DCA event adds `contributionAmount` as new capital. It does not withdraw from the portfolio's existing cash balance.

Backtest metrics must distinguish:

- initial capital
- cumulative DCA contributions
- final equity
- net profit = final equity - initial capital - cumulative contributions
- time-weighted return, which neutralizes external cash flows
- money-weighted return, when enough dated cash flows exist

Raw final equity and total return must never count contributed capital as investment profit.

### 6.2 Schedule

- Frequency: monthly in this sprint.
- Target day: configured day `1..28` in the dataset timezone/calendar.
- If no bar exists on the target date, use the first eligible bar after the target date within that month.
- At most one DCA contribution per calendar month.
- No contribution is created before the backtest start or after the end.
- A month with no eligible bar produces no contribution.

### 6.3 Fill

The contribution is deposited immediately before the selected bar's open and used for the DCA purchase at that open.

- Buy notional is bounded so purchase plus commission and slippage cannot exceed the contribution.
- Crypto and XAU support fractional quantity using existing Decimal arithmetic.
- Vietnamese equities use the engine's supported quantity granularity. If board-lot execution is not currently modeled, the result explicitly reports fractional-research execution rather than pretending broker compatibility.
- Any unspent contribution remains as sleeve cash.
- DCA never emits a sell signal by itself.

## 7. Backtest Integration

### 7.1 Strategy Catalog

The backtest strategy endpoint returns:

- all active built-in catalog versions
- active custom versions owned by the current organization

Custom entries are clearly marked with `origin: "custom"`, family, readiness, and owner scope. Built-ins use `origin: "built_in"`.

### 7.2 Submission

Portfolio Backtest legs continue to submit a strategy code, version, and normalized parameters. Server-side resolution validates tenant access to custom strategy versions before creating Quant Runs or legs.

The worker receives a frozen rule definition in the run payload and verifies its implementation hash. It does not query arbitrary tenant strategy JSON while running, preserving run reproducibility.

### 7.3 Artifacts

Price strategy trades use the existing trade artifact contract with partial-size fields added where necessary.

DCA adds bounded artifacts:

- `contribution`: timestamp, external amount, currency, fees, invested amount, remaining cash
- `trades`: DCA buy fills with reason `scheduled_dca`
- `cash_flow`: dated external cash flows for performance calculations

Portfolio aggregation must not double-count DCA contribution artifacts and the existing portfolio-level monthly contribution assumption. Both may be used together, and their sources remain distinct.

## 8. Strategy Lab Persistence and UI

### 8.1 Migration from Browser Storage

On first authenticated load:

1. Parse versioned local drafts with the existing strict validator.
2. Show an import prompt rather than silently uploading them.
3. Create tenant-owned strategies only after explicit user confirmation.
4. Keep invalid or unsupported fundamental drafts local and label them as unavailable.
5. Remove successfully imported executable drafts from local storage only after the server confirms persistence.

### 8.2 My Strategies

My Strategies loads organization-visible records from the API. Users with edit capability can:

- create an executable DCA or price strategy
- create a new immutable version
- archive a strategy
- send an active version into Backtest

Viewers can inspect and use active versions in research but cannot create, version, or archive them.

All API inputs use shared Zod validation. No user rule becomes executable code, SQL, HTML, or a shell command.

## 9. Mock Portfolio Forward Testing

### 9.1 Activation

Applying a custom strategy creates or replaces the assignment for one portfolio asset. Activation records:

- assignment timestamp
- starting asset quantity and average cost
- starting market price and dataset version
- starting cash attributable to the assignment where relevant
- strategy version and immutable hash

Historical backtest events are not replayed as future notifications. The first incremental evaluation creates an initial snapshot.

### 9.2 Evaluation

When a new eligible dataset version becomes active:

1. Enqueue one evaluation job per active assignment and dataset version.
2. Evaluate only bars after the assignment's last evaluated bar, plus bounded warm-up/context bars.
3. Persist assignment state and the evaluation result atomically.
4. Use idempotency `(assignmentId, datasetVersionId, evaluatedBarTimestamp, eventType)`.

Price rules evaluate crossings against the prior close. DCA rules evaluate whether the current month has an unpaid scheduled event.

### 9.3 Forward Performance

Forward-test snapshots record:

- timestamp and dataset version
- simulated cash and quantity
- market value and equity
- cumulative external contributions
- cumulative fees
- strategy PnL excluding contributions
- buy-and-hold benchmark equity from activation

The Mock Portfolio UI shows strategy status and research simulation separately from the user's manually recorded portfolio position. Applying a strategy does not mutate the holding until the user confirms a reviewed Mock Portfolio transaction.

## 10. Signals, Notifications, and Reviewable Transactions

### 10.1 Signal Types

- `INITIAL_SNAPSHOT`: records activation state; no notification.
- `BUY`: actionable price or DCA purchase event.
- `SELL`: actionable price exit event.
- `HOLD`: evaluation with no action; no notification.
- `SKIPPED`: scheduled event could not execute; informational state, no trade.

### 10.2 In-App Notification

Each actionable signal creates exactly one tenant-owned notification for the assigned portfolio's `userId` in the same transaction as signal persistence. The API verifies that the recipient, portfolio, assignment, and signal all belong to the same organization.

Notification fields include:

- organization and recipient user
- assignment and signal IDs
- type: `strategy_buy` or `strategy_sell`
- title and bounded human-readable body
- read timestamp nullable
- created timestamp

Uniqueness on `(userId, signalId)` prevents duplicates. Opening a notification does not mark it acted; read state is independent from transaction review.

### 10.3 Mock Portfolio Action

Notification and signal actions open the existing Buy/Sell transaction form prefilled with:

- asset
- action
- proposed quantity or contribution amount
- reference price
- strategy signal source ID

The user must confirm the transaction. Existing tenant capability checks, transaction validation, average-cost accounting, and idempotency continue to apply. No automated execution is permitted.

## 11. APIs and Authorization

New or extended endpoints:

- `GET /api/quant/custom-strategies`
- `POST /api/quant/custom-strategies`
- `GET /api/quant/custom-strategies/:id`
- `POST /api/quant/custom-strategies/:id/versions`
- `PATCH /api/quant/custom-strategies/:id`
- `GET /api/portfolio/strategy-forward-tests`
- `GET /api/notifications`
- `PATCH /api/notifications/:id`

Requirements:

- Every endpoint requires the existing tenant context.
- Reads are organization-scoped.
- Mutations require edit capability.
- Cross-tenant IDs return not found rather than leaking ownership.
- Custom strategy catalog access is revalidated server-side during backtest submission and assignment.
- Pagination and bounded response sizes apply to lists, notifications, signals, and forward snapshots.

## 12. Error Handling

User-correctable errors return bounded validation messages:

- invalid threshold, percentage, contribution, currency, or day
- asset currency mismatch
- inaccessible/retired strategy version
- missing eligible dataset or next bar
- unsupported market/timeframe
- insufficient cash for a price-rule buy

Worker failures store a sanitized terminal error code. Raw database, file path, provider response, or stack trace is not returned to clients.

Idempotent retries must not duplicate contributions, trades, signals, forward snapshots, or notifications.

## 13. Testing Strategy

### TypeScript unit tests

- Normalize each rule and reject unknown fields, invalid amounts, invalid percentages, and invalid dates.
- Produce stable hashes independent of JSON key order.
- Enforce tenant catalog visibility.
- Validate local-draft import behavior.
- Calculate forward PnL without treating contributions as profit.
- Deduplicate notifications and mark-read behavior.

### Python unit and golden tests

- Price crossing emits once and fills at next-bar open.
- Price remains past threshold without repeated events.
- Partial buy/sell size is correct after fees and slippage.
- DCA contributes exactly once per month.
- Weekend/holiday target uses the next eligible bar in the same month.
- DCA metrics exclude contributed capital from net profit.
- Fractional assets and VN-equity execution disclosure behave as specified.
- Frozen rule and implementation hash reproduce identical artifacts.

### Database integration tests

- A second organization cannot read, run, assign, version, or archive another tenant's strategy.
- Deleting one organization does not remove another tenant's strategies or notifications.
- Retrying one evaluation job creates no duplicate signal, contribution, snapshot, or notification.
- Initial snapshot creates no notification.
- Applying a signal-created transaction validates that signal belongs to the same tenant, portfolio, asset, and action.

### Browser QA

End-to-end path:

`Strategy Lab -> create DCA/price rule -> save -> run single-asset backtest -> inspect equity/trades/contributions -> apply to Mock Portfolio -> activate initial snapshot -> publish/evaluate next eligible dataset -> receive in-app notification -> review and confirm Mock Portfolio transaction -> inspect forward performance`

Also verify mobile tab overflow, dialogs, empty/loading/error states, and no page-level horizontal overflow.

## 14. Delivery Sequence

1. Add tenant-owned custom strategy persistence and immutable versions.
2. Extend catalog and backtest submission with tenant custom versions.
3. Add price threshold strategy and partial-size execution.
4. Add asset-specific DCA contributions and cash-flow metrics.
5. Connect Strategy Lab persistence and local-draft import.
6. Extend assignments and worker evaluation for custom rules.
7. Add forward-test snapshots and Mock Portfolio presentation.
8. Add in-app notifications and reviewable transaction handoff.
9. Run tenant integration tests, full unit suites, production build, and authenticated browser QA.

## 15. Follow-Up Specs

### Point-in-time Fundamentals

Define source provenance, filing period, publication/effective timestamps, restatements, currency, company actions, field-level quality, and coverage before enabling P/B, P/E, ROE, or earnings strategies.

### Robustness and Overfitting

Define anchored/rolling walk-forward splits, purge and embargo, parameter grids, multiple-testing controls, stability scoring, out-of-sample reporting, and minimum sample requirements. This work consumes immutable strategy versions and datasets created by the current design but does not block DCA or price-rule execution.

## 16. Acceptance Criteria

The sprint is complete only when all of the following are demonstrated:

1. An editor can save a DCA or price strategy to the organization and another organization cannot see it.
2. The saved immutable version can run in Backtest on an eligible asset without localStorage dependence.
3. Price crossings fill causally at next-bar open and do not repeat while price remains on one side.
4. DCA adds new capital once per eligible month and performance metrics do not count it as profit.
5. A succeeded custom-strategy backtest can be assigned to a Mock Portfolio asset.
6. Assignment activation creates an initial snapshot without a notification.
7. A later actionable event creates one signal and one in-app notification despite retry.
8. Reviewing a notification opens a prefilled Mock Portfolio transaction, but portfolio holdings change only after user confirmation.
9. Forward performance and buy-and-hold comparison are visible from activation.
10. Full TypeScript/Python tests, tenant integration tests, production build, and authenticated browser QA pass with evidence.
