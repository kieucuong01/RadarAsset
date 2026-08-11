# Backtest & Risk Classic Results UI

## Goal

Restore the clearer results hierarchy from the earlier Backtest & Risk interface while keeping the current portfolio builder, real Python backtest artifacts, QuantStats output, cash-flow assumptions, and per-leg strategy integration.

The interface must never display generated performance, generated trades, or simulated chart points before a successful run.

## User Flow

1. The user configures a portfolio in the existing Portfolio Backtest Builder.
2. An **Active Portfolio** summary reflects the configured or submitted portfolio without inventing performance.
3. Before a successful run, result surfaces show a clear empty state asking the user to run a backtest.
4. While the run is queued or running, the existing run status and progress remain visible.
5. After the worker succeeds, the primary result hierarchy becomes:
   - Active Portfolio
   - Equity Curve & Drawdown
   - Core KPI cards
   - Trade List
   - Advanced Analysis

## Layout

### Active Portfolio

Show one compact chip or row per submitted leg with:

- symbol;
- strategy label and version;
- allocation percentage and initial notional;
- leverage;
- tested date range and timeframe;
- dataset version provenance where space permits.

The summary uses submitted run data after a run is created. Before submission it may use builder state, but it must not imply that a backtest has completed.

### Equity Curve & Drawdown

Use one responsive card titled **Equity Curve & Drawdown**:

- portfolio equity is the primary series;
- benchmark is shown only when a real benchmark artifact is available;
- drawdown uses the aggregate drawdown artifact and shares the same time axis;
- legend values come from artifacts, not hard-coded percentages;
- desktop uses a large equity chart with a narrower drawdown panel;
- mobile stacks the drawdown chart below the equity chart without horizontal page overflow.

When no successful run exists, the card shows an empty state and no chart points.

### Core KPIs

Show compact cards for values that exist in the result model:

- Total Return;
- Max Drawdown;
- Sharpe Ratio;
- Win Rate;
- Profit Factor.

If an artifact does not provide a metric, display an em dash rather than deriving or fabricating a value in the UI.

### Trade List

Present all completed per-leg trades in one portfolio-level table, ordered newest first. Columns:

- sequence;
- entry time;
- exit time;
- asset;
- side;
- entry price;
- exit price;
- holding bars when derivable from immutable timestamps and timeframe;
- fees when supplied by the artifact;
- realized PnL;
- return percentage.

The table includes an asset filter and a leg/strategy identifier when multiple strategies are present. On mobile it scrolls inside its card; the page itself must not overflow horizontally. An empty successful backtest says that no completed trades occurred.

## Advanced Analysis

Keep the current functionality below the classic primary results inside an **Advanced Analysis** section:

- QuantStats IS/OOS report download;
- contribution by asset and cash;
- cash-flow and rebalance events;
- per-leg equity, parameters, dataset provenance, and Apply to Mock Portfolio action.

This section is visually secondary and collapsed or tabbed by default so the main results remain easy to scan.

## Data Boundaries

- `BacktestResults` consumes `buildBacktestResultModel(run)` as its sole result source.
- Presentation helpers may aggregate trades and align equity/drawdown timestamps, but must not recalculate the backtest.
- Missing benchmark data remains explicitly unavailable; the UI must not substitute SPY, VNINDEX, BTC, or XAU automatically.
- Existing immutable dataset version and strategy provenance remain visible in Advanced Analysis.
- No API or database schema change is required unless implementation reveals a metric that is absent from every committed artifact.

## Component Boundaries

Split the results UI into focused components:

- `ActiveBacktestPortfolio` for submitted legs and run context;
- `EquityDrawdownChart` for aligned chart presentation;
- `BacktestKpiGrid` for artifact-backed metrics;
- `BacktestTradeList` for aggregation, filtering, responsive table behavior, and empty state;
- `BacktestAdvancedAnalysis` for existing detailed views.

Keep pure aggregation and formatting logic outside React components so it can be tested without rendering charts.

## Error and Empty States

- No run: prompt the user to configure and run the portfolio.
- Active run: preserve progress and do not render partial artifacts as final results.
- Failed run: preserve the sanitized worker error state.
- Successful run with no trades: render charts/KPIs that exist and a no-trades message.
- Malformed or missing required artifacts: retain the existing fail-closed result-model behavior.

## Testing

Use test-first implementation for:

- aggregation and newest-first ordering of trades across legs;
- alignment of equity and drawdown points;
- missing metric formatting;
- no generated results before success;
- successful run with no completed trades;
- multi-asset trade filtering;
- preservation of QuantStats and Apply to Mock Portfolio functionality.

Verification includes focused Vitest, changed-file ESLint, Next.js production build, and browser QA at `http://localhost:3100/quant-lab` for desktop and mobile widths. Browser QA must check empty state, successful result hierarchy, table overflow, console health, and one filter interaction when authenticated test state is available.

## Non-Goals

- Replacing the Python backtest engine.
- Adding another backtesting library.
- Generating placeholder trades or performance data.
- Changing portfolio accounting, allocation, execution, ingestion, or alert semantics.
- Adding benchmark calculations without a real benchmark artifact contract.
